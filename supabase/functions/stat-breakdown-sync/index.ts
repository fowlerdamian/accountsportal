// Stat Breakdown sync — rolls Cin7 invoiced sales into cin7_sale_stat_lines
// (one row per sale x invoice-month x product bucket, tagged with the
// customer type) for the Accounts › Stat Breakdown tab.
//
// Segments:
//   Customer type — Cin7 customer Tags: A→Bespoke, D→Distributors, F→Fleet,
//                   anything else (incl. Shopify junk tags / no tag)→Consumers.
//   Product bucket — Cin7 product Category mapped to leaf buckets: Lighting,
//                    Behind Grille Lighting, Electrical (the UI groups these
//                    three under an Electrical parent), Communication(s)→
//                    Communication, Storage, Safety, everything else→Other.
//
// Figures: invoice lines only (AdditionalCharges like freight excluded).
//   revenue = line Total (GST-exclusive, net of discount)
//   cost    = Quantity x AverageCost (captured by Cin7 at invoice time)
//   Credit notes subtract both revenue and cost in the credit note's month.
//
// Two-phase worker, safe to invoke repeatedly (pg_cron hourly + manual Sync):
//   scan  — saleList since the Updated cursor → queue changed sales in
//           cin7_stat_pending (backfill=true seeds every sale since START).
//   drain — pull sale details for queued sales until the time budget runs out,
//           rewrite their stat lines, and report how many remain.
//
// The same drain also writes per-product invoice lines (cin7_sale_product_lines:
// sale x month x product, qty/revenue/cost) for the Stock Turn tab, so one Cin7
// sale fetch feeds both reports.
//
// POST body (all optional): { "backfill": true, "drainMs": 100000 }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { cin7Fetch } from "../_shared/cin7-client.ts";

const START = "2025-01-01"; // earliest invoice month reported
const DEFAULT_DRAIN_MS = 100_000; // stay under the edge-function wall clock
const SCAN_OVERLAP_MS = 10 * 60_000; // re-scan overlap so no update is missed
const CHUNK_MIN_MS = 3_300; // 3 sale fetches per chunk → ~55 calls/min (Cin7 allows 60)

type Json = Record<string, unknown>;

function customerType(tags: unknown): string {
  const parts = String(tags ?? "").split(",").map((t) => t.trim().toUpperCase());
  if (parts.includes("A")) return "Bespoke";
  if (parts.includes("D")) return "Distributors";
  if (parts.includes("F")) return "Fleet";
  return "Consumers";
}

function bucketOf(category: string | undefined): string {
  switch ((category ?? "").trim().toLowerCase()) {
    case "lighting":
      return "Lighting";
    case "behind-grille light bars":
      return "Behind Grille Lighting";
    case "electrical":
      return "Electrical";
    case "communication":
    case "communications":
      return "Communication";
    case "storage":
      return "Storage";
    case "safety":
      return "Safety";
    default:
      return "Other";
  }
}

async function cin7(path: string, query: Json): Promise<Json> {
  const r = await cin7Fetch(path, { query });
  if (!r.ok) throw new Error(`cin7 ${path}: ${r.error}`);
  return r.data as Json;
}

// ProductID → bucket for every product (~2 calls at 1000/page)
async function loadProductBuckets(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (let page = 1; page <= 10; page++) {
    const d = await cin7("/product", { Page: page, Limit: 1000 });
    const items = (d.Products as Json[]) ?? [];
    for (const p of items) map.set(String(p.ID), bucketOf(p.Category as string));
    if (items.length < 1000) break;
  }
  return map;
}

// CustomerID → customer type (~8 calls at 1000/page)
async function loadCustomerTypes(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (let page = 1; page <= 25; page++) {
    const d = await cin7("/customer", { Page: page, Limit: 1000 });
    const items = (d.CustomerList as Json[]) ?? [];
    for (const c of items) map.set(String(c.ID), customerType(c.Tags));
    if (items.length < 1000) break;
  }
  return map;
}

const MAP_TTL_MS = 12 * 60 * 60_000;

// Lookup maps cached in cin7_stat_maps for 12h — new/unknown ids fall back to
// sensible defaults (Consumers / Other) so a stale cache never blocks a sale.
// deno-lint-ignore no-explicit-any
async function cachedMap(sc: any, key: string, load: () => Promise<Map<string, string>>): Promise<Map<string, string>> {
  const { data } = await sc.from("cin7_stat_maps").select("payload, fetched_at").eq("key", key).maybeSingle();
  if (data && Date.now() - new Date(data.fetched_at).getTime() < MAP_TTL_MS) {
    return new Map(Object.entries(data.payload as Record<string, string>));
  }
  const map = await load();
  await sc.from("cin7_stat_maps").upsert({
    key, payload: Object.fromEntries(map), fetched_at: new Date().toISOString(),
  });
  return map;
}

interface StatRow {
  sale_id: string;
  invoice_month: string;
  customer_type: string;
  bucket: string;
  revenue: number;
  cost: number;
}

interface ProductRow {
  sale_id: string;
  invoice_month: string;
  product_id: string;
  sku: string | null;
  qty: number;
  revenue: number;
  cost: number;
}

function monthOf(dateStr: unknown): string | null {
  const s = String(dateStr ?? "");
  if (!/^\d{4}-\d{2}/.test(s)) return null;
  const m = `${s.slice(0, 7)}-01`;
  return m >= START ? m : null;
}

const DOC_SKIP = new Set(["DRAFT", "VOIDED", "NOT AVAILABLE"]);

function saleToRows(sale: Json, ctype: string, buckets: Map<string, string>): { stat: StatRow[]; product: ProductRow[] } {
  const saleId = String(sale.ID);
  const acc = new Map<string, StatRow>();
  const prod = new Map<string, ProductRow>();
  const add = (month: string, line: Json, sign: 1 | -1) => {
    const qty = sign * (Number(line.Quantity) || 0);
    const revenue = sign * (Number(line.Total) || 0);
    const cost = qty * (Number(line.AverageCost) || 0);
    const pid = String(line.ProductID ?? "");
    const bucket = buckets.get(pid) ?? "Other";
    const key = `${month}|${bucket}`;
    let row = acc.get(key);
    if (!row) {
      row = { sale_id: saleId, invoice_month: month, customer_type: ctype, bucket, revenue: 0, cost: 0 };
      acc.set(key, row);
    }
    row.revenue += revenue;
    row.cost += cost;
    // Per-product line (Stock Turn) — lines without a product (services/charges) skipped
    if (/^[0-9a-f-]{36}$/i.test(pid)) {
      const pkey = `${month}|${pid}`;
      let pr = prod.get(pkey);
      if (!pr) {
        pr = { sale_id: saleId, invoice_month: month, product_id: pid, sku: line.SKU ? String(line.SKU) : null, qty: 0, revenue: 0, cost: 0 };
        prod.set(pkey, pr);
      }
      pr.qty += qty;
      pr.revenue += revenue;
      pr.cost += cost;
    }
  };
  for (const inv of (sale.Invoices as Json[]) ?? []) {
    if (DOC_SKIP.has(String(inv.Status ?? "").toUpperCase())) continue;
    const month = monthOf(inv.InvoiceDate);
    if (!month) continue;
    for (const l of (inv.Lines as Json[]) ?? []) add(month, l, 1);
  }
  // Credit notes reverse revenue and (assuming restock) cost in their own month.
  for (const cn of (sale.CreditNotes as Json[]) ?? []) {
    if (DOC_SKIP.has(String(cn.Status ?? "").toUpperCase())) continue;
    const month = monthOf(cn.CreditNoteDate ?? cn.CreditNoteInvoiceDate ?? cn.InvoiceDate);
    if (!month) continue;
    for (const l of (cn.Lines as Json[]) ?? []) add(month, l, -1);
  }
  return { stat: [...acc.values()], product: [...prod.values()] };
}

serve(async (req) => {
  const started = Date.now();
  let body: Json = {};
  try { body = await req.json(); } catch { /* GET or empty body */ }
  const backfill = body.backfill === true;
  const deadline = started + Math.min(Number(body.drainMs) || DEFAULT_DRAIN_MS, 130_000);

  const sc = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const fail = async (msg: string, extra: Json = {}) => {
    console.error("[stat-breakdown]", msg);
    await sc.from("cin7_stat_sync_state").update({ last_run: new Date().toISOString(), last_error: msg }).eq("id", 1);
    return new Response(JSON.stringify({ ok: false, error: msg, ...extra }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  };

  // Run lease: only one sync at a time. Overlapping invocations (cron vs the
  // manual Sync button) otherwise fight over Cin7's 60/min quota. A crashed
  // run's lease simply expires.
  const { data: leased } = await sc.from("cin7_stat_sync_state")
    .update({ running_until: new Date(deadline + 90_000).toISOString() })
    .eq("id", 1)
    .or(`running_until.is.null,running_until.lt.${new Date().toISOString()}`)
    .select("id");
  if (!leased?.length) {
    return new Response(JSON.stringify({ ok: true, skipped: "another sync run is active" }), {
      headers: { "Content-Type": "application/json" },
    });
  }
  const releaseLease = () => sc.from("cin7_stat_sync_state").update({ running_until: null }).eq("id", 1);

  try {
    const { data: state } = await sc.from("cin7_stat_sync_state").select("*").eq("id", 1).single();

    // ── Scan: queue new/updated sales ────────────────────────────────────────
    let queued = 0;
    const scanFrom = backfill || !state?.backfill_seeded
      ? null // full history
      : new Date(new Date(state.cursor_updated ?? "2000-01-01").getTime() - SCAN_OVERLAP_MS);
    let maxUpdated = state?.cursor_updated ?? "2000-01-01";
    for (let page = 1; page <= 40; page++) {
      const q: Json = { Page: page, Limit: 500 };
      if (scanFrom) q.UpdatedSince = scanFrom.toISOString();
      const d = await cin7("/saleList", q);
      const items = (d.SaleList as Json[]) ?? [];
      const ids = items
        .filter((s) => String(s.Status).toUpperCase() !== "VOIDED")
        // only sales that touch the reporting window (invoice or credit note)
        .filter((s) => String(s.InvoiceDate ?? "") >= START || String(s.CreditNoteNumber ?? "") !== "")
        .map((s) => ({ sale_id: String(s.SaleID) }));
      if (ids.length) {
        const { error } = await sc.from("cin7_stat_pending").upsert(ids, { onConflict: "sale_id" });
        if (error) throw new Error(`queue upsert: ${error.message}`);
        queued += ids.length;
      }
      for (const s of items) {
        const u = String(s.Updated ?? "");
        if (u > maxUpdated) maxUpdated = u;
      }
      if (items.length < 500) break;
    }

    // ── Maps (9-ish cheap calls) — only when there is work to do ─────────────
    const { count: pendingBefore } = await sc.from("cin7_stat_pending").select("*", { count: "exact", head: true });
    let processed = 0;
    if ((pendingBefore ?? 0) > 0) {
      const buckets = await cachedMap(sc, "products", loadProductBuckets);
      const ctypes = await cachedMap(sc, "customers", loadCustomerTypes);

      // ── Drain until the time budget runs out ───────────────────────────────
      // Details fetched 3-at-a-time (DEAR's concurrency cap); DB writes batched
      // per chunk so Cin7's 60/min rate limit is the only throughput ceiling.
      while (Date.now() < deadline) {
        const { data: batch, error } = await sc.from("cin7_stat_pending")
          .select("sale_id").order("queued_at").limit(21);
        if (error) throw new Error(`pending read: ${error.message}`);
        if (!batch?.length) break;
        const doneIds: string[] = [];
        const rows: StatRow[] = [];
        const prodRows: ProductRow[] = [];
        for (let i = 0; i < batch.length && Date.now() < deadline; i += 3) {
          const chunk = batch.slice(i, i + 3);
          // Pace to stay under Cin7's 60 calls/min, and ride out a 429 instead of
          // failing the whole run — unfetched sales simply stay queued.
          const chunkStart = Date.now();
          let sales: Json[];
          try {
            sales = await Promise.all(chunk.map(({ sale_id }) => cin7("/sale", { ID: sale_id })));
          } catch (e) {
            if (!/60 calls|rate.?limit/i.test(String(e))) throw e;
            console.warn("[stat-breakdown] Cin7 rate limit hit — pausing 20s");
            await new Promise((r) => setTimeout(r, 20_000));
            i -= 3; // retry this chunk
            continue;
          }
          for (const sale of sales) {
            const ctype = ctypes.get(String(sale.CustomerID)) ?? "Consumers";
            const r = saleToRows(sale, ctype, buckets);
            rows.push(...r.stat);
            prodRows.push(...r.product);
            doneIds.push(String(sale.ID));
          }
          const wait = CHUNK_MIN_MS - (Date.now() - chunkStart);
          if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        }
        if (!doneIds.length) break;
        const del = await sc.from("cin7_sale_stat_lines").delete().in("sale_id", doneIds);
        if (del.error) throw new Error(`lines delete: ${del.error.message}`);
        if (rows.length) {
          // Upsert: overlapping runs (hourly cron vs drain cron) may process the
          // same sale — both compute identical rows, so last-write-wins is safe.
          const ins = await sc.from("cin7_sale_stat_lines")
            .upsert(rows, { onConflict: "sale_id,invoice_month,bucket" });
          if (ins.error) throw new Error(`lines upsert: ${ins.error.message}`);
        }
        const pdel = await sc.from("cin7_sale_product_lines").delete().in("sale_id", doneIds);
        if (pdel.error) throw new Error(`product lines delete: ${pdel.error.message}`);
        if (prodRows.length) {
          const pins = await sc.from("cin7_sale_product_lines")
            .upsert(prodRows, { onConflict: "sale_id,invoice_month,product_id" });
          if (pins.error) throw new Error(`product lines upsert: ${pins.error.message}`);
        }
        const dq = await sc.from("cin7_stat_pending").delete().in("sale_id", doneIds);
        if (dq.error) throw new Error(`dequeue: ${dq.error.message}`);
        processed += doneIds.length;
      }
    }

    const { count: pending } = await sc.from("cin7_stat_pending").select("*", { count: "exact", head: true });
    await sc.from("cin7_stat_sync_state").update({
      cursor_updated: maxUpdated,
      backfill_seeded: true,
      last_run: new Date().toISOString(),
      last_error: null,
      running_until: null,
    }).eq("id", 1);

    return new Response(JSON.stringify({
      ok: true, queued, processed, pending: pending ?? 0, ms: Date.now() - started,
    }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    await releaseLease();
    return await fail(String(e));
  }
});
