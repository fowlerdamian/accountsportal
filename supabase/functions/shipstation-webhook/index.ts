// shipstation-webhook — INBOUND: ShipStation → Support Hub.
//
// ShipStation POSTs { resource_url, resource_type }. We never trust the payload: we
// fetch resource_url (which must be on ssapi.shipstation.com) with our own credentials.
//
// GUIDE LABELS (LABEL_TRIGGER = "picked", since 2026-11-17): the every-minute
//   `poll-orders` cron asks Cin7 for sales updated since the last run; every
//   fulfilment whose Pick is authorised and which has not shipped yet has its pick
//   lines sent to guide-delivery `queue-labels` (SKU → guide, copies = qty) for the
//   /labels/station page. Each fulfilment is claimed once in label_orders_seen
//   (key cin7:<TaskID>), so it never prints twice.
// PRODUCT LABELS (warehouse auto labels, 2026-11-18): the same picked trigger also
//   queues the warehouse product barcode label (label_print_jobs kind "barcode") for
//   every pick line whose SKU is on the product_label_skus list (/warehouse/auto-labels),
//   copies = picked qty x copies_per_unit. Claimed separately (key cin7-product:<TaskID>).
//   Sales whose Cin7 customer is in product_label_excluded_customers get none.
// ORDER_NOTIFY (only when LABEL_TRIGGER = "packed") — a new order landed in ShipStation. Cin7 sends a sale across when it
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
//   { action: "poll-orders" } — queue guide labels (cron every minute): picked Cin7 sales, or in "packed"
//                           mode the ShipStation orders the webhook missed; { seed: true } marks what is
//                           already there as seen without printing
//   { action: "cin7-stages" } — diagnostic: pick / pack / ship status of recently updated Cin7 sales
//   { action: "cin7-webhooks" } — list Cin7's webhooks; { register: true } subscribes Sale/PickAuthorised to
//                           this function (?source=cin7, bearer token) so labels queue the moment a pick
//                           is authorised; the poll stays as the backup
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
 *   "picked"  — the pick is authorised in Cin7 (one stage before packed). Damian, 2026-11-17.
 *   "packed"  — the order lands in ShipStation (Cin7 sends it once packed).
 *   "shipped" — the shipping label is created (the original trigger, off since 2026-11-17).
 *   "off"     — never; only the Guide portal Print buttons print.
 */
const LABEL_TRIGGER = "picked" as "picked" | "packed" | "shipped" | "off";
const CIN7 = "https://inventory.dearsystems.com/ExternalApi/v2";
/** Row in label_orders_seen whose note holds the time of the last successful Cin7 poll. */
const CIN7_WATERMARK = "cin7-watermark";
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
  // ShipStation drops the odd connection ("http2 error: connection error received");
  // a GET is safe to repeat, so retry network failures before giving up.
  let res: Response | undefined, lastErr: unknown;
  for (let attempt = 0; attempt < 3 && !res; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 400 * attempt));
    try { res = await fetch(url, { headers: ssAuth() }); } catch (e) { lastErr = e; }
  }
  if (!res) throw lastErr;
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
type Who = { customer_name: string | null; ship_to: string | null };

/**
 * Queue DYMO guide labels for one order's lines. SKU→guide matching lives in
 * guide-delivery. `shipmentId` is set for the ship-time trigger (guide-delivery
 * dedupes on it); the packed trigger dedupes by claiming the order beforehand.
 */
async function queueGuideLabels(
  db: SupabaseClient,
  o: { orderNumber: string; source: string; shipmentId?: string; items: LabelItem[]; who: Who },
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

async function cin7Get(path: string) {
  const headers = { "api-auth-accountid": Deno.env.get("CIN7_ACCOUNT_ID") ?? "", "api-auth-applicationkey": Deno.env.get("CIN7_API_KEY") ?? "" };
  if (!headers["api-auth-accountid"] || !headers["api-auth-applicationkey"]) throw new Error("CIN7_ACCOUNT_ID / CIN7_API_KEY not configured");
  let res: Response | undefined, lastErr: unknown;
  for (let attempt = 0; attempt < 3 && !res; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 400 * attempt));
    try { res = await fetch(`${CIN7}${path}`, { headers }); } catch (e) { lastErr = e; }
  }
  if (!res) throw lastErr;
  if (!res.ok) throw new Error(`Cin7 GET ${path} → ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function cin7Send(method: "POST" | "DELETE", path: string, payload?: unknown) {
  const res = await fetch(`${CIN7}${path}`, {
    method,
    headers: { "Content-Type": "application/json", "api-auth-accountid": Deno.env.get("CIN7_ACCOUNT_ID") ?? "", "api-auth-applicationkey": Deno.env.get("CIN7_API_KEY") ?? "" },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const text = await res.text();
  let out: unknown = text.slice(0, 500);
  try { out = JSON.parse(text); } catch { /* plain text */ }
  return { ok: res.ok, status: res.status, out };
}

/** Bearer token Cin7 sends with its webhooks — derived, so there is no extra secret to store. */
async function cin7HookToken() {
  const data = new TextEncoder().encode(`${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}:cin7-webhook`);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Insert the once-only claim for a fulfilment; false when someone already holds it. */
async function claimOnce(db: SupabaseClient, id: string, order: string, seed: boolean): Promise<boolean> {
  const { data: claim, error } = await db.from("label_orders_seen")
    .upsert({ shipstation_order_id: id, order_number: order, note: seed ? "seeded" : null }, { onConflict: "shipstation_order_id", ignoreDuplicates: true })
    .select("shipstation_order_id");
  if (error) throw new Error(`label_orders_seen: ${error.message}`);
  return !!claim?.length;
}

/**
 * Warehouse product labels for one picked fulfilment: every pick line whose SKU is
 * on the product_label_skus list gets one barcode job (the label stored with the
 * SKU, copies = picked qty x copies_per_unit). Has its own claim, so a retry of the
 * guide labels never reprints these and vice versa. Returns "" when nothing queued.
 */
async function queueProductLabels(db: SupabaseClient, o: { taskId: string; orderNumber: string; seed: boolean; items: LabelItem[]; who: Who }): Promise<string> {
  const id = `cin7-product:${o.taskId}`;
  if (!(await claimOnce(db, id, o.orderNumber, o.seed)) || o.seed) return "";
  try {
    const qty = new Map<string, number>();
    for (const i of o.items) {
      const sku = String(i.sku ?? "").trim().toUpperCase();
      if (sku) qty.set(sku, (qty.get(sku) ?? 0) + Math.max(1, Math.ceil(Number(i.quantity) || 1)));
    }
    if (!qty.size) return "";
    const { data: list, error } = await db.from("product_label_skus").select("sku, payload, copies_per_unit").eq("enabled", true).in("sku", [...qty.keys()]);
    if (error) throw new Error(`product_label_skus: ${error.message}`);
    if (!list?.length) return "";
    // Customers on the exclusion list (/warehouse/auto-labels) never get product labels.
    const norm = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim().toLowerCase();
    const customer = norm(o.who.customer_name);
    if (customer) {
      const { data: excluded, error: xErr } = await db.from("product_label_excluded_customers").select("customer");
      if (xErr) throw new Error(`product_label_excluded_customers: ${xErr.message}`);
      if ((excluded ?? []).some((r) => norm(r.customer) === customer)) return "product labels skipped (customer excluded)";
    }
    // A label without a product name or a 12/13-digit EAN cannot print; leave it out rather than fail at the station.
    const printable = (p: any) => !!String(p?.title ?? "").trim() && /^\d{12,13}$/.test(String(p?.barcode ?? "").replace(/[\s-]/g, ""));
    const skipped = (list ?? []).filter((r) => !printable(r.payload)).map((r) => r.sku);
    const rows = (list ?? []).filter((r) => printable(r.payload)).map((r) => ({
      kind: "barcode", source: "picked", order_number: o.orderNumber, sku: r.sku, payload: r.payload,
      copies: Math.min(50, (qty.get(r.sku) ?? 1) * (Number(r.copies_per_unit) || 1)), ...o.who,
    }));
    if (rows.length) {
      const { error: iErr } = await db.from("label_print_jobs").insert(rows);
      if (iErr) throw new Error(`label_print_jobs: ${iErr.message}`);
      await db.from("label_orders_seen").update({ labels_queued: rows.length }).eq("shipstation_order_id", id);
    }
    return [
      rows.length ? `${rows.length} product label${rows.length === 1 ? "" : "s"} (${rows.map((r) => `${r.copies}x ${r.sku}`).join(", ")})` : "",
      skipped.length ? `product label incomplete: ${skipped.join(", ")}` : "",
    ].filter(Boolean).join("; ");
  } catch (e) {
    await db.from("label_orders_seen").delete().eq("shipstation_order_id", id); // release the claim; next run retries
    throw e;
  }
}

/**
 * Queue labels for one Cin7 sale: every fulfilment whose pick is authorised and
 * which has not shipped gets its guide labels and its warehouse product labels,
 * each claimed once in label_orders_seen. Throws when a fulfilment could not be
 * queued (that claim is released so the next run retries).
 */
async function labelsForPickedSale(db: SupabaseClient, saleId: string, orderNumber: string | null, seed: boolean, results: Record<string, string>) {
  const sale = await cin7Get(`/sale?ID=${encodeURIComponent(saleId)}`);
  const order = orderNumber ?? sale.Order?.SaleOrderNumber ?? saleId;
  for (const f of sale.Fulfilments ?? []) {
    if (f?.Pick?.Status !== "AUTHORISED" || f?.Ship?.Status === "AUTHORISED" || !f.TaskID) continue;
    const label = `${order}${(sale.Fulfilments ?? []).length > 1 ? `/${f.FulfillmentNumber}` : ""}`;
    const a = sale.ShippingAddress ?? {};
    const items: LabelItem[] = (f.Pick.Lines ?? []).map((l: any) => ({ sku: l.SKU ?? null, name: l.Name ?? null, quantity: Number(l.Quantity) || 1 }));
    const who: Who = {
      customer_name: sale.Customer ?? a.Contact ?? null,
      ship_to: [String(a.City ?? "").split(";")[0], a.State, a.Postcode].filter(Boolean).join(" ").trim() || null,
    };

    // Guide labels.
    const id = `cin7:${f.TaskID}`;
    if (!(await claimOnce(db, id, order, seed))) results[label] = "already done";
    else if (seed) results[label] = "seeded";
    else {
      try {
        const r = await queueGuideLabels(db, { orderNumber: order, source: "picked", items, who });
        if (!r.ok) throw new Error(`queue-labels: ${JSON.stringify(r.out).slice(0, 200)}`);
        await db.from("label_orders_seen").update({ labels_queued: r.queued }).eq("shipstation_order_id", id);
        results[label] = r.queued ? `queued ${r.queued}` : "no guide labels";
      } catch (e) {
        await db.from("label_orders_seen").delete().eq("shipstation_order_id", id); // release the claim; next run retries
        throw e;
      }
    }

    // Warehouse product labels (SKUs on the /warehouse/auto-labels list).
    const product = await queueProductLabels(db, { taskId: String(f.TaskID), orderNumber: order, seed, items, who });
    if (product) results[label] = `${results[label]}; ${product}`;
  }
}

/**
 * Picked trigger: queue guide labels for every Cin7 fulfilment whose pick is
 * authorised and which has not shipped. Sales are found by UpdatedSince the last
 * successful run (authorising a pick updates the sale), so one list call per
 * minute plus one detail call per sale that is at the pick/pack stage.
 */
async function pollPickedSales(db: SupabaseClient, seed: boolean) {
  const started = new Date();
  const { data: wm } = await db.from("label_orders_seen").select("note").eq("shipstation_order_id", CIN7_WATERMARK).maybeSingle();
  // First run: take stock of what is already picked instead of printing it.
  if (!wm?.note) seed = true;
  const since = seed
    ? new Date(started.getTime() - 48 * 3600_000)
    : new Date(Math.max(new Date(wm!.note).getTime() - 90_000, started.getTime() - 48 * 3600_000));

  const sales: any[] = [];
  for (let page = 1; page <= 5; page++) {
    const data = await cin7Get(`/saleList?UpdatedSince=${encodeURIComponent(since.toISOString())}&Limit=200&Page=${page}`);
    const list: any[] = data.SaleList ?? [];
    sales.push(...list);
    if (list.length < 200) break;
  }
  // Only sales sitting between pick and ship are worth a detail call.
  const atPick = sales.filter((s) => /PICK/.test(String(s.CombinedPickingStatus ?? "")) && !/^NOT /.test(String(s.CombinedPickingStatus ?? ""))
    && String(s.CombinedShippingStatus ?? "") !== "SHIPPED" && !["VOIDED", "CANCELLED"].includes(String(s.Status ?? "")));

  const results: Record<string, string> = {};
  let failed = false;
  for (const s of atPick.slice(0, 40)) {
    try {
      await labelsForPickedSale(db, s.SaleID, s.OrderNumber ?? null, seed, results);
    } catch (e) {
      failed = true;
      results[s.OrderNumber] = `error: ${String((e as any)?.message ?? e)}`;
    }
  }
  // Only move the watermark forward when everything in this window was handled.
  if (!failed && atPick.length <= 40) {
    await db.from("label_orders_seen").upsert({ shipstation_order_id: CIN7_WATERMARK, note: started.toISOString(), seen_at: started.toISOString() }, { onConflict: "shipstation_order_id" });
  }
  return { trigger: "picked", since: since.toISOString(), updated: sales.length, at_pick: atPick.length, seeded: seed, results };
}

/** Backup for ORDER_NOTIFY: queue labels for any recent awaiting-shipment order not yet seen. */
async function pollPackedOrders(db: SupabaseClient, seed: boolean) {
  if (LABEL_TRIGGER === "picked") return pollPickedSales(db, seed);
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

    // ── Cin7 webhook (Sale/PickAuthorised) — prints the labels without waiting for the poll ──
    if (new URL(req.url).searchParams.get("source") === "cin7") {
      if (req.headers.get("authorization") !== `Bearer ${await cin7HookToken()}`) return json({ error: "unauthorised" }, 401);
      if (LABEL_TRIGGER !== "picked") return json({ ok: true, ignored: "trigger is not picked" });
      const evt = Array.isArray(body) ? body[0] : body;
      const saleId = String(evt?.SaleID ?? evt?.SaleId ?? evt?.ID ?? "");
      const results: Record<string, string> = {};
      try {
        // The payload only names the sale; everything else is re-fetched from Cin7.
        if (/^[0-9a-f-]{36}$/i.test(saleId)) await labelsForPickedSale(db, saleId, null, false, results);
        else { console.log("cin7 webhook without a SaleID, keys:", Object.keys(evt ?? {})); return json({ ok: true, ...(await pollPickedSales(db, false)) }); }
      } catch (e) {
        // Answer 200 anyway: the 15-second poll picks the sale up, a Cin7 retry would only repeat the work.
        console.error("cin7 webhook:", e);
        return json({ ok: false, sale: saleId, error: String((e as any)?.message ?? e), results });
      }
      return json({ ok: true, sale: saleId, results });
    }

    // ── Staff / cron actions ──
    const auth = await requireStaff(req, corsHeaders);
    if (!auth.ok) return auth.response;

    switch (body.action) {
      case "sync":
        return json({ ok: true, ...(await syncOpenPicks(db)) });
      case "cin7-stages": {
        // Diagnostic: where recently-updated Cin7 sales sit in pick / pack / ship.
        const since = new Date(Date.now() - (Number(body.hours) || 3) * 3600_000).toISOString();
        const data = await cin7Get(`/saleList?UpdatedSince=${encodeURIComponent(since)}&Limit=200&Page=1`);
        const rows = (data.SaleList ?? []).map((s: any) => [s.OrderNumber, s.InvoiceNumber, s.Status, s.CombinedPickingStatus, s.CombinedPackingStatus, s.CombinedShippingStatus, s.Updated].join("|"));
        return json({ ok: true, total: data.Total, rows });
      }
      case "poll-orders":
        return json({ ok: true, ...(await pollPackedOrders(db, body.seed === true)) });
      case "cin7-webhooks": {
        // List Cin7's webhooks; { register: true } adds Sale/PickAuthorised → this function, { remove: "<ID>" } deletes one.
        const target = `${Deno.env.get("SUPABASE_URL")}/functions/v1/shipstation-webhook?source=cin7`;
        const strip = (list: any[]) => list.map((w) => ({ ID: w.ID, Type: w.Type, Name: w.Name, IsActive: w.IsActive, ExternalUrl: w.ExternalUrl, ExternalAuthorizationType: w.ExternalAuthorizationType }));
        let hooks: any[] = (await cin7Get("/webhooks")).Webhooks ?? [];
        let change: unknown = null;
        if (body.remove) change = await cin7Send("DELETE", `/webhooks?ID=${encodeURIComponent(String(body.remove))}`);
        else if (body.register === true && !hooks.some((w) => w.Type === "Sale/PickAuthorised" && w.ExternalUrl === target)) {
          change = await cin7Send("POST", "/webhooks", {
            Type: "Sale/PickAuthorised", Name: "AGA guide labels - pick authorised", IsActive: true, ExternalUrl: target,
            ExternalAuthorizationType: "bearerauth", ExternalBearerToken: await cin7HookToken(), ExternalHeaders: [],
          });
        }
        if (change) hooks = (await cin7Get("/webhooks")).Webhooks ?? [];
        return json({ ok: true, target, change, webhooks: strip(hooks) });
      }
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
    // The every-minute label poll just runs again; a failed run is not worth a Chat alert.
    if (body?.action !== "poll-orders") await notifyChat(`⚠️ *ShipStation sync error*\n\`${detail.slice(0, 300)}\``);
    return json({ error: detail }, 500);
  }
});
