import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const ssKey    = Deno.env.get("SHIPSTATION_API_KEY");
    const ssSecret = Deno.env.get("SHIPSTATION_API_SECRET");

    if (!ssKey || !ssSecret) {
      return new Response(
        JSON.stringify({ error: "ShipStation credentials not configured. Set SHIPSTATION_API_KEY and SHIPSTATION_API_SECRET secrets." }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const {
      caseId, caseNumber, caseTitle, actionItemId,
      customerName, phone, address, items,
    } = await req.json();

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const credentials = btoa(`${ssKey}:${ssSecret}`);

    const orderItems = (items ?? []).map((item: any) => ({
      lineItemKey: item.sku ?? item.name,
      name:        item.name ?? item.sku,
      sku:         item.sku  ?? null,
      quantity:    item.quantity ?? 1,
      unitPrice:   item.unitPrice ?? 0,
    }));

    const ssOrder = {
      orderNumber:   `SUPPORT-${caseNumber}`,
      orderDate:     new Date().toISOString(),
      orderStatus:   "awaiting_shipment",
      customerEmail: null,
      billTo: {
        name:    customerName ?? "Customer",
        phone:   phone        ?? null,
        street1: address?.street1  ?? "",
        street2: address?.street2  ?? null,
        city:    address?.city     ?? "",
        state:   address?.state    ?? "",
        postalCode: address?.postalCode ?? "",
        country: address?.country  ?? "AU",
      },
      shipTo: {
        name:    customerName ?? "Customer",
        phone:   phone        ?? null,
        street1: address?.street1  ?? "",
        street2: address?.street2  ?? null,
        city:    address?.city     ?? "",
        state:   address?.state    ?? "",
        postalCode: address?.postalCode ?? "",
        country: address?.country  ?? "AU",
      },
      items: orderItems,
      internalNotes: `Support case: ${caseTitle ?? caseNumber}`,
    };

    const res = await fetch("https://ssapi.shipstation.com/orders/createorder", {
      method: "POST",
      headers: {
        Authorization:  `Basic ${credentials}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(ssOrder),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("ShipStation error:", errText);
      return new Response(
        JSON.stringify({ error: "ShipStation rejected the order", detail: errText }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const ssData = await res.json();

    // Mark action item as dispatched if actionItemId provided
    if (actionItemId) {
      await supabase
        .from("action_items")
        .update({ status: "done", shipstation_order_id: ssData.orderId ?? null })
        .eq("id", actionItemId);
    }

    return new Response(
      JSON.stringify({ ok: true, orderId: ssData.orderId, orderNumber: ssData.orderNumber }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("shipstation-create-order error:", err);
    return new Response(
      JSON.stringify({ error: "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
