// tracking-lookup — two modes:
//  { reference }            → resolve a Shopify order #, Cin7 invoice number or SO
//                             number to the ship-form tracking number(s) + carrier link.
//  { customer, offset }     → all sales matching a customer/company name, newest
//                             first, 5 per page with order date + tracking links.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CIN7_BASE = "https://inventory.dearsystems.com/ExternalApi/v2";
const PAGE_SIZE = 5;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// Strip leading zeros after an alpha prefix: SO-00123 → so-123
const normalize = (v: string) =>
  v.trim().toLowerCase().replace(/^([a-z]+-?)0+(\d)/, "$1$2");

// TNT AU consignment numbers are purely numeric; AusPost article IDs contain letters.
function carrierFor(tracking: string, shipCarrier: string | null) {
  const c = (shipCarrier ?? "").toLowerCase();
  if (/tnt/.test(c)) return "TNT";
  if (/aus\s*post|auspost|eparcel|startrack/.test(c)) return "AusPost";
  return /^\d+$/.test(tracking.replace(/\s/g, "")) ? "TNT" : "AusPost";
}

function trackingUrl(carrier: string, tracking: string) {
  const t = encodeURIComponent(tracking.replace(/\s/g, ""));
  return carrier === "TNT"
    ? `https://tntexpress.com.au/InterAction/ASPs/CnmHxAS.asp?${t}`
    : `https://auspost.com.au/mypost/track/details/${t}`;
}

// Tracking numbers live on the ship form: Fulfilments[].Ship.Lines[]
function extractTracking(sale: any) {
  const seen = new Set<string>();
  const results: { number: string; carrier: string; url: string }[] = [];
  for (const f of sale.Fulfilments ?? []) {
    const shipLines: any[] = f.Ship?.Lines ?? [];
    const candidates = shipLines.length
      ? shipLines.map((l: any) => ({ tracking: l.TrackingNumber, carrier: l.Carrier ?? l.ShippingCompany ?? null }))
      : [{ tracking: f.TrackingNumber, carrier: f.ShippingCompany ?? null }];
    for (const { tracking, carrier } of candidates) {
      const t = (tracking ?? "").trim();
      if (!t || seen.has(t)) continue;
      seen.add(t);
      const name = carrierFor(t, carrier);
      results.push({ number: t, carrier: name, url: trackingUrl(name, t) });
    }
  }
  return results;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Verify Supabase JWT
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Unauthorized" }, 401);
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: authHeader } } }
  );
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return json({ error: "Unauthorized" }, 401);

  try {
    const accountId = Deno.env.get("CIN7_ACCOUNT_ID");
    const apiKey = Deno.env.get("CIN7_API_KEY");
    if (!accountId || !apiKey) return json({ error: "Cin7 credentials not configured" }, 500);

    const cin7Headers = {
      "api-auth-accountid": accountId,
      "api-auth-applicationkey": apiKey,
      "Content-Type": "application/json",
    };

    const searchSales = async (term: string, limit: number): Promise<any[]> => {
      const res = await fetch(
        `${CIN7_BASE}/saleList?Search=${encodeURIComponent(term)}&Limit=${limit}`,
        { headers: cin7Headers }
      );
      if (!res.ok) throw new Error(`Cin7 search error ${res.status}`);
      return (await res.json())?.SaleList ?? [];
    };

    const fetchSale = async (saleId: string): Promise<any> => {
      const res = await fetch(`${CIN7_BASE}/sale?ID=${encodeURIComponent(saleId)}`, { headers: cin7Headers });
      if (!res.ok) throw new Error(`Cin7 sale error ${res.status}`);
      const j = await res.json();
      return j.Sale ?? j;
    };

    const body = await req.json();

    // ── Customer / company name mode ─────────────────────────────────────────
    if (body.customer) {
      const customer = String(body.customer).trim();
      const offset = Number(body.offset) || 0;
      if (!customer) return json({ error: "customer is required" }, 400);

      const needle = customer.toLowerCase();
      const rows = (await searchSales(customer, 500))
        .filter((s: any) => (s.Customer ?? "").toLowerCase().includes(needle))
        .filter((s: any) => (s.Status ?? "").toUpperCase() !== "VOIDED")
        .sort((a: any, b: any) =>
          String(b.OrderDate ?? b.SaleOrderDate ?? "").localeCompare(String(a.OrderDate ?? a.SaleOrderDate ?? "")));

      const page = rows.slice(offset, offset + PAGE_SIZE);
      const entries = [];
      for (const row of page) {
        let tracking: { number: string; carrier: string; url: string }[] = [];
        try {
          tracking = extractTracking(await fetchSale(row.SaleID ?? row.ID));
        } catch (_) { /* keep the row; show it without tracking */ }
        entries.push({
          orderNumber: row.OrderNumber ?? row.SaleOrderNumber ?? null,
          customer: row.Customer ?? null,
          date: row.OrderDate ?? row.SaleOrderDate ?? null,
          tracking,
        });
      }

      return json({
        found: rows.length > 0,
        total: rows.length,
        hasMore: offset + PAGE_SIZE < rows.length,
        entries,
      });
    }

    // ── Reference mode ───────────────────────────────────────────────────────
    const reference = (body.reference ?? "").trim().replace(/^#/, "");
    if (!reference) return json({ error: "reference or customer is required" }, 400);

    // saleList Search covers order number, invoice number and customer reference
    const saleList = await searchSales(reference, 20);

    const normalRef = normalize(reference);
    let match = saleList.find((s: any) =>
      [s.OrderNumber, s.SaleOrderNumber, s.InvoiceNumber, s.CustomerReference]
        .filter(Boolean)
        .some((v: string) => normalize(String(v)) === normalRef || String(v).replace(/^#/, "").toLowerCase() === reference.toLowerCase())
    );
    if (!match && saleList.length === 1) match = saleList[0];
    if (!match) return json({ found: false });

    const sale = await fetchSale(match.SaleID ?? match.ID);

    return json({
      found: true,
      orderNumber: sale.Order?.SaleOrderNumber ?? match.OrderNumber ?? null,
      tracking: extractTracking(sale),
    });
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
