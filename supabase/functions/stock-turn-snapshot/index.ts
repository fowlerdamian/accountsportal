// Stock Turn snapshot — records today's stock on hand at cost per product so the
// Accounts › Stock Turn tab can average inventory value over time.
//
//   1. /product (2 pages @ 1000)             → cin7_products (SKU, category, AverageCost)
//   2. /ref/productavailability (@ 1000)     → summed per product across locations/bins
//                                            → cin7_stock_snapshots (one row per product
//                                              per AEST day; products with no stock rows
//                                              are simply absent for that day)
//
// ~4 Cin7 calls. Runs daily via pg_cron (stock-turn-daily, 00:05 AEST) and from
// the shared finance Sync button; re-running on the same day overwrites that
// day's rows. Cheap enough that it never needs the stat-sync lease.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { cin7Fetch } from "../_shared/cin7-client.ts";

type Json = Record<string, unknown>;
const UUID = /^[0-9a-f-]{36}$/i;

async function cin7(path: string, query: Json): Promise<Json> {
  const r = await cin7Fetch(path, { query });
  if (!r.ok) throw new Error(`cin7 ${path}: ${r.error}`);
  return r.data as Json;
}

// Calendar date in Australia/Brisbane (AEST, no DST) — the warehouse's day.
function aestToday(): string {
  return new Date(Date.now() + 10 * 3600_000).toISOString().slice(0, 10);
}

interface ProductRec {
  product_id: string; sku: string; name: string | null; category: string | null;
  brand: string | null; status: string | null; avg_cost: number; updated_at: string;
}
interface SnapRow {
  snapshot_date: string; product_id: string; sku: string | null;
  on_hand: number; available: number; allocated: number; on_order: number; avg_cost: number;
}

serve(async (req) => {
  const started = Date.now();
  let body: Json = {};
  try { body = await req.json(); } catch { /* GET or empty body */ }
  const snapshotDate = typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : aestToday();

  const sc = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const now = new Date().toISOString();

  try {
    // ── 1. Product master ────────────────────────────────────────────────────
    const products = new Map<string, ProductRec>();
    const bySku = new Map<string, string>();
    for (let page = 1; page <= 10; page++) {
      const d = await cin7("/product", { Page: page, Limit: 1000 });
      const items = (d.Products as Json[]) ?? [];
      for (const p of items) {
        const id = String(p.ID ?? "");
        if (!UUID.test(id)) continue;
        const sku = String(p.SKU ?? "");
        products.set(id, {
          product_id: id, sku, name: (p.Name as string) ?? null, category: (p.Category as string) ?? null,
          brand: (p.Brand as string) ?? null, status: (p.Status as string) ?? null,
          avg_cost: Number(p.AverageCost) || 0, updated_at: now,
        });
        if (sku) bySku.set(sku, id);
      }
      if (items.length < 1000) break;
    }
    const prodList = [...products.values()];
    for (let i = 0; i < prodList.length; i += 500) {
      const { error } = await sc.from("cin7_products").upsert(prodList.slice(i, i + 500), { onConflict: "product_id" });
      if (error) throw new Error(`products upsert: ${error.message}`);
    }

    // ── 2. Stock on hand, summed per product ─────────────────────────────────
    const snaps = new Map<string, SnapRow>();
    let availRows = 0, unmatched = 0;
    for (let page = 1; page <= 20; page++) {
      const d = await cin7("/ref/productavailability", { Page: page, Limit: 1000 });
      const items = (d.ProductAvailabilityList as Json[]) ?? [];
      for (const it of items) {
        availRows++;
        const sku = String(it.SKU ?? "");
        const rawId = String(it.ID ?? "");
        const id = UUID.test(rawId) && products.has(rawId) ? rawId : bySku.get(sku);
        if (!id) { unmatched++; continue; }
        let row = snaps.get(id);
        if (!row) {
          row = {
            snapshot_date: snapshotDate, product_id: id, sku: sku || products.get(id)?.sku || null,
            on_hand: 0, available: 0, allocated: 0, on_order: 0, avg_cost: products.get(id)?.avg_cost ?? 0,
          };
          snaps.set(id, row);
        }
        row.on_hand += Number(it.OnHand) || 0;
        row.available += Number(it.Available) || 0;
        row.allocated += Number(it.Allocated) || 0;
        row.on_order += Number(it.OnOrder) || 0;
      }
      if (items.length < 1000) break;
    }
    // Keep only products that actually hold/expect stock — absent rows mean zero.
    const snapList = [...snaps.values()].filter((r) => r.on_hand !== 0 || r.available !== 0 || r.on_order !== 0);

    // Replace the day's snapshot wholesale so products that dropped to zero disappear.
    const del = await sc.from("cin7_stock_snapshots").delete().eq("snapshot_date", snapshotDate);
    if (del.error) throw new Error(`snapshot delete: ${del.error.message}`);
    for (let i = 0; i < snapList.length; i += 500) {
      const { error } = await sc.from("cin7_stock_snapshots").upsert(snapList.slice(i, i + 500), { onConflict: "snapshot_date,product_id" });
      if (error) throw new Error(`snapshot upsert: ${error.message}`);
    }

    const stockValue = snapList.reduce((s, r) => s + r.on_hand * r.avg_cost, 0);
    await sc.from("cin7_stat_sync_state").update({ last_snapshot: now, last_snapshot_error: null }).eq("id", 1);

    return new Response(JSON.stringify({
      ok: true, snapshot_date: snapshotDate, products: prodList.length, availability_rows: availRows,
      unmatched, snapshot_rows: snapList.length, stock_value: Math.round(stockValue), ms: Date.now() - started,
    }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    const msg = String(e);
    console.error("[stock-turn-snapshot]", msg);
    await sc.from("cin7_stat_sync_state").update({ last_snapshot_error: msg }).eq("id", 1);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
});
