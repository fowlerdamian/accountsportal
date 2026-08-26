// guide-delivery — auto-email installation guides to Shopify customers after SHIPMENT.
//
// Flow: order fulfilled (orders/fulfilled webhook, or the 15-min poll) → row scheduled for
// fulfilled_at + delay_hours → when due, the order is RE-FETCHED from Shopify (fresh email,
// name, line items minus refunds, cancellation state) → SKUs matched → email sent.
//
// Entry points (POST JSON body, or Shopify webhook):
//   Shopify webhook (orders/fulfilled) — header X-Shopify-Topic present. The payload is only
//     used for its id; the order is re-fetched from the Admin API (source of truth), and if
//     SHOPIFY_WEBHOOK_SECRET is set the HMAC is also checked.
//   { action: "poll" }              — scan recently-shipped orders, schedule unseen ones, then send due ones
//   { action: "process" }           — send every due (scheduled, send_after <= now) delivery
//   { action: "resend", id }        — re-fetch + re-match + send one delivery now
//   { action: "ingest", order_id }  — manually enqueue a Shopify order by numeric id
//   { action: "preview", skus[] }   — dry-run matching for a list of SKUs
//   { action: "test", to }          — send a sample email to an address
//
// Non-webhook actions require a staff JWT or the service-role key (cron).
// Deploy with --no-verify-jwt (Shopify cannot send a Supabase JWT).

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireStaff } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const SHOPIFY_API = "2024-10";

type LineItem = { sku: string | null; title: string; quantity: number; variant_title: string | null };
type Matched = { sku: string; instruction_set_id: string; title: string; url: string; match: "link" | "exact" | "prefix" };
type Settings = {
  enabled: boolean; brand_id: string | null; from_email: string; reply_to: string | null; bcc_email: string | null;
  subject: string; intro_text: string; auto_match: boolean; poll_lookback_hours: number; delay_hours: number;
};

function admin(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
}
function shopifyEnv() {
  const token = Deno.env.get("SHOPIFY_ACCESS_TOKEN");
  const store = Deno.env.get("SHOPIFY_STORE_DOMAIN");
  if (!token || !store) throw new Error("SHOPIFY_ACCESS_TOKEN / SHOPIFY_STORE_DOMAIN not configured");
  return { token, store };
}
async function shopifyGet(path: string) {
  const { token, store } = shopifyEnv();
  const res = await fetch(`https://${store}/admin/api/${SHOPIFY_API}/${path}`, {
    headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(`Shopify ${path} → ${res.status} ${await res.text()}`);
  return res.json();
}

async function loadSettings(db: SupabaseClient): Promise<Settings> {
  const { data, error } = await db.from("guide_delivery_settings").select("*").eq("id", 1).single();
  if (error || !data) throw new Error("guide_delivery_settings row missing");
  return data as Settings;
}

// ── Matching ─────────────────────────────────────────────────────────────────
type GuideRow = { id: string; title: string; product_code: string; slug: string; published_at: string | null };

async function loadCatalog(db: SupabaseClient, brandId: string | null) {
  const [{ data: brand }, { data: links }, { data: pubs }] = await Promise.all([
    brandId
      ? db.from("brands").select("id,key,name,domain,support_email,logo_url,primary_colour").eq("id", brandId).single()
      : db.from("brands").select("id,key,name,domain,support_email,logo_url,primary_colour").eq("key", "trailbait").single(),
    db.from("guide_product_links").select("sku,instruction_set_id"),
    db.from("guide_publications")
      .select("published_at, instruction_sets!inner(id,title,product_code,slug)")
      .eq("status", "published")
      .eq("brand_id", brandId ?? ""),
  ]);
  if (!brand) throw new Error("Delivery brand not found");
  const guides: GuideRow[] = (pubs ?? []).map((p: any) => ({ ...p.instruction_sets, published_at: p.published_at }));
  const byId = new Map(guides.map((g) => [g.id, g]));
  const linkMap = new Map<string, string | null>();
  for (const l of links ?? []) linkMap.set(String(l.sku).trim().toUpperCase(), l.instruction_set_id);
  return { brand, guides, byId, linkMap };
}

function guideUrl(domain: string, slug: string) {
  return `https://${domain}/${slug}`;
}

// Rank auto-match candidates: exact code > longest prefix; never a title flagged OLD/DELETE/COPY; newest publish wins ties.
function autoMatch(sku: string, guides: GuideRow[]): { g: GuideRow; match: "exact" | "prefix" } | null {
  const S = sku.toUpperCase();
  const usable = guides.filter((g) => g.product_code && !/\b(OLD|DELETE|COPY|N\/A)\b/i.test(g.title + " " + g.product_code));
  const score = (g: GuideRow) => (g.published_at ?? "");
  const exact = usable.filter((g) => g.product_code.trim().toUpperCase() === S).sort((a, b) => score(b).localeCompare(score(a)));
  if (exact[0]) return { g: exact[0], match: "exact" };
  const prefix = usable
    .filter((g) => { const c = g.product_code.trim().toUpperCase(); return c.length >= 4 && S.startsWith(c); })
    .sort((a, b) => b.product_code.length - a.product_code.length || score(b).localeCompare(score(a)));
  if (prefix[0]) return { g: prefix[0], match: "prefix" };
  return null;
}

function matchLineItems(items: LineItem[], cat: Awaited<ReturnType<typeof loadCatalog>>, auto: boolean) {
  const matched: Matched[] = [];
  const unmatched: string[] = [];
  const seen = new Set<string>();
  for (const li of items) {
    const sku = (li.sku ?? "").trim();
    if (!sku) continue;
    const key = sku.toUpperCase();
    let g: GuideRow | undefined;
    let match: Matched["match"] | undefined;
    if (cat.linkMap.has(key)) {
      const id = cat.linkMap.get(key);
      if (id === null) continue; // explicit suppression
      g = cat.byId.get(id!);
      match = "link";
      if (!g) { unmatched.push(sku); continue; } // linked guide not published for this brand
    } else if (auto) {
      const r = autoMatch(sku, cat.guides);
      if (r) { g = r.g; match = r.match; }
    }
    if (!g || !match) { unmatched.push(sku); continue; }
    if (seen.has(g.id)) continue;
    seen.add(g.id);
    matched.push({ sku, instruction_set_id: g.id, title: g.title, url: guideUrl(cat.brand.domain, g.slug), match });
  }
  return { matched, unmatched: [...new Set(unmatched)] };
}

// ── Email ────────────────────────────────────────────────────────────────────
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

function renderEmail(opts: {
  brand: any; settings: Settings; firstName: string; orderName: string; guides: Matched[];
}) {
  const { brand, settings, firstName, orderName, guides } = opts;
  const colour = brand.primary_colour || "#F59E0B";
  const s = guides.length === 1 ? "" : "s";
  const subject = settings.subject.replace(/\{\{s\}\}/g, s).replace(/\{\{order\}\}/g, orderName).replace(/\{\{name\}\}/g, firstName);
  const rows = guides.map((g) => `
    <tr><td style="padding:14px 16px;border:1px solid #e5e7eb;border-radius:8px;">
      <div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280;margin-bottom:4px;">${esc(g.sku)}</div>
      <div style="font-size:16px;font-weight:600;color:#111827;margin-bottom:10px;">${esc(g.title)}</div>
      <a href="${g.url}" style="display:inline-block;background:${colour};color:#111;text-decoration:none;font-weight:600;padding:10px 18px;border-radius:6px;font-size:14px;">Open installation guide →</a>
      <div style="font-size:12px;color:#9ca3af;margin-top:8px;">${esc(g.url)}</div>
    </td></tr><tr><td style="height:10px"></td></tr>`).join("");
  const logo = brand.logo_url ? `<img src="${brand.logo_url}" alt="${esc(brand.name)}" style="max-height:44px;max-width:200px;">` : `<strong style="font-size:18px;">${esc(brand.name)}</strong>`;
  const html = `<!doctype html><html><body style="margin:0;background:#f3f4f6;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 12px;"><tr><td align="center">
  <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#fff;border-radius:12px;overflow:hidden;">
    <tr><td style="padding:24px 28px;border-top:5px solid ${colour};">${logo}</td></tr>
    <tr><td style="padding:0 28px 8px;">
      <h1 style="font-size:22px;margin:0 0 12px;color:#111827;">Hi ${esc(firstName)}, your installation guide${s} ${s ? "are" : "is"} ready</h1>
      <p style="font-size:15px;line-height:1.55;color:#374151;margin:0 0 20px;">${esc(settings.intro_text)}</p>
      <table width="100%" cellpadding="0" cellspacing="0">${rows}</table>
    </td></tr>
    <tr><td style="padding:16px 28px 28px;font-size:13px;color:#6b7280;line-height:1.5;">
      Order <strong>${esc(orderName)}</strong>. Questions during install? Reply to this email${brand.support_email ? ` or contact <a href="mailto:${brand.support_email}" style="color:#374151;">${brand.support_email}</a>` : ""}.
    </td></tr>
  </table></td></tr></table></body></html>`;
  const text = `Hi ${firstName},\n\n${settings.intro_text}\n\n` +
    guides.map((g) => `${g.title} (${g.sku})\n${g.url}`).join("\n\n") +
    `\n\nOrder ${orderName}.${brand.support_email ? ` Questions? ${brand.support_email}` : ""}`;
  return { subject, html, text };
}

async function sendResend(settings: Settings, brand: any, to: string, msg: { subject: string; html: string; text: string }) {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) throw new Error("RESEND_API_KEY not configured");
  const body: Record<string, unknown> = {
    from: settings.from_email, to: [to], subject: msg.subject, html: msg.html, text: msg.text,
    reply_to: settings.reply_to || brand.support_email || undefined,
    tags: [{ name: "type", value: "guide-delivery" }],
  };
  if (settings.bcc_email) body.bcc = [settings.bcc_email];
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, body: JSON.stringify(body),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Resend ${res.status}: ${JSON.stringify(out)}`);
  return out.id as string;
}

// ── Order ingestion ──────────────────────────────────────────────────────────
function normaliseOrder(o: any) {
  // Net out refunded quantities so a removed/refunded product doesn't get a guide.
  const refunded = new Map<number, number>();
  for (const r of o.refunds ?? []) for (const rl of r.refund_line_items ?? [])
    refunded.set(rl.line_item_id, (refunded.get(rl.line_item_id) ?? 0) + (rl.quantity ?? 0));
  const items: LineItem[] = (o.line_items ?? [])
    .map((li: any) => ({
      sku: li.sku ?? null, title: li.title ?? "", variant_title: li.variant_title ?? null,
      quantity: (li.quantity ?? 0) - (refunded.get(li.id) ?? 0),
    }))
    .filter((li: LineItem) => li.quantity > 0);
  const fulfilments = (o.fulfillments ?? []).filter((f: any) => f.status === "success");
  const fulfilled_at: string | null = fulfilments.length
    ? (fulfilments.map((f: any) => f.created_at as string).sort().at(-1) ?? null)
    : null;
  const first = o.customer?.first_name ?? o.shipping_address?.first_name ?? o.billing_address?.first_name ?? "";
  const last = o.customer?.last_name ?? o.shipping_address?.last_name ?? o.billing_address?.last_name ?? "";
  return {
    shopify_order_id: Number(o.id),
    order_name: o.name ?? null,
    order_created_at: o.created_at ?? null,
    customer_name: `${first} ${last}`.trim() || null,
    customer_email: (o.email ?? o.contact_email ?? o.customer?.email ?? null)?.toLowerCase() ?? null,
    line_items: items,
    fulfilled_at,
    financial_status: o.financial_status as string | null,
    fulfillment_status: o.fulfillment_status as string | null,
    cancelled: !!o.cancelled_at,
  };
}

/** Schedule a delivery for fulfilled_at + delay if this order hasn't been seen. Returns the row id, or null if already present / not shipped. */
async function enqueue(db: SupabaseClient, o: any, source: string, delayHours: number, forceNow = false): Promise<string | null> {
  const { financial_status: _fs, fulfillment_status: _ff, cancelled, ...n } = normaliseOrder(o);
  if (cancelled) return null;
  if (!n.fulfilled_at && !forceNow) return null; // not shipped yet — the fulfilled webhook/poll picks it up later
  const base = n.fulfilled_at ? new Date(n.fulfilled_at).getTime() : Date.now();
  const send_after = new Date(forceNow ? Date.now() : base + delayHours * 3600_000).toISOString();
  const { data, error } = await db.from("guide_deliveries")
    .insert({ ...n, source, status: "scheduled", send_after })
    .select("id").single();
  if (error) {
    if ((error as any).code === "23505") return null; // duplicate order — idempotent
    throw error;
  }
  return data.id;
}

async function processOne(db: SupabaseClient, settings: Settings, cat: Awaited<ReturnType<typeof loadCatalog>>, row: any, force = false) {
  // Re-fetch the order NOW — items, email, name and refund/cancel state may have changed since scheduling.
  let fresh: ReturnType<typeof normaliseOrder> | null = null;
  try {
    const { order } = await shopifyGet(`orders/${row.shopify_order_id}.json`);
    if (order) fresh = normaliseOrder(order);
  } catch (e) {
    await db.from("guide_deliveries").update({ attempts: (row.attempts ?? 0) + 1, error: `Refresh failed: ${String((e as any)?.message ?? e)}` }).eq("id", row.id);
    return { id: row.id, status: "scheduled", error: "refresh failed — will retry" };
  }
  if (fresh) {
    const { financial_status, fulfillment_status: _ff, cancelled, ...cols } = fresh;
    const refreshed_at = new Date().toISOString();
    row = { ...row, ...cols, refreshed_at };
    await db.from("guide_deliveries").update({ ...cols, refreshed_at }).eq("id", row.id);
    if (cancelled) {
      await db.from("guide_deliveries").update({ status: "skipped", error: "Order cancelled before send" }).eq("id", row.id);
      return { id: row.id, status: "skipped" };
    }
    if (["refunded", "voided"].includes(financial_status ?? "")) {
      await db.from("guide_deliveries").update({ status: "skipped", error: `Order ${financial_status}` }).eq("id", row.id);
      return { id: row.id, status: "skipped" };
    }
  }
  const items = row.line_items as LineItem[];
  const { matched, unmatched } = matchLineItems(items, cat, settings.auto_match);
  const base = { matched_guides: matched, unmatched_skus: unmatched, attempts: (row.attempts ?? 0) + 1 };
  if (!row.customer_email) {
    await db.from("guide_deliveries").update({ ...base, status: "skipped", error: "No customer email on order" }).eq("id", row.id);
    return { id: row.id, status: "skipped" };
  }
  if (matched.length === 0) {
    await db.from("guide_deliveries").update({ ...base, status: "skipped", error: "No guides matched any SKU" }).eq("id", row.id);
    return { id: row.id, status: "skipped" };
  }
  if (!settings.enabled && !force) {
    await db.from("guide_deliveries").update({ ...base, status: "skipped", error: "Auto-delivery disabled" }).eq("id", row.id);
    return { id: row.id, status: "skipped" };
  }
  const firstName = (row.customer_name ?? "").split(" ")[0] || "there";
  const msg = renderEmail({ brand: cat.brand, settings, firstName, orderName: row.order_name ?? `#${row.shopify_order_id}`, guides: matched });
  try {
    const resendId = await sendResend(settings, cat.brand, row.customer_email, msg);
    await db.from("guide_deliveries").update({ ...base, status: "sent", error: null, resend_id: resendId, sent_at: new Date().toISOString() }).eq("id", row.id);
    return { id: row.id, status: "sent" };
  } catch (e) {
    await db.from("guide_deliveries").update({ ...base, status: "failed", error: String(e?.message ?? e) }).eq("id", row.id);
    return { id: row.id, status: "failed", error: String(e?.message ?? e) };
  }
}

async function processPending(db: SupabaseClient, ids?: string[], force = false) {
  const settings = await loadSettings(db);
  const cat = await loadCatalog(db, settings.brand_id);
  let q = db.from("guide_deliveries").select("*").order("created_at");
  q = ids?.length ? q.in("id", ids) : q.eq("status", "scheduled").lte("send_after", new Date().toISOString()).lt("attempts", 5);
  const { data: rows, error } = await q;
  if (error) throw error;
  const results = [];
  for (const row of rows ?? []) results.push(await processOne(db, settings, cat, row, force));
  return results;
}

async function poll(db: SupabaseClient) {
  const settings = await loadSettings(db);
  const since = new Date(Date.now() - settings.poll_lookback_hours * 3600_000).toISOString();
  const data = await shopifyGet(`orders.json?status=any&fulfillment_status=shipped&updated_at_min=${encodeURIComponent(since)}&limit=250&fields=id,name,email,contact_email,created_at,customer,line_items,refunds,fulfillments,financial_status,fulfillment_status,cancelled_at,shipping_address,billing_address`);
  const orders: any[] = data.orders ?? [];
  let enqueued = 0;
  for (const o of orders) {
    if (o.cancelled_at) continue;
    if (await enqueue(db, o, "poll", settings.delay_hours)) enqueued++;
  }
  return { scanned: orders.length, enqueued };
}

// ── Webhook verification ─────────────────────────────────────────────────────
async function verifyHmac(raw: string, header: string | null) {
  const secret = Deno.env.get("SHOPIFY_WEBHOOK_SECRET");
  if (!secret) return true; // not configured → rely on re-fetch
  if (!header) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw));
  const b64 = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return b64 === header;
}

// ── Router ───────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const topic = req.headers.get("x-shopify-topic");
  const db = admin();

  try {
    // ── Shopify webhook ──
    if (topic) {
      const raw = await req.text();
      if (!(await verifyHmac(raw, req.headers.get("x-shopify-hmac-sha256")))) return json({ error: "bad hmac" }, 401);
      const payload = JSON.parse(raw);
      const id = Number(payload?.id);
      if (!id) return json({ ok: true, ignored: "no id" });
      // Always re-fetch from Shopify — the API is the source of truth, so a spoofed payload can't inject content.
      const { order } = await shopifyGet(`orders/${id}.json`);
      if (!order) return json({ ok: true, ignored: "order not found" });
      if (order.cancelled_at) return json({ ok: true, ignored: "cancelled" });
      const settings = await loadSettings(db);
      const rowId = await enqueue(db, order, "webhook", settings.delay_hours);
      if (!rowId) return json({ ok: true, duplicate_or_unshipped: true });
      return json({ ok: true, scheduled: rowId });
    }

    // ── Staff / cron actions ──
    const auth = await requireStaff(req, corsHeaders);
    if (!auth.ok) return auth.response;
    const body = await req.json().catch(() => ({}));
    const action = body.action as string;

    switch (action) {
      case "poll": {
        const p = await poll(db);
        const results = await processPending(db);
        return json({ ok: true, ...p, processed: results });
      }
      case "process":
        return json({ ok: true, processed: await processPending(db) });
      case "resend": {
        if (!body.id) return json({ error: "id required" }, 400);
        const [r] = await processPending(db, [body.id], true);
        return json({ ok: true, result: r });
      }
      case "ingest": {
        const id = Number(body.order_id);
        if (!id) return json({ error: "order_id required" }, 400);
        const { order } = await shopifyGet(`orders/${id}.json`);
        const settings = await loadSettings(db);
        const rowId = await enqueue(db, order, "manual", settings.delay_hours, !!body.force);
        if (!rowId) return json({ ok: true, duplicate_or_unshipped: true });
        if (!body.force) return json({ ok: true, scheduled: rowId });
        const [r] = await processPending(db, [rowId], true);
        return json({ ok: true, result: r });
      }
      case "preview": {
        const settings = await loadSettings(db);
        const cat = await loadCatalog(db, settings.brand_id);
        const skus: string[] = body.skus ?? [];
        const items: LineItem[] = skus.map((s) => ({ sku: s, title: s, quantity: 1, variant_title: null }));
        return json({ ok: true, ...matchLineItems(items, cat, settings.auto_match), guides_published: cat.guides.length });
      }
      case "test": {
        const to = body.to ?? auth.email;
        if (!to) return json({ error: "to required" }, 400);
        const settings = await loadSettings(db);
        const cat = await loadCatalog(db, settings.brand_id);
        const sample = cat.guides.slice(0, 2).map((g) => ({ sku: g.product_code, instruction_set_id: g.id, title: g.title, url: guideUrl(cat.brand.domain, g.slug), match: "exact" as const }));
        const msg = renderEmail({ brand: cat.brand, settings, firstName: "Test", orderName: "#TEST", guides: sample });
        const id = await sendResend(settings, cat.brand, to, msg);
        return json({ ok: true, resend_id: id, to });
      }
      case "setup-webhook": {
        // Idempotently register the Shopify orders/paid webhook pointing at this function.
        const { token, store } = shopifyEnv();
        const address = `${Deno.env.get("SUPABASE_URL")}/functions/v1/guide-delivery`;
        const TOPIC = "orders/fulfilled";
        const existing = await shopifyGet(`webhooks.json?limit=250`);
        const ours = (existing.webhooks ?? []).filter((w: any) => w.address === address);
        const removed: string[] = [];
        for (const w of ours.filter((w: any) => w.topic !== TOPIC)) {
          await fetch(`https://${store}/admin/api/${SHOPIFY_API}/webhooks/${w.id}.json`, { method: "DELETE", headers: { "X-Shopify-Access-Token": token } });
          removed.push(w.topic);
        }
        const hit = ours.find((w: any) => w.topic === TOPIC);
        if (hit) return json({ ok: true, existing: true, removed, webhook: hit });
        const res = await fetch(`https://${store}/admin/api/${SHOPIFY_API}/webhooks.json`, {
          method: "POST",
          headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
          body: JSON.stringify({ webhook: { topic: TOPIC, address, format: "json" } }),
        });
        const out = await res.json();
        return json({ ok: res.ok, removed, webhook: out.webhook ?? out }, res.ok ? 200 : 500);
      }
      case "domains": {
        // Diagnostic: which sender domains are verified on the Resend account.
        const res = await fetch("https://api.resend.com/domains", { headers: { Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}` } });
        const out = await res.json();
        return json({ ok: res.ok, domains: (out.data ?? []).map((d: any) => ({ name: d.name, status: d.status, region: d.region })) });
      }
      default:
        return json({ error: `unknown action: ${action}` }, 400);
    }
  } catch (err) {
    console.error("guide-delivery error:", err);
    return json({ error: String((err as any)?.message ?? err) }, 500);
  }
});
