import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const shopifyToken = Deno.env.get("SHOPIFY_ACCESS_TOKEN");
    const shopifyStore = Deno.env.get("SHOPIFY_STORE_DOMAIN"); // e.g. mystore.myshopify.com

    if (!shopifyToken || !shopifyStore) {
      return new Response(
        JSON.stringify({ found: false, error: true, message: "Shopify credentials not configured. Set SHOPIFY_ACCESS_TOKEN and SHOPIFY_STORE_DOMAIN secrets." }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { customerReference } = await req.json();
    if (!customerReference) {
      return new Response(
        JSON.stringify({ found: false }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Search Shopify orders by name (order number) or customer reference
    const query = encodeURIComponent(customerReference);
    const res = await fetch(
      `https://${shopifyStore}/admin/api/2024-01/orders.json?name=${query}&status=any&limit=5`,
      {
        headers: {
          "X-Shopify-Access-Token": shopifyToken,
          "Content-Type": "application/json",
        },
      }
    );

    if (!res.ok) {
      return new Response(
        JSON.stringify({ found: false, error: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await res.json();
    const orders: any[] = data.orders ?? [];
    const order = orders[0];

    if (!order) {
      return new Response(
        JSON.stringify({ found: false }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const fulfilments = (order.fulfillments ?? []).map((f: any) => ({
      tracking_company: f.tracking_company ?? null,
      tracking_number:  f.tracking_number  ?? null,
      tracking_url:     f.tracking_url     ?? null,
    }));

    return new Response(
      JSON.stringify({
        found:             true,
        shopify_order_url: `https://${shopifyStore}/admin/orders/${order.id}`,
        order_name:        order.name ?? null,
        financial_status:  order.financial_status ?? null,
        fulfillment_status: order.fulfillment_status ?? null,
        total_price:       order.total_price ? parseFloat(order.total_price) : null,
        currency:          order.currency ?? null,
        created_at:        order.created_at ?? null,
        customer: order.customer ? {
          name:  `${order.customer.first_name ?? ""} ${order.customer.last_name ?? ""}`.trim() || null,
          email: order.customer.email ?? null,
          phone: order.customer.phone ?? null,
        } : null,
        shipping_address: order.shipping_address ? {
          name:     order.shipping_address.name     ?? null,
          address1: order.shipping_address.address1 ?? null,
          address2: order.shipping_address.address2 ?? null,
          city:     order.shipping_address.city     ?? null,
          province: order.shipping_address.province ?? null,
          zip:      order.shipping_address.zip      ?? null,
          country:  order.shipping_address.country  ?? null,
        } : null,
        line_items: (order.line_items ?? []).map((li: any) => ({
          title:         li.title ?? "",
          sku:           li.sku   ?? null,
          quantity:      li.quantity ?? 0,
          unit_price:    li.price ? parseFloat(li.price) : null,
          currency:      order.currency ?? null,
          variant_title: li.variant_title ?? null,
        })),
        fulfilments,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("shopify-get-order error:", err);
    return new Response(
      JSON.stringify({ found: false, error: true }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
