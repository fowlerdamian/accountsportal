/**
 * Cin7 → Google Chat — Daily Stock Warnings Digest
 *
 * Posts a stock warnings summary to the main office chat. Lists every
 * SKU below its Cin7 reorder level (MinimumBeforeReorder), split into
 * zero-stock and low-stock sections.
 *
 * Settings come from `chat_function_settings` row 'cin7-daily-digest':
 *   - enabled                       — master on/off
 *   - config.ops_webhook            — Google Chat webhook URL
 *   - config.max_items_per_section  — max SKUs to list per section (default 15)
 *   - config.escalation_webhook     — pinged on N consecutive failures
 *   - config.escalation_threshold   — N (default 3)
 *
 * Body { dry_run: true } is accepted for previews.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { numOr, renderStockTable } from "../_shared/cin7-helpers.ts";

const CIN7_BASE       = "https://inventory.dearsystems.com/ExternalApi/v2";
const CIN7_ACCOUNT_ID = Deno.env.get("CIN7_ACCOUNT_ID") ?? "";
const CIN7_API_KEY    = Deno.env.get("CIN7_API_KEY") ?? "";
const SUPABASE_URL    = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY     = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SLUG            = "cin7-daily-digest";

const sb = createClient(SUPABASE_URL, SERVICE_KEY);

interface DigestSettings {
  enabled:                boolean;
  ops_webhook:            string;
  escalation_webhook:     string;
  escalation_threshold:   number;
  /** 0 / unset → no cap; all SKUs shown, chunked across messages. */
  max_items_per_section:  number;
}

async function loadSettings(): Promise<DigestSettings> {
  const { data, error } = await sb
    .from("chat_function_settings")
    .select("enabled, config")
    .eq("slug", SLUG)
    .maybeSingle();
  if (error) throw new Error(`settings load failed: ${error.message}`);
  const cfg = data?.config ?? {};
  return {
    enabled:               !!data?.enabled,
    ops_webhook:           String(cfg.ops_webhook ?? ""),
    escalation_webhook:    String(cfg.escalation_webhook ?? ""),
    escalation_threshold:  numOr(cfg.escalation_threshold, 3),
    // 0 or unset = no cap (show every SKU; chunked across messages if needed).
    max_items_per_section: Number(cfg.max_items_per_section ?? 0) || Infinity,
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

async function postRaw(webhook: string, text: string) {
  if (!webhook) {
    console.error("webhook not set — skipping post");
    return { ok: false, status: 0, skipped: true };
  }
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
  } finally {
    clearTimeout(timer);
  }
}

// Google Chat caps a single message body at 4096 chars. Split on line
// boundaries so long digests post as a sequence of messages. The splitter
// is fence-aware: if a chunk ends mid-``` block, we close the fence and
// reopen it at the start of the next chunk so each message renders cleanly.
function chunkMessage(text: string, maxLen = 3800): string[] {
  if (text.length <= maxLen) return [text];
  const lines = text.split("\n");
  const chunks: string[] = [];
  let cur = "";
  let inFence = false;          // fence state after consuming `cur`
  let curStartedInFence = false;

  const flush = () => {
    if (!cur) return;
    chunks.push(inFence ? cur + "\n```" : cur);
    cur = "";
  };

  for (const line of lines) {
    const candidate = cur ? cur + "\n" + line : line;
    if (candidate.length > maxLen && cur) {
      flush();
      if (inFence) { cur = "```\n" + line; curStartedInFence = true; }
      else         { cur = line;             curStartedInFence = false; }
    } else {
      cur = candidate;
    }
    if (line.startsWith("```")) inFence = !inFence;
    void curStartedInFence;
  }
  flush();
  return chunks;
}

async function postChunked(webhook: string, text: string) {
  const chunks = chunkMessage(text);
  if (chunks.length === 1) return postRaw(webhook, chunks[0]);
  const results: any[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const header = `_(part ${i + 1}/${chunks.length})_\n`;
    const r = await postRaw(webhook, header + chunks[i]);
    results.push(r);
    if (i < chunks.length - 1) await new Promise((r) => setTimeout(r, 600));
  }
  const ok = results.every((r) => r.ok);
  return { ok, parts: results.length };
}

async function escalateIfNeeded(
  esc: { consecutive_errors: number } | null,
  settings: DigestSettings,
  summary: Record<string, unknown>,
) {
  if (!esc) return;
  if (esc.consecutive_errors !== settings.escalation_threshold) return;
  if (!settings.escalation_webhook) return;
  const text = `🚨 *${SLUG}* has failed ${settings.escalation_threshold} runs in a row.\nLast summary: \`\`\`${JSON.stringify(summary).slice(0, 800)}\`\`\``;
  await postRaw(settings.escalation_webhook, text);
}

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

// MinimumBeforeReorder lives on /product, not /ref/productavailability.
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

// Cin7 returns one productavailability row per (SKU, Location, Bin, Batch).
// We aggregate Available across all rows for each SKU before comparing
// to its reorder level, otherwise a SKU with stock in the main warehouse
// but a 0-row in another location gets falsely flagged as zero.
type Aggregate = {
  sku: string;
  available: number;
  onOrder: number;
  name: string;
  productCode?: string;
};

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

async function getStockWarnings() {
  const reorderMap = await fetchReorderMap();
  const availability = await aggregateAvailability();
  const zeroStock: any[] = [];
  const lowStock:  any[] = [];

  for (const [sku, a] of availability) {
    const reorderLevel = reorderMap.get(sku) ?? 0;
    if (reorderLevel <= 0) continue;
    // Effective stock includes purchase orders not yet received: a SKU with
    // 0 on hand but plenty on order isn't really "out".
    const effective = a.available + a.onOrder;
    const enriched = {
      SKU: sku, ProductCode: a.productCode, Name: a.name,
      Available: a.available, OnOrder: a.onOrder,
      Effective: effective, ReorderLevel: reorderLevel,
    };
    if (effective <= 0)             zeroStock.push(enriched);
    else if (effective < reorderLevel) lowStock.push(enriched);
  }

  return {
    zeroStock,
    lowStock,
    productsWithReorder: reorderMap.size,
    skusScanned: availability.size,
  };
}

serve(async (req) => {
  let dryRun = false;
  try {
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      dryRun = !!body?.dry_run;
    }
  } catch { /* ignore */ }

  let settings: DigestSettings | null = null;
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
      await escalateIfNeeded(esc as any, settings, summary).catch(() => {});
      return new Response(JSON.stringify({ error: "CIN7 credentials not configured" }), {
        status: 500, headers: { "Content-Type": "application/json" },
      });
    }

    const { zeroStock, lowStock, productsWithReorder, skusScanned } = await getStockWarnings();
    const maxItems = settings.max_items_per_section;

    const today = new Date().toLocaleDateString("en-AU", {
      weekday: "long", day: "numeric", month: "long", year: "numeric",
      timeZone: "Australia/Sydney",
    });

    let messageText: string;
    if (zeroStock.length === 0 && lowStock.length === 0) {
      messageText = `📋 *Stock Report — ${today}*\n✅ All SKUs above reorder levels. No action required.`;
    } else {
      const sections: string[] = [`📋 *Stock Report — ${today}*`];
      if (zeroStock.length > 0) {
        sections.push("");
        sections.push(`🔴 *ZERO STOCK — ${zeroStock.length} SKU(s):*`);
        zeroStock.sort((a, b) => (a.Name ?? "").localeCompare(b.Name ?? ""));
        sections.push(renderStockTable(zeroStock.slice(0, maxItems)));
        if (zeroStock.length > maxItems) sections.push(`_(+${zeroStock.length - maxItems} more at zero)_`);
      }
      if (lowStock.length > 0) {
        sections.push("");
        sections.push(`🟡 *BELOW REORDER LEVEL — ${lowStock.length} SKU(s):*`);
        lowStock.sort((a, b) => (a.Effective ?? 0) / (a.ReorderLevel ?? 1) - (b.Effective ?? 0) / (b.ReorderLevel ?? 1));
        sections.push(renderStockTable(lowStock.slice(0, maxItems)));
        if (lowStock.length > maxItems) sections.push(`_(+${lowStock.length - maxItems} more below reorder)_`);
      }
      sections.push("");
      sections.push(`_Total: ${zeroStock.length} at zero, ${lowStock.length} below reorder level_`);
      messageText = sections.join("\n");
    }

    let post: any = { skipped: true, reason: "dry_run", chars: messageText.length };
    if (!dryRun) post = await postChunked(settings.ops_webhook, messageText);

    const summary = {
      zero_stock: zeroStock.length,
      low_stock:  lowStock.length,
      products_with_reorder: productsWithReorder,
      skus_scanned: skusScanned,
      dry_run:    dryRun,
      post,
    };
    await recordRun("ok", summary);

    return new Response(JSON.stringify({
      status: "ok",
      dry_run: dryRun,
      ...summary,
      preview: dryRun ? messageText : undefined,
    }), { headers: { "Content-Type": "application/json" } });
  } catch (err) {
    console.error("Fatal error in cin7-daily-digest:", err);
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
