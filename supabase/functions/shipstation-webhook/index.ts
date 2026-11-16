// shipstation-webhook — INBOUND: ShipStation → Support Hub.
//
// ShipStation POSTs { resource_url, resource_type }. We never trust the payload: we
// fetch resource_url (which must be on ssapi.shipstation.com) with our own credentials.
//
// ORDER_NOTIFY — a new order landed in ShipStation. Cin7 sends a sale across when it
//   is packed, so this is the "packed" signal: the order's lines go to guide-delivery
//   `queue-labels`, which matches SKUs to guides and queues DYMO guide labels
//   (copies = qty) for the /labels/station page. Each order is claimed once in
//   label_orders_seen, so the webhook and the every-minute `poll-orders` backup can
//   never print the same order twice. SUPPORT- replacement orders are skipped (they
//   are created when the pick is requested, not when it is packed).
// SHIP_NOTIFY — a label was created (fetched WITH shipment items):
//   • guide labels are queued here instead only when LABEL_TRIGGER = "shipped"
//   • SUPPORT-<case> shipments close the replacement pick:
//   • action_items: dispatched_at, status=done, shipstation_shipment_id, tracking
//   • cases: replacement_tracking_number / carrier / ship_date  (DB trigger → In hand)
//   • case_updates system note + Google Chat notification
//
// Staff/cron actions (POST JSON, staff JWT or service key):
//   { action: "sync" }    — poll ShipStation for shipments of open picks (backup for the webhook, cron every 30 min)
//   { action: "poll-orders" } — queue guide labels for packed orders the webhook missed (cron every minute);
//                           { seed: true } marks every order now awaiting shipment as seen without printing
//   { action: "setup" }   — register the SHIP_NOTIFY + ORDER_NOTIFY webhooks pointing at this function (idempotent)
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
/**
 * When DYMO guide labels are queued automatically:
 *   "packed"  — the order lands in ShipStation (Cin7 sends it once packed). Damian, 2026-11-17.
 *   "shipped" — the shipping label is created (the original trigger, off since 2026-11-17).
 *   "off"     — never; only the Guide portal Print buttons print.
 */
const LABEL_TRIGGER = "packed" as "packed" | "shipped" | "off";
/** Newest awaiting-shipment orders the backup poll looks at, and how many it will queue per run. */
const POLL_PAGE = 50, POLL_MAX = 15;

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
  shipmentItems?: { sku: string | null; name: string | null; quantity: number }[] | null;
  shipTo?: { name?: string | null; company?: string | null; city?: string | null; state?: string | null; postalCode?: string | null; country?: string | null } | null;
  customerEmail?: string | null;
};

type Order = {
  orderId: number; orderNumber: string; orderKey?: string; orderStatus?: string;
  items?: { sku: string | null; name: string | null; quantity: number; adjustment?: boolean }[] | null;
  shipTo?: Shipment["shipTo"]; customerEmail?: string | null;
};

/** "Jane Smith (Acme Pty Ltd)" / "Brisbane QLD 4000" for the station's job list. */
function whoFor(sh: Pick<Shipment, "shipTo" | "customerEmail">): { customer_name: string | null; ship_to: string | null } {
  const t = sh.shipTo ?? {};
  const name = [t.name, t.company ? `(${t.company})` : null].filter(Boolean).join(" ").trim() || sh.customerEmail || null;
  const place = [t.city, t.state, t.postalCode].filter(Boolean).join(" ").trim() || null;
  return { customer_name: name, ship_to: place };
}

/** Ask ShipStation for the shipments WITH their line items (the webhook's resource_url says includeShipmentItems=False). */
function withItems(resourceUrl: string): string {
  if (/includeShipmentItems=/i.test(resourceUrl)) return resourceUrl.replace(/includeShipmentItems=[^&]*/i, "includeShipmentItems=True");
  return `${resourceUrl}${resourceUrl.includes("?") ? "&" : "?"}includeShipmentItems=True`;
}

type LabelItem = { sku: string | null; name: string | null; quantity: number };

/**
 * Queue DYMO guide labels for one order's lines. SKU→guide matching lives in
 * guide-delivery. `shipmentId` is set for the ship-time trigger (guide-delivery
 * dedupes on it); the packed trigger dedupes by claiming the order beforehand.
 */
async function queueGuideLabels(
  db: SupabaseClient,
  o: { orderNumber: string; source: string; shipmentId?: string; items: LabelItem[]; who: { customer_name: string | null; ship_to: string | null } },
): Promise<{ ok: boolean; queued: number; out: any }> {
  const items = o.items.filter((i) => i.sku).map((i) => ({ sku: i.sku, title: i.name ?? "", quantity: i.quantity ?? 1 }));
  if (!items.length) return { ok: true, queued: 0, out: "no items" };
  const started = new Date(Date.now() - 5000).toISOString(); // small allowance for clock skew
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/guide-delivery`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${key}` },
    body: JSON.stringify({ action: "queue-labels", source: o.source, order_number: o.orderNumber, shipstation_shipment_id: o.shipmentId ?? null, items }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) { console.error("queue-labels failed:", o.orderNumber, res.status, out); return { ok: false, queued: 0, out }; }
  // Stamp who the order is for (the station lists it). Done here rather than in
  // queue-labels so guide-delivery stays a pure SKU matcher.
  if (out?.queued) {
    let q = db.from("label_print_jobs").update(o.who).is("customer_name", null);
    q = o.shipmentId
      ? q.eq("shipstation_shipment_id", o.shipmentId)
      : q.eq("source", o.source).eq("order_number", o.orderNumber).gte("created_at", started);
    await q;
  }
  return { ok: true, queued: Number(out?.queued) || 0, out };
}

const isSupportOrder = (o: { orderNumber?: string | null; orderKey?: string | null }) =>
  /^SUPPORT-/i.test(o.orderNumber ?? "") || (o.orderKey ?? "").startsWith("support-");

/**
 * Packed trigger: queue guide labels for one ShipStation order, at most once.
 * The insert into label_orders_seen is the claim — whoever inserts the row
 * (webhook or poll) queues the labels; everyone else sees a duplicate and stops.
 */
async function labelsForPackedOrder(db: SupabaseClient, o: Order, opts: { seed?: boolean } = {}): Promise<string> {
  if (isSupportOrder(o)) return "support order";
  if (o.orderStatus && o.orderStatus !== "awaiting_shipment") return `skipped (${o.orderStatus})`;
  const id = String(o.orderId);
  const { data: claim, error } = await db.from("label_orders_seen")
    .upsert({ shipstation_order_id: id, order_number: o.orderNumber ?? null, note: opts.seed ? "seeded" : null }, { onConflict: "shipstation_order_id", ignoreDuplicates: true })
    .select("shipstation_order_id");
  if (error) throw new Error(`label_orders_seen: ${error.message}`);
  if (!claim?.length) return "already done";
  if (opts.seed) return "seeded";
  try {
    const r = await queueGuideLabels(db, {
      orderNumber: o.orderNumber, source: "packed", who: whoFor(o),
      items: (o.items ?? []).filter((i) => !i.adjustment),
    });
    if (!r.ok) throw new Error(`queue-labels: ${JSON.stringify(r.out).slice(0, 200)}`);
    await db.from("label_orders_seen").update({ labels_queued: r.queued }).eq("shipstation_order_id", id);
    return r.queued ? `queued ${r.queued}` : "no guide labels";
  } catch (e) {
    // Release the claim so the next poll tries this order again.
    await db.from("label_orders_seen").delete().eq("shipstation_order_id", id);
    throw e;
  }
}

/** Backup for ORDER_NOTIFY: queue labels for any recent awaiting-shipment order not yet seen. */
async function pollPackedOrders(db: SupabaseClient, seed: boolean) {
  if (LABEL_TRIGGER !== "packed") return { trigger: LABEL_TRIGGER, checked: 0 };
  const data = await ssGet(`/orders?orderStatus=awaiting_shipment&sortBy=CreateDate&sortDir=DESC&pageSize=${POLL_PAGE}`);
  const orders: Order[] = (data.orders ?? []).filter((o: Order) => !isSupportOrder(o));
  const { data: seen, error } = await db.from("label_orders_seen").select("shipstation_order_id")
    .in("shipstation_order_id", orders.map((o) => String(o.orderId)));
  if (error) throw new Error(`label_orders_seen: ${error.message}`);
  const done = new Set((seen ?? []).map((r) => r.shipstation_order_id));
  // Never print a backlog: on an empty table (first run, or the table was cleared) just take stock.
  if (!seed) {
    const { count, error: cErr } = await db.from("label_orders_seen").select("shipstation_order_id", { count: "exact", head: true });
    if (cErr) throw new Error(`label_orders_seen: ${cErr.message}`);
    if (!count) seed = true;
  }
  // A marker row, so a seed that found nothing to seed still leaves the table non-empty.
  if (seed) await db.from("label_orders_seen").upsert({ shipstation_order_id: "seed-marker", note: "seeded" }, { onConflict: "shipstation_order_id", ignoreDuplicates: true });
  // Oldest first so labels come out in packing order.
  const fresh = orders.filter((o) => !done.has(String(o.orderId))).reverse().slice(0, seed ? POLL_PAGE : POLL_MAX);
  const results: Record<string, string> = {};
  for (const o of fresh) {
    try { results[o.orderNumber] = await labelsForPackedOrder(db, o, { seed }); }
    catch (e) { results[o.orderNumber] = `error: ${String((e as any)?.message ?? e)}`; }
  }
  return { checked: orders.length, fresh: fresh.length, seeded: seed, results };
}

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
      if (["ORDER_NOTIFY", "ITEM_ORDER_NOTIFY"].includes(body.resource_type)) {
        if (LABEL_TRIGGER !== "packed") return json({ ok: true, ignored: body.resource_type });
        const data = await ssGet(String(body.resource_url)); // authenticated re-fetch; rejects foreign hosts
        const orders: Order[] = data.orders ?? [];
        const labels = [];
        for (const o of orders) {
          try { labels.push({ order: o.orderNumber, result: await labelsForPackedOrder(db, o) }); }
          catch (e) { labels.push({ order: o.orderNumber, result: `error: ${String((e as any)?.message ?? e)}` }); } // the poll retries it
        }
        return json({ ok: true, orders: orders.length, labels });
      }
      if (!["SHIP_NOTIFY", "ITEM_SHIP_NOTIFY"].includes(body.resource_type)) return json({ ok: true, ignored: body.resource_type });
      const data = await ssGet(withItems(String(body.resource_url))); // authenticated re-fetch; rejects foreign hosts
      const shipments: Shipment[] = data.shipments ?? [];
      const results = [];
      const labels = [];
      for (const sh of shipments) {
        if (LABEL_TRIGGER === "shipped" && !sh.voided) {
          try {
            const r = await queueGuideLabels(db, { orderNumber: sh.orderNumber, source: "shipstation", shipmentId: String(sh.shipmentId), items: sh.shipmentItems ?? [], who: whoFor(sh) });
            labels.push({ order: sh.orderNumber, result: r.out });
          } catch (e) { labels.push({ order: sh.orderNumber, result: { error: String(e) } }); }
        }
        if (!/^SUPPORT-/i.test(sh.orderNumber ?? "") && !(sh.orderKey ?? "").startsWith("support-")) continue;
        results.push({ order: sh.orderNumber, result: await applyShipment(db, sh) });
      }
      return json({ ok: true, shipments: shipments.length, results, labels });
    }

    // ── Staff / cron actions ──
    const auth = await requireStaff(req, corsHeaders);
    if (!auth.ok) return auth.response;

    switch (body.action) {
      case "sync":
        return json({ ok: true, ...(await syncOpenPicks(db)) });
      case "poll-orders":
        return json({ ok: true, ...(await pollPackedOrders(db, body.seed === true)) });
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
        const wanted = [
          { event: "SHIP_NOTIFY", friendly_name: "AGA Support Hub — replacement shipped" },
          { event: "ORDER_NOTIFY", friendly_name: "AGA guide labels — order packed" },
        ];
        const out: Record<string, unknown> = {};
        let ok = true;
        for (const w of wanted) {
          const hit = hooks.find((h) => (h.Url ?? h.TargetUrl) === target && h.HookType === w.event);
          if (hit) { out[w.event] = { existing: true, id: hit.WebHookID }; continue; }
          const res = await fetch(`${SS}/webhooks/subscribe`, {
            method: "POST", headers: ssAuth(),
            body: JSON.stringify({ target_url: target, event: w.event, store_id: null, friendly_name: w.friendly_name }),
          });
          ok = ok && res.ok;
          out[w.event] = await res.json().catch(() => ({ status: res.status }));
        }
        return json({ ok, removed, webhooks: out }, ok ? 200 : 500);
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
