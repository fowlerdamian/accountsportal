// Diagnostic: why is/isn't a SKU on the daily stock digest?
// GET ?sku=XYZ -> product record (reorder level) + aggregated availability.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const CIN7_BASE = "https://inventory.dearsystems.com/ExternalApi/v2";
const ACCOUNT = Deno.env.get("CIN7_ACCOUNT_ID") ?? "";
const KEY = Deno.env.get("CIN7_API_KEY") ?? "";

async function cin7(endpoint: string, params: Record<string, string>) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${CIN7_BASE}/${endpoint}?${qs}`, {
    headers: { "api-auth-accountid": ACCOUNT, "api-auth-applicationkey": KEY, "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(`${endpoint} ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

serve(async (req) => {
  try {
    const sku = new URL(req.url).searchParams.get("sku") ?? "";
    if (!sku) return new Response(JSON.stringify({ error: "pass ?sku=" }), { status: 400 });

    const prodData = await cin7("product", { Sku: sku, Limit: "10", Page: "1" });
    const products = (prodData.Products ?? prodData.ProductList ?? []).map((p: any) => ({
      SKU: p.SKU, Name: p.Name, Status: p.Status,
      MinimumBeforeReorder: p.MinimumBeforeReorder,
      ReorderQuantity: p.ReorderQuantity,
      DefaultLocation: p.DefaultLocation,
    }));

    // Availability rows for the SKU across all pages (same scan the digest does)
    const rows: any[] = [];
    let page = 1;
    while (page <= 50) {
      const data = await cin7("ref/productavailability", { Page: String(page), Limit: "100" });
      const items = data.ProductAvailabilityList ?? [];
      for (const i of items) {
        if (String(i.SKU ?? i.ProductCode ?? "") === sku) rows.push(i);
      }
      if (items.length < 100) break;
      page++;
    }
    const available = rows.reduce((s, r) => s + (r.Available ?? 0), 0);
    const onOrder = rows.reduce((s, r) => s + (r.OnOrder ?? 0), 0);
    const onHand = rows.reduce((s, r) => s + (r.OnHand ?? 0), 0);

    // Also try exact-SKU availability filter in case the full scan misses it
    const direct = await cin7("ref/productavailability", { Sku: sku, Page: "1", Limit: "100" });

    return new Response(JSON.stringify({
      sku, products,
      scan: { rowsFound: rows.length, available, onOrder, onHand, pagesScanned: page,
        rows: rows.map((r: any) => ({ Location: r.Location, Available: r.Available, OnHand: r.OnHand, OnOrder: r.OnOrder })) },
      directLookup: (direct.ProductAvailabilityList ?? []).map((r: any) => ({ SKU: r.SKU, Location: r.Location, Available: r.Available, OnHand: r.OnHand, OnOrder: r.OnOrder })),
    }, null, 2), { headers: { "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
