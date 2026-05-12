/**
 * Cin7 → Google Chat — Real-Time Alerts
 *
 * Cron-scheduled (every 15 min, business hours). Reads thresholds and
 * webhook URLs from `chat_function_settings` row 'cin7-realtime-alerts'.
 *
 * Behaviours:
 *   - Each posted alert is fingerprinted and skipped if the same one
 *     was posted within config.dedup_window_hours (default 12).
 *   - Cin7 calls are sequential to stay inside rate limits.
 *   - Customer + sale lookups are cached per invocation.
 *   - On 3 consecutive errors, a single notice is posted to
 *     config.escalation_webhook (if set).
 *   - Body { dry_run: true } builds alerts and returns them without
 *     posting or recording fingerprints.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  numOr,
  hasDistributorTag,
  fingerprint,
  cin7OrderLink,
  formatCurrency,
  renderStockTable,
} from "../_shared/cin7-helpers.ts";

const CIN7_BASE       = "https://inventory.dearsystems.com/ExternalApi/v2";
const CIN7_ACCOUNT_ID = Deno.env.get("CIN7_ACCOUNT_ID") ?? "";
const CIN7_API_KEY    = Deno.env.get("CIN7_API_KEY") ?? "";
const SUPABASE_URL    = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY     = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SLUG            = "cin7-realtime-alerts";

const sb = createClient(SUPABASE_URL, SERVICE_KEY);

interface AlertSettings {
  enabled:                     boolean;
  ops_webhook:                 string;
  mgmt_webhook:                string;
  escalation_webhook:          string;
  escalation_threshold:        number;
  unauthorised_stuck_days:     number;
  shipped_not_invoiced_hours:  number;
  distributor_order_threshold: number;
  min_margin_percent:          number;
  dedup_window_hours:          number;
}

async function loadSettings(): Promise<AlertSettings> {
  const { data, error } = await sb
    .from("chat_function_settings")
    .select("enabled, config")
    .eq("slug", SLUG)
    .maybeSingle();
  if (error) throw new Error(`settings load failed: ${error.message}`);
  const cfg = data?.config ?? {};
  return {
    enabled:                     !!data?.enabled,
    ops_webhook:                 String(cfg.ops_webhook  ?? ""),
    mgmt_webhook:                String(cfg.mgmt_webhook ?? ""),
    escalation_webhook:          String(cfg.escalation_webhook ?? ""),
    escalation_threshold:        numOr(cfg.escalation_threshold,        3),
    unauthorised_stuck_days:     numOr(cfg.unauthorised_stuck_days,     5),
    shipped_not_invoiced_hours:  numOr(cfg.shipped_not_invoiced_hours,  24),
    distributor_order_threshold: numOr(cfg.distributor_order_threshold, 1000),
    min_margin_percent:          numOr(cfg.min_margin_percent,          20),
    dedup_window_hours:          numOr(cfg.dedup_window_hours,          12),
  };
}

async function recordRun(status: string, summary: Record<string, unknown>) {
  const { data } = await sb.rpc("record_chat_function_run", {
    p_slug: SLUG,
    p_status: status,
    p_summary: summary,
  });
  return Array.isArray(data) ? data[0] : data;
}

async function escalateIfNeeded(escalation: { consecutive_errors: number; config: any } | null, settings: AlertSettings, summary: Record<string, unknown>) {
  if (!escalation) return;
  const threshold = settings.escalation_threshold;
  // Fire exactly when crossing the threshold (avoid spamming on every subsequent failure).
  if (escalation.consecutive_errors !== threshold) return;
  if (!settings.escalation_webhook) return;
  const text = `🚨 *${SLUG}* has failed ${threshold} runs in a row.\nLast summary: \`\`\`${JSON.stringify(summary).slice(0, 800)}\`\`\``;
  await postRaw(settings.escalation_webhook, text);
}

// ─── Cin7 fetch with retry ───────────────────────────────────────────────────

async function cin7Fetch(endpoint: string, params: Record<string, string> = {}, attempt = 1): Promise<any> {
  const query = new URLSearchParams(params).toString();
  const url = `${CIN7_BASE}/${endpoint}${query ? `?${query}` : ""}`;
  const res = await fetch(url, {
    headers: {
      "api-auth-accountid":      CIN7_ACCOUNT_ID,
      "api-auth-applicationkey": CIN7_API_KEY,
      "Content-Type":            "application/json",
    },
  });
  if (res.status === 429 || res.status >= 500) {
    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, 750 * attempt));
      return cin7Fetch(endpoint, params, attempt + 1);
    }
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Cin7 API error ${res.status} on ${endpoint}: ${body.slice(0, 400)}`);
  }
  return res.json();
}

// ─── Per-invocation caches ───────────────────────────────────────────────────

const customerCache = new Map<string, any>();
async function getCustomer(id: string) {
  if (!id) return null;
  if (customerCache.has(id)) return customerCache.get(id);
  const data = await cin7Fetch("customer", { ID: id });
  const customer = data.CustomerList?.[0] ?? data ?? null;
  customerCache.set(id, customer);
  return customer;
}

const saleCache = new Map<string, any>();
async function getSale(id: string) {
  if (!id) return null;
  if (saleCache.has(id)) return saleCache.get(id);
  const data = await cin7Fetch("sale", { ID: id });
  const sale = data.SaleList?.[0] ?? data ?? null;
  saleCache.set(id, sale);
  return sale;
}

async function fetchReorderMap(): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  let page = 1;
  while (page <= 50) {
    const data = await cin7Fetch("product", { Page: String(page), Limit: "100" });
    const items = data.ProductList ?? data.Products ?? [];
    for (const p of items) {
      const sku = p.SKU ?? p.ProductCode;
      const lvl = Number(p.MinimumBeforeReorder ?? p.ReorderLevel ?? 0);
      if (sku && Number.isFinite(lvl) && lvl > 0) map.set(String(sku), lvl);
    }
    if (items.length < 100) break;
    page++;
  }
  return map;
}

// ─── Webhook posting with timeout + dedup ────────────────────────────────────

async function postRaw(webhook: string, text: string): Promise<{ ok: boolean; status?: number }> {
  if (!webhook) return { ok: false, status: 0 };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(webhook, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ text }),
      signal:  ctrl.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`webhook post failed ${res.status}: ${body.slice(0, 200)}`);
    }
    return { ok: res.ok, status: res.status };
  } catch (err) {
    console.error("webhook post threw:", err);
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}

async function postWithDedup(
  webhook: string,
  text: string,
  dedupHours: number,
  dryRun: boolean,
): Promise<"posted" | "duplicate" | "failed" | "dry_run"> {
  const fp = await fingerprint(text);
  if (dedupHours > 0) {
    const cutoff = new Date(Date.now() - dedupHours * 3600 * 1000).toISOString();
    const { data } = await sb
      .from("chat_function_alerts")
      .select("id")
      .eq("slug", SLUG)
      .eq("fingerprint", fp)
      .gte("posted_at", cutoff)
      .limit(1);
    if (data && data.length > 0) return "duplicate";
  }
  if (dryRun) return "dry_run";
  const { ok } = await postRaw(webhook, text);
  if (!ok) return "failed";
  await sb.from("chat_function_alerts").insert({ slug: SLUG, fingerprint: fp });
  return "posted";
}

// ─── Checks ──────────────────────────────────────────────────────────────────

async function checkUnauthorisedOrders(stuckDays: number) {
  const alerts: string[] = [];
  const cutoff = new Date(Date.now() - stuckDays * 24 * 3600 * 1000);
  try {
    const data = await cin7Fetch("saleList", { Status: "DRAFT", Page: "1", Limit: "50" });
    const stuck = (data.SaleList ?? []).filter((o: any) => {
      const d = new Date(o.OrderDate ?? o.LastModifiedOn ?? "");
      return d < cutoff;
    });
    if (stuck.length > 0) {
      const list = stuck.slice(0, 10).map((o: any) =>
        `  • ${o.OrderNumber} — ${o.Customer ?? "Unknown"} ($${(o.Total ?? 0).toFixed(2)})`,
      ).join("\n");
      const more = stuck.length > 10 ? `\n  _(+${stuck.length - 10} more)_` : "";
      alerts.push(`⚠️ *${stuck.length} unauthorised order(s) sitting ${stuckDays}+ days:*\n${list}${more}`);
    }
  } catch (err) {
    console.error("checkUnauthorisedOrders:", err);
  }
  return alerts;
}

async function checkShippedNotInvoiced(stuckHours: number) {
  const alerts: string[] = [];
  const cutoff = new Date(Date.now() - stuckHours * 3600 * 1000);
  try {
    const data = await cin7Fetch("saleList", { Status: "SHIPPED", Page: "1", Limit: "50" });
    const stuck = (data.SaleList ?? []).filter((o: any) => {
      const d = new Date(o.LastModifiedOn ?? o.OrderDate ?? "");
      return d < cutoff;
    });
    if (stuck.length > 0) {
      const list = stuck.slice(0, 10).map((o: any) =>
        `  • ${o.OrderNumber} — ${o.Customer ?? "Unknown"} ($${(o.Total ?? 0).toFixed(2)})`,
      ).join("\n");
      const more = stuck.length > 10 ? `\n  _(+${stuck.length - 10} more)_` : "";
      alerts.push(`🔶 *${stuck.length} order(s) shipped but not invoiced (${stuckHours}+ hours):*\n${list}${more}`);
    }
  } catch (err) {
    console.error("checkShippedNotInvoiced:", err);
  }
  return alerts;
}

// Aggregate Available + OnOrder across all (Location, Bin, Batch) rows for
// each SKU. Cin7 splits availability by location; reorder logic uses the
// "effective" stock (available + on-order) so a SKU with 0 on hand but
// plenty on PO doesn't false-fire.
type Aggregate = { sku: string; available: number; onOrder: number; name: string; productCode?: string };

async function aggregateAvailability(): Promise<Map<string, Aggregate>> {
  const agg = new Map<string, Aggregate>();
  let page = 1;
  while (page <= 50) {
    const data = await cin7Fetch("ref/productavailability", { Page: String(page), Limit: "100" });
    const items = data.ProductAvailabilityList ?? [];
    for (const item of items) {
      const sku = String(item.SKU ?? item.ProductCode ?? "");
      if (!sku) continue;
      const cur = agg.get(sku) ?? { sku, available: 0, onOrder: 0, name: "", productCode: item.ProductCode };
      cur.available += Number(item.Available ?? 0);
      cur.onOrder   += Number(item.OnOrder ?? 0);
      if (!cur.name && item.Name) cur.name = item.Name;
      agg.set(sku, cur);
    }
    if (items.length < 100) break;
    page++;
  }
  return agg;
}

async function checkStockBelowReorder() {
  const alerts: string[] = [];
  try {
    const reorderMap = await fetchReorderMap();
    if (reorderMap.size === 0) return alerts;

    const availability = await aggregateAvailability();
    const belowReorder: any[] = [];
    for (const [sku, a] of availability) {
      const reorderLevel = reorderMap.get(sku) ?? 0;
      const effective    = a.available + a.onOrder;
      if (reorderLevel > 0 && effective < reorderLevel) {
        belowReorder.push({
          SKU: sku, ProductCode: a.productCode, Name: a.name,
          Available: a.available, OnOrder: a.onOrder,
          Effective: effective, ReorderLevel: reorderLevel,
        });
      }
    }
    if (belowReorder.length > 0) {
      const zeroStock = belowReorder.filter((i) => (i.Effective ?? 0) <= 0);
      const lowStock  = belowReorder.filter((i) => (i.Effective ?? 0) >  0);
      lowStock.sort((a, b) => (a.Effective ?? 0) / (a.ReorderLevel ?? 1) - (b.Effective ?? 0) / (b.ReorderLevel ?? 1));
      const sections: string[] = [];
      if (zeroStock.length > 0) {
        sections.push(`🔴 *${zeroStock.length} SKU(s) at zero stock (incl. on-order):*`);
        sections.push(renderStockTable(zeroStock));
      }
      if (lowStock.length > 0) {
        sections.push(`🟡 *${lowStock.length} SKU(s) below minimum:*`);
        sections.push(renderStockTable(lowStock));
      }
      if (sections.length > 0) alerts.push(sections.join("\n"));
    }
  } catch (err) {
    console.error("checkStockBelowReorder:", err);
  }
  return alerts;
}

async function checkDistributorOrders(threshold: number) {
  const alerts: string[] = [];
  const since = new Date(Date.now() - 25 * 60 * 1000); // 25 min: 15-min cron + 10-min overlap
  try {
    const data = await cin7Fetch("saleList", {
      Page: "1", Limit: "50", ModifiedSince: since.toISOString(),
    });
    for (const order of data.SaleList ?? []) {
      if ((order.Total ?? 0) < threshold) continue;
      try {
        const customer = await getCustomer(order.CustomerID);
        if (hasDistributorTag(customer)) {
          const saleId = order.SaleID ?? order.ID ?? "";
          alerts.push(
            `📦 *Distributor order $${formatCurrency(order.Total ?? 0)}*\n` +
            `Customer: ${order.Customer ?? "Unknown"}\n` +
            `Order: ${cin7OrderLink(saleId, order.OrderNumber)}\n` +
            `Status: ${order.Status ?? "Unknown"}`,
          );
        }
      } catch (custErr) {
        console.error(`customer lookup ${order.CustomerID}:`, custErr);
      }
    }
  } catch (err) {
    console.error("checkDistributorOrders:", err);
  }
  return alerts;
}

async function checkLowMarginOrders(minMargin: number) {
  const alerts: string[] = [];
  const since = new Date(Date.now() - 25 * 60 * 1000);
  try {
    const data = await cin7Fetch("saleList", {
      Page: "1", Limit: "50", ModifiedSince: since.toISOString(),
    });
    for (const order of data.SaleList ?? []) {
      if ((order.Total ?? 0) <= 0) continue;
      try {
        const sale = await getSale(order.SaleID ?? order.ID);
        const lines = sale?.Lines ?? sale?.Order?.Lines ?? [];
        let totalRev = 0;
        let totalCost = 0;
        for (const l of lines) {
          totalRev  += (l.Quantity ?? 0) * (l.Price ?? 0);
          totalCost += (l.Quantity ?? 0) * (l.AverageCost ?? l.Cost ?? 0);
        }
        if (totalRev <= 0) continue;
        const marginPercent = ((totalRev - totalCost) / totalRev) * 100;
        if (marginPercent < minMargin) {
          const saleId = order.SaleID ?? order.ID ?? "";
          alerts.push(
            `⚠️ *Low margin order: ${marginPercent.toFixed(1)}%*\n` +
            `Customer: ${order.Customer ?? "Unknown"}\n` +
            `Order: ${cin7OrderLink(saleId, order.OrderNumber)}\n` +
            `Revenue: $${totalRev.toFixed(2)} | Cost: $${totalCost.toFixed(2)}\n` +
            `Status: ${order.Status ?? "Unknown"}`,
          );
        }
      } catch (saleErr) {
        console.error(`sale detail ${order.OrderNumber}:`, saleErr);
      }
    }
  } catch (err) {
    console.error("checkLowMarginOrders:", err);
  }
  return alerts;
}

// ─── Main ────────────────────────────────────────────────────────────────────

serve(async (req) => {
  let dryRun = false;
  try {
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      dryRun = !!body?.dry_run;
    }
  } catch { /* ignore */ }

  let settings: AlertSettings | null = null;
  try {
    settings = await loadSettings();
    if (!settings.enabled) {
      return new Response(JSON.stringify({ status: "skipped", reason: "disabled" }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    if (!CIN7_ACCOUNT_ID || !CIN7_API_KEY) {
      const summary = { error: "credentials_missing" };
      const esc = await recordRun("error", summary);
      await escalateIfNeeded(esc, settings, summary).catch(() => {});
      return new Response(JSON.stringify({ error: "CIN7 credentials not configured" }), {
        status: 500, headers: { "Content-Type": "application/json" },
      });
    }

    const unauthorisedAlerts = await checkUnauthorisedOrders(settings.unauthorised_stuck_days);
    const shippedAlerts      = await checkShippedNotInvoiced(settings.shipped_not_invoiced_hours);
    const distributorAlerts  = await checkDistributorOrders(settings.distributor_order_threshold);
    const marginAlerts       = await checkLowMarginOrders(settings.min_margin_percent);

    const opsAlerts  = [...unauthorisedAlerts, ...shippedAlerts];
    const mgmtAlerts = [...distributorAlerts, ...marginAlerts];
    const checkCounts = {
      unauthorised_built: unauthorisedAlerts.length,
      shipped_built:      shippedAlerts.length,
      distributor_built:  distributorAlerts.length,
      margin_built:       marginAlerts.length,
    };

    const counts = { posted: 0, duplicate: 0, failed: 0, dry_run: 0 };
    for (const text of opsAlerts) {
      const result = await postWithDedup(settings.ops_webhook, text, settings.dedup_window_hours, dryRun);
      counts[result]++;
      if (result === "posted") await new Promise((r) => setTimeout(r, 500));
    }
    for (const text of mgmtAlerts) {
      const result = await postWithDedup(settings.mgmt_webhook, text, settings.dedup_window_hours, dryRun);
      counts[result]++;
      if (result === "posted") await new Promise((r) => setTimeout(r, 500));
    }

    sb.rpc("prune_chat_function_alerts").then(() => {}).catch(() => {});

    const summary = {
      ops_alerts_built:        opsAlerts.length,
      management_alerts_built: mgmtAlerts.length,
      ...checkCounts,
      ...counts,
      dry_run: dryRun,
    };
    await recordRun("ok", summary);

    return new Response(JSON.stringify({ status: "ok", ...summary }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Fatal error in cin7-realtime-alerts:", err);
    const summary = { error: String(err) };
    if (settings) {
      const esc = await recordRun("error", summary).catch(() => null);
      await escalateIfNeeded(esc as any, settings, summary).catch(() => {});
    }
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
});
