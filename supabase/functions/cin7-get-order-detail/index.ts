import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const CIN7_BASE = "https://inventory.dearsystems.com/ExternalApi/v2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const cin7AccountId = Deno.env.get("CIN7_ACCOUNT_ID");
    const cin7ApiKey    = Deno.env.get("CIN7_API_KEY");

    if (!cin7AccountId || !cin7ApiKey) {
      return new Response(
        JSON.stringify({ error: "CIN7_ACCOUNT_ID and CIN7_API_KEY secrets are not set" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body = await req.json();
    const { saleId, orderNumber } = body;

    if (!saleId && !orderNumber) {
      return new Response(
        JSON.stringify({ error: "saleId or orderNumber is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const cin7Headers = {
      "api-auth-accountid":      cin7AccountId,
      "api-auth-applicationkey": cin7ApiKey,
      "Content-Type":            "application/json",
    };

    let resolvedSaleId = saleId;

    // If saleId looks like an SO number (not a UUID), or orderNumber is provided, search first
    const input = orderNumber || saleId;
    const isSONumber = /^SO-/i.test(input) || !/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(input);

    if (isSONumber) {
      // Search by order number via saleList endpoint
      const searchRes = await fetch(
        `${CIN7_BASE}/saleList?Search=${encodeURIComponent(input)}&Limit=20`,
        { headers: cin7Headers },
      );

      if (!searchRes.ok) {
        const text = await searchRes.text();
        return new Response(
          JSON.stringify({ found: false, error: `Cin7 search error ${searchRes.status}`, detail: text.substring(0, 300) }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const searchData = await searchRes.json();
      const saleList = searchData.SaleList ?? [];

      // Normalize for loose matching (strip leading zeros: SO-00123 → SO-123)
      const normalize = (v: string) => v.toLowerCase().replace(/^([a-z]+-?)0+(\d)/, "$1$2");
      const normalInput = normalize(input);

      const match = saleList.find((s: any) => {
        const on = s.OrderNumber ?? s.SaleOrderNumber ?? "";
        return (
          on.toLowerCase() === input.toLowerCase() ||
          normalize(on) === normalInput
        );
      });

      if (!match) {
        return new Response(
          JSON.stringify({ found: false, error: `No order found matching "${input}"` }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      resolvedSaleId = match.SaleID ?? match.ID;
    }

    // Fetch full sale details by GUID
    const res = await fetch(`${CIN7_BASE}/sale?ID=${encodeURIComponent(resolvedSaleId)}`, {
      headers: cin7Headers,
    });

    if (!res.ok) {
      const text = await res.text();
      return new Response(
        JSON.stringify({ found: false, error: `Cin7 API error ${res.status}`, detail: text.substring(0, 500) }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const json = await res.json();
    const sale = json.Sale ?? json;

    if (!sale || !sale.ID) {
      return new Response(
        JSON.stringify({ found: false }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Extract fulfilment
    const fulfilments: any[] = sale.Fulfilments ?? sale.SaleOrderFulfilments ?? [];
    const firstFulfilment = fulfilments[0] ?? null;

    // Extract invoice
    const invoices: any[] = sale.Invoices ?? sale.SaleInvoices ?? [];
    const firstInvoice = invoices[0] ?? null;

    // Extract line items
    const lines: any[] = sale.Lines ?? sale.SaleOrderLines ?? [];

    const result = {
      found:              true,
      SaleID:             sale.ID,
      SaleOrderNumber:    sale.OrderNumber      ?? sale.SaleOrderNumber ?? null,
      Customer:           sale.Customer          ?? null,
      OrderDate:          sale.OrderDate         ?? null,
      CustomerReference:  sale.CustomerReference ?? sale.CustomerRef ?? null,
      Note:               sale.Note              ?? sale.Memo ?? null,
      Lines: lines.map((l: any) => ({
        SKU:      l.SKU      ?? l.Sku      ?? null,
        Name:     l.Name     ?? l.ProductName ?? null,
        Quantity: l.Quantity ?? l.Qty      ?? null,
        Price:    l.Price    ?? l.UnitPrice ?? null,
        Total:    l.Total    ?? (l.Quantity && l.Price ? l.Quantity * l.Price : null),
      })),
      ShippingAddress: sale.ShippingAddress ? {
        Line1:    sale.ShippingAddress.Line1     ?? null,
        Line2:    sale.ShippingAddress.Line2     ?? null,
        City:     sale.ShippingAddress.City      ?? null,
        State:    sale.ShippingAddress.State     ?? null,
        Postcode: sale.ShippingAddress.Postcode  ?? null,
        Country:  sale.ShippingAddress.Country   ?? null,
      } : null,
      Fulfilment: firstFulfilment ? {
        ShippingCompany: firstFulfilment.ShippingCompany ?? firstFulfilment.CarrierName ?? null,
        TrackingNumber:  firstFulfilment.TrackingNumber  ?? firstFulfilment.Tracking    ?? null,
        ShipmentDate:    firstFulfilment.ShipmentDate    ?? firstFulfilment.Date         ?? null,
      } : null,
      Invoice: firstInvoice ? {
        InvoiceNumber: firstInvoice.InvoiceNumber ?? firstInvoice.Number ?? null,
        Total:         firstInvoice.Total         ?? firstInvoice.Amount ?? null,
      } : null,
      last_refreshed: new Date().toISOString(),
    };

    return new Response(
      JSON.stringify(result),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
