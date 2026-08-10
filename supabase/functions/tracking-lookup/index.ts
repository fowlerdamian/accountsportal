// tracking-lookup — resolve any reference (Shopify order #, Cin7 invoice number,
// Cin7 SO number) to the tracking number(s) on the sale's ship form, with the
// correct carrier tracking link (AusPost or TNT Australia).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CIN7_BASE = "https://inventory.dearsystems.com/ExternalApi/v2";

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
    ? `https://www.tnt.com/express/en_au/site/shipping-tools/tracking.html?searchType=con&cons=${t}`
    : `https://auspost.com.au/mypost/track/details/${t}`;
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

    const { reference: rawRef } = await req.json();
    const reference = (rawRef ?? "").trim().replace(/^#/, "");
    if (!reference) return json({ error: "reference is required" }, 400);

    const cin7Headers = {
      "api-auth-accountid": accountId,
      "api-auth-applicationkey": apiKey,
      "Content-Type": "application/json",
    };

    // saleList Search covers order number, invoice number and customer reference
    const searchRes = await fetch(
      `${CIN7_BASE}/saleList?Search=${encodeURIComponent(reference)}&Limit=20`,
      { headers: cin7Headers }
    );
    if (!searchRes.ok) return json({ found: false, error: `Cin7 search error ${searchRes.status}` });
    const saleList: any[] = (await searchRes.json())?.SaleList ?? [];

    const normalRef = normalize(reference);
    let match = saleList.find((s: any) =>
      [s.OrderNumber, s.SaleOrderNumber, s.InvoiceNumber, s.CustomerReference]
        .filter(Boolean)
        .some((v: string) => normalize(String(v)) === normalRef || String(v).replace(/^#/, "").toLowerCase() === reference.toLowerCase())
    );
    if (!match && saleList.length === 1) match = saleList[0];
    if (!match) return json({ found: false });

    // Full sale detail — the ship form lives under Fulfilments[].Ship.Lines[]
    const saleId = match.SaleID ?? match.ID;
    const saleRes = await fetch(`${CIN7_BASE}/sale?ID=${encodeURIComponent(saleId)}`, { headers: cin7Headers });
    if (!saleRes.ok) return json({ found: false, error: `Cin7 sale error ${saleRes.status}` });
    const saleJson = await saleRes.json();
    const sale = saleJson.Sale ?? saleJson;

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

    return json({
      found: true,
      orderNumber: sale.Order?.SaleOrderNumber ?? match.OrderNumber ?? null,
      tracking: results,
    });
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
