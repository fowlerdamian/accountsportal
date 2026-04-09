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

    const { orderNumber } = await req.json();
    if (!orderNumber) {
      return new Response(
        JSON.stringify({ error: "orderNumber is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const cin7Headers = {
      "api-auth-accountid":      accountId,
      "api-auth-applicationkey": apiKey,
      "Content-Type":            "application/json",
    };

    // Search Cin7 SaleList by order number
    const searchRes = await fetch(
      `${CIN7_BASE}/saleList?Search=${encodeURIComponent(orderNumber)}&Limit=5`,
      { headers: cin7Headers }
    );

    if (!searchRes.ok) {
      return new Response(
        JSON.stringify({ found: false, error: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const searchData = await searchRes.json();
    const sales: any[] = searchData?.SaleList ?? [];

    // Match by exact order number (SO number or customer reference)
    const match = sales.find(
      (s: any) =>
        s.SaleOrderNumber?.toLowerCase() === orderNumber.toLowerCase() ||
        s.CustomerReference?.toLowerCase() === orderNumber.toLowerCase()
    ) ?? sales[0];

    if (!match) {
      return new Response(
        JSON.stringify({ found: false }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        found:               true,
        SaleID:              match.ID         ?? match.SaleID ?? null,
        SaleOrderNumber:     match.SaleOrderNumber ?? null,
        Customer:            match.Customer   ?? null,
        OrderDate:           match.SaleOrderDate ?? match.OrderDate ?? null,
        CustomerReference:   match.CustomerReference ?? null,
        Total:               match.Total      ?? null,
        LineCount:           match.TotalQty   ?? null,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("cin7-get-order error:", err);
    return new Response(
      JSON.stringify({ found: false, error: true }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
