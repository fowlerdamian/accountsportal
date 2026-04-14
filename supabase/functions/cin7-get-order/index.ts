import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CIN7_BASE = "https://inventory.dearsystems.com/ExternalApi/v2";

/** Normalize SO numbers for loose matching: strip leading zeros after prefix.
 *  "SO-00123" → "so-123", "SO-123" → "so-123" */
function normalizeOrderNum(s: string): string {
  return s.toLowerCase().replace(/^([a-z]+-?)0+(\d)/, "$1$2");
}

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

    const normalInput = normalizeOrderNum(orderNumber);

    function findMatch(sales: any[]): any {
      return sales.find((s: any) => {
        const on  = s.OrderNumber ?? s.SaleOrderNumber ?? "";
        const cr  = s.CustomerReference ?? "";
        return (
          on.toLowerCase()  === orderNumber.toLowerCase() ||
          normalizeOrderNum(on)  === normalInput ||
          cr.toLowerCase()  === orderNumber.toLowerCase()
        );
      });
    }

    async function searchCin7(param: string, value: string): Promise<any[]> {
      const url = `${CIN7_BASE}/saleList?${param}=${encodeURIComponent(value)}&Limit=20`;
      const res = await fetch(url, { headers: cin7Headers });
      if (!res.ok) {
        console.error("Cin7 error:", res.status, param, value);
        return [];
      }
      const data = await res.json();
      return data?.SaleList ?? [];
    }

    // Phase 1 — broad text search
    const searchSales = await searchCin7("Search", orderNumber);
    console.log("Search results:", searchSales.length);
    let match = findMatch(searchSales);

    // Phase 2 — if no match, try direct OrderNumber filter
    if (!match) {
      const onSales = await searchCin7("OrderNumber", orderNumber);
      console.log("OrderNumber results:", onSales.length);
      match = findMatch(onSales);

      // Phase 3 — if still no match but exactly one result, use it (direct filter is unambiguous)
      if (!match && onSales.length === 1) {
        match = onSales[0];
      }
    }

    if (!match) {
      return new Response(
        JSON.stringify({ found: false }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        found:             true,
        SaleID:            match.ID           ?? match.SaleID          ?? null,
        SaleOrderNumber:   match.SaleOrderNumber ?? match.OrderNumber  ?? null,
        Customer:          match.Customer     ?? null,
        OrderDate:         match.SaleOrderDate ?? match.OrderDate      ?? null,
        CustomerReference: match.CustomerReference                     ?? null,
        Total:             match.Total        ?? null,
        LineCount:         match.TotalQty     ?? null,
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
