import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CIN7_BASE = "https://inventory.dearsystems.com/ExternalApi/v2";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const accountId = Deno.env.get("CIN7_ACCOUNT_ID");
    const apiKey    = Deno.env.get("CIN7_API_KEY");

    if (!accountId || !apiKey) {
      return new Response(
        JSON.stringify({ error: "Cin7 credentials not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { sku } = await req.json();
    if (!sku || sku.trim().length < 2) {
      return new Response(
        JSON.stringify({ products: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const cin7Headers = {
      "api-auth-accountid":      accountId,
      "api-auth-applicationkey": apiKey,
      "Content-Type":            "application/json",
    };

    const res = await fetch(
      `${CIN7_BASE}/product?SKU=${encodeURIComponent(sku.trim())}&Limit=10&Page=1`,
      { headers: cin7Headers }
    );

    if (!res.ok) {
      return new Response(
        JSON.stringify({ products: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await res.json();
    const rawProducts: any[] = data?.Products ?? [];

    const products = rawProducts.map((p: any) => ({
      sku:  p.SKU  ?? "",
      name: p.Name ?? p.Description ?? p.SKU ?? "",
    }));

    return new Response(
      JSON.stringify({ products }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("cin7-product-search error:", err);
    return new Response(
      JSON.stringify({ products: [] }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
