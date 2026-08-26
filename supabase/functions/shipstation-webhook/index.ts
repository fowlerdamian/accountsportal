// shipstation-webhook — INBOUND: ShipStation → Support Hub.
//
// When a label is created for a SUPPORT-<case> order, ShipStation POSTs a SHIP_NOTIFY event
// ({ resource_url, resource_type }). We never trust the payload: we fetch resource_url (which
// must be on ssapi.shipstation.com) with our own credentials, then for every shipment that
// matches a replacement pick:
//   • action_items: dispatched_at, status=done, shipstation_shipment_id, tracking
//   • cases: replacement_tracking_number / carrier / ship_date  (DB trigger → In hand)
//   • case_updates system note + Google Chat notification
//
// Staff/cron actions (POST JSON, staff JWT or service key):
//   { action: "sync" }    — poll ShipStation for shipments of open picks (backup for the webhook, cron every 30 min)
//   { action: "setup" }   — register the SHIP_NOTIFY webhook pointing at this function (idempotent)
//   { action: "status" }  — list webhooks + open picks awaiting shipment
// Deploy with --no-verify-jwt (ShipStation cannot send a Supabase JWT).

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireStaff } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const SS = "https://ssapi.shipstation.com";
const PORTAL_URL = "https://app.automotivegroup.com.au";

function ssAuth() {
  const key = Deno.env.get("SHIPSTATION_API_KEY"), secret = Deno.env.get("SHIPSTATION_API_SECRET");
  if (!key || !secret) throw new Error("SHIPSTATION_API_KEY / SHIPSTATION_API_SECRET not configured");
  return { Authorization: `Basic ${btoa(`${key}:${secret}`)}`, "Content-Type": "application/json" };
}
async function ssGet(pathOrUrl: string) {
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${SS}${pathOrUrl}`;
  if (!url.startsWith(SS + "/")) throw new Error(`Refusing to fetch non-ShipStation URL: ${url}`);
  const res = await fetch(url, { headers: ssAuth() });
  if (!res.ok) throw new Error(`ShipStation GET ${url} → ${res.status} ${await res.text()}`);
  return res.json();
}

// Carrier codes as the Support Hub panel + reship follow-up understand them.
function normaliseCarrier(code: string | null | undefined, name?: string | null): string | null {
  const c = (code ?? name ?? "").toLowerCase();
  if (!c) return null;
  if (c.includes("auspost") || c.includes("australia_post") || c.includes("australia post") || c.includes("stamps_au")) return "australia_post";
  if (c.includes("startrack")) return "startrack";
  if (c.includes("tnt")) return "tnt_australia";
  if (c.includes("sendle")) return "sendle";
  if (c.includes("couriers") && c.includes("please")) return "couriers_please";
  if (c.includes("aramex") || c.includes("fastway")) return "aramex";
  return code ?? name ?? null;
}

async function notifyChat(text: string) {
  try {
    await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/notify-google-chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: Deno.env.get("SUPABASE_ANON_KEY") ?? "", Authorization: `Bearer ${Deno.env.get("SUPABASE_ANON_KEY") ?? ""}` },
      body: JSON.stringify({ text }),
    });
  } catch (e) { console.error("notify-google-chat failed:", e); }
}

type Shipment = {
  shipmentId: number; orderId: number; orderNumber: string; orderKey?: string; trackingNumber: string | null;
  carrierCode: string | null; serviceCode?: string | null; shipDate: string | null; voided?: boolean;
};

/** Apply one ShipStation shipment to its replacement pick. Returns what happened. */
async function applyShipment(db: SupabaseClient, sh: Shipment): Promise<string> {
  if (sh.voided) return "voided";
  if (!sh.trackingNumber) return "no tracking";

  // Match by orderId first (most reliable), then orderKey, then orderNumber.
  let q = db.from("action_items").select("id, case_id, dispatched_at, shipstation_shipment_id, cases(case_number, customer_name, title)").eq("is_replacement_pick", true);
  const { data: byId } = await q.eq("shipstation_order_id", String(sh.orderId)).limit(1);
  let item = byId?.[0];
  if (!item && sh.orderKey) {
    const { data } = await db.from("action_items").select("id, case_id, dispatched_at, shipstation_shipment_id, cases(case_number, customer_name, title)").eq("shipstation_order_key", sh.orderKey).limit(1);
    item = data?.[0];
  }
  if (!item && sh.orderNumber) {
    const { data } = await db.from("action_items").select("id, case_id, dispatched_at, shipstation_shipment_id, cases(case_number, customer_name, title)").eq("shipstation_order_number", sh.orderNumber).limit(1);
    item = data?.[0];
  }
  if (!item) return `no pick for ${sh.orderNumber}`;
  if (item.shipstation_shipment_id === String(sh.shipmentId)) return "already applied";

  const carrier = normaliseCarrier(sh.carrierCode);
  const shipDate = sh.shipDate ? sh.shipDate.slice(0, 10) : new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();

  await db.from("action_items").update({
    status: "done",
    completed_at: item.dispatched_at ?? now,
    dispatched_at: item.dispatched_at ?? now,
    shipstation_shipment_id: String(sh.shipmentId),
    shipstation_order_id: String(sh.orderId),
    shipstation_order_number: sh.orderNumber,
    warehouse_result: `Shipped via ${carrier ?? sh.carrierCode ?? "carrier"} — ${sh.trackingNumber}`,
  }).eq("id", item.id);

  if (item.case_id) {
    // Setting replacement_tracking_number fires the case trigger → In hand.
    await db.from("cases").update({
      replacement_tracking_number: sh.trackingNumber,
      replacement_carrier: carrier,
      replacement_ship_date: shipDate,
      replacement_tracked_at: now,
    }).eq("id", item.case_id);
    await db.from("case_updates").insert({
      case_id: item.case_id, author_type: "system", author_name: "ShipStation",
      message: `Replacement shipped — ${carrier ?? sh.carrierCode ?? "carrier"} ${sh.trackingNumber} (SS ${sh.orderNumber})`,
    });
    const c: any = item.cases;
    await notifyChat(
      `📦 *Replacement shipped* — case *${c?.case_number ?? "?"}*${c?.customer_name ? ` · ${c.customer_name}` : ""}\n` +
      `${carrier ?? sh.carrierCode ?? "carrier"} ${sh.trackingNumber} · SS ${sh.orderNumber}\n` +
      `<${PORTAL_URL}/support/cases/${item.case_id}|Open case>`,
    );
  }
  return "applied";
}

async function syncOpenPicks(db: SupabaseClient) {
  const { data: picks } = await db.from("action_items")
    .select("id, shipstation_order_id, shipstation_order_number")
    .eq("is_replacement_pick", true)
    .is("shipstation_shipment_id", null)
    .not("shipstation_order_id", "is", null);
  const results: Record<string, string> = {};
  for (const p of picks ?? []) {
    try {
      const data = await ssGet(`/shipments?orderId=${encodeURIComponent(p.shipstation_order_id)}&includeShipmentItems=false`);
      const shipments: Shipment[] = (data.shipments ?? []).filter((s: Shipment) => !s.voided && s.trackingNumber);
      results[p.shipstation_order_number ?? p.id] = shipments.length ? await applyShipment(db, shipments[0]) : "not shipped yet";
    } catch (e) {
      results[p.shipstation_order_number ?? p.id] = `error: ${String((e as any)?.message ?? e)}`;
    }
  }
  return { checked: (picks ?? []).length, results };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }

  try {
    // ── ShipStation webhook ──
    if (body?.resource_url && body?.resource_type) {
      if (!["SHIP_NOTIFY", "ITEM_SHIP_NOTIFY"].includes(body.resource_type)) return json({ ok: true, ignored: body.resource_type });
      const data = await ssGet(String(body.resource_url)); // authenticated re-fetch; rejects foreign hosts
      const shipments: Shipment[] = data.shipments ?? [];
      const results = [];
      for (const sh of shipments) {
        if (!/^SUPPORT-/i.test(sh.orderNumber ?? "") && !(sh.orderKey ?? "").startsWith("support-")) continue;
        results.push({ order: sh.orderNumber, result: await applyShipment(db, sh) });
      }
      return json({ ok: true, shipments: shipments.length, results });
    }

    // ── Staff / cron actions ──
    const auth = await requireStaff(req, corsHeaders);
    if (!auth.ok) return auth.response;

    switch (body.action) {
      case "sync":
        return json({ ok: true, ...(await syncOpenPicks(db)) });
      case "setup": {
        const target = `${Deno.env.get("SUPABASE_URL")}/functions/v1/shipstation-webhook`;
        const existing = await ssGet("/webhooks");
        const hooks: any[] = existing.webhooks ?? [];
        // Remove stale SHIP_NOTIFY hooks that point at other (dead) Supabase projects.
        const removed: number[] = [];
        for (const w of hooks.filter((w) => w.HookType === "SHIP_NOTIFY" && /supabase\.co\/functions\/v1\/shipstation-webhook$/.test(w.Url ?? "") && w.Url !== target)) {
          const r = await fetch(`${SS}/webhooks/${w.WebHookID}`, { method: "DELETE", headers: ssAuth() });
          if (r.ok) removed.push(w.WebHookID);
        }
        const hit = hooks.find((w) => (w.Url ?? w.TargetUrl) === target && w.HookType === "SHIP_NOTIFY");
        if (hit) return json({ ok: true, existing: true, removed, webhook: { id: hit.WebHookID, url: hit.Url } });
        const res = await fetch(`${SS}/webhooks/subscribe`, {
          method: "POST", headers: ssAuth(),
          body: JSON.stringify({ target_url: target, event: "SHIP_NOTIFY", store_id: null, friendly_name: "AGA Support Hub — replacement shipped" }),
        });
        const out = await res.json().catch(() => ({}));
        return json({ ok: res.ok, webhook: out }, res.ok ? 200 : 500);
      }
      case "status": {
        const hooks = await ssGet("/webhooks");
        const { data: open } = await db.from("action_items")
          .select("id, shipstation_order_number, created_at, cases(case_number)")
          .eq("is_replacement_pick", true).is("shipstation_shipment_id", null).not("shipstation_order_id", "is", null);
        return json({ ok: true, webhooks: hooks.webhooks ?? [], awaiting_shipment: open ?? [] });
      }
      default:
        return json({ error: `unknown action: ${body.action}` }, 400);
    }
  } catch (err) {
    console.error("shipstation-webhook error:", err);
    const detail = String((err as any)?.message ?? err);
    await notifyChat(`⚠️ *ShipStation sync error*\n\`${detail.slice(0, 300)}\``);
    return json({ error: detail }, 500);
  }
});
