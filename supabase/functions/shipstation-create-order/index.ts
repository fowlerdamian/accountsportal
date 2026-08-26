// shipstation-create-order — OUTBOUND: push a Support Hub replacement pick to ShipStation.
//
// Creates (or, via a stable orderKey, updates) an "awaiting_shipment" order and records the
// ShipStation ids on the action item. It does NOT mark the pick dispatched — that happens when
// ShipStation tells us the label was created (see shipstation-webhook), or when the warehouse
// marks it dispatched manually.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireStaff } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

function normalizeCountry(country: string | null | undefined): string {
  if (!country) return "AU";
  const c = country.trim().toLowerCase();
  const map: Record<string, string> = {
    "australia": "AU", "new zealand": "NZ", "united states": "US", "united states of america": "US",
    "usa": "US", "united kingdom": "GB", "great britain": "GB", "canada": "CA",
  };
  if (map[c]) return map[c];
  if (country.trim().length === 2) return country.trim().toUpperCase();
  return country.trim();
}

function normalizeAustralianState(state: string | null | undefined): string {
  if (!state) return "";
  const s = state.trim().toLowerCase();
  const map: Record<string, string> = {
    "new south wales": "NSW", "victoria": "VIC", "queensland": "QLD", "western australia": "WA",
    "south australia": "SA", "tasmania": "TAS", "northern territory": "NT", "australian capital territory": "ACT",
  };
  return map[s] ?? state.trim().toUpperCase();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = await requireStaff(req, corsHeaders);
  if (!auth.ok) return auth.response;

  try {
    const ssKey = Deno.env.get("SHIPSTATION_API_KEY");
    const ssSecret = Deno.env.get("SHIPSTATION_API_SECRET");
    if (!ssKey || !ssSecret) {
      return json({ error: "ShipStation credentials not configured. Set SHIPSTATION_API_KEY and SHIPSTATION_API_SECRET secrets." });
    }

    const {
      caseId, caseNumber, caseTitle, actionItemId,
      customerName, phone, email, address, items, originalOrderNumber, notes,
    } = await req.json();

    if (!caseNumber || !actionItemId) return json({ error: "caseNumber and actionItemId are required" });

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const credentials = btoa(`${ssKey}:${ssSecret}`);

    // Validate the pick before calling out.
    const orderItems = (items ?? [])
      .filter((item: any) => item && (item.sku || item.name))
      .map((item: any) => ({
        lineItemKey: String(item.sku ?? item.name),
        name: String(item.name ?? item.sku),
        sku: item.sku ? String(item.sku) : null,
        quantity: Math.max(1, Number(item.qty ?? item.quantity ?? 1) || 1),
        unitPrice: Number(item.unitPrice ?? 0) || 0,
      }));
    if (orderItems.length === 0) return json({ error: "Pick slip has no items" });

    const country = normalizeCountry(address?.country);
    const state = country === "AU" ? normalizeAustralianState(address?.state) : (address?.state ?? "");
    const missing = [
      !customerName?.trim() && "customer name",
      !address?.street1?.trim() && "street address",
      !address?.city?.trim() && "city/suburb",
      !address?.postalCode?.trim() && "postcode",
      country === "AU" && !state && "state",
    ].filter(Boolean);
    if (missing.length) return json({ error: `Pick slip is missing: ${missing.join(", ")}` });

    const shipAddress = {
      name: customerName.trim(),
      phone: phone?.trim() || null,
      street1: address.street1.trim(),
      street2: address?.street2?.trim() || null,
      city: address.city.trim(),
      state,
      postalCode: String(address.postalCode).trim(),
      country,
      residential: true,
    };

    // A stable orderKey makes re-sends update the same ShipStation order instead of duplicating it.
    const orderKey = `support-${actionItemId}`;
    const ssOrder = {
      orderNumber: `SUPPORT-${caseNumber}`,
      orderKey,
      orderDate: new Date().toISOString(),
      orderStatus: "awaiting_shipment",
      customerEmail: email || null,
      billTo: shipAddress,
      shipTo: shipAddress,
      items: orderItems,
      customerNotes: originalOrderNumber ? `Replacement for order ${originalOrderNumber}` : null,
      internalNotes: [`Support case ${caseNumber}${caseTitle ? ` — ${caseTitle}` : ""}`, notes].filter(Boolean).join("\n"),
      advancedOptions: { customField1: `Case ${caseNumber}`, customField2: originalOrderNumber || "" },
    };

    const res = await fetch("https://ssapi.shipstation.com/orders/createorder", {
      method: "POST",
      headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/json" },
      body: JSON.stringify(ssOrder),
    });
    const raw = await res.text();
    if (!res.ok) {
      console.error("ShipStation error:", res.status, raw);
      let detail = raw;
      try { detail = JSON.parse(raw)?.ExceptionMessage ?? JSON.parse(raw)?.Message ?? raw; } catch { /* keep raw */ }
      return json({ error: `ShipStation rejected the order (${res.status})`, detail: String(detail).slice(0, 300) });
    }
    const ssData = JSON.parse(raw);

    // Record the ShipStation ids — the pick stays open until it actually ships.
    const { error: updErr } = await supabase
      .from("action_items")
      .update({
        shipstation_order_id: ssData.orderId != null ? String(ssData.orderId) : null,
        shipstation_order_number: ssData.orderNumber ?? null,
        shipstation_order_key: orderKey,
      })
      .eq("id", actionItemId);
    if (updErr) console.error("action_items update failed:", updErr.message);

    if (caseId) {
      await supabase.from("case_updates").insert({
        case_id: caseId,
        author_type: "system",
        author_name: auth.email ?? "Warehouse",
        message: `Replacement order sent to ShipStation — ${ssData.orderNumber} (awaiting label)`,
      });
    }

    return json({ ok: true, orderId: ssData.orderId, orderNumber: ssData.orderNumber, orderKey });
  } catch (err) {
    console.error("shipstation-create-order error:", err);
    return json({ error: `Internal error: ${String((err as any)?.message ?? err)}` });
  }
});
