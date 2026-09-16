// community-sync — builds Community profiles from three sources and one identity index.
//
//   orders  Shopify Admin REST  → contact (email / phone / customer id / name / address) + order note
//   calls   dialpad_calls       → contact by phone; unmatched callers get Claude to pull name /
//                                 email / order number out of the transcript
//   emails  Gmail (info@trailbait.com.au + staff boxes, via the Google service account with
//           domain-wide delegation) → contact by the external party's address + email note
//   profiles Claude writes a short AI summary for contacts with new activity
//
// Identity resolution: every normalised email, E.164 phone and Shopify customer id maps to
// exactly one contact (community_identities). When one record links identities that belong
// to two different contacts, the newer contact is merged into the older one.
//
// POST { action: "sync", phases?: ["orders","calls","emails","profiles"], budget_ms?: number }
// POST { action: "status" }
// Auth: service-role key (pg_cron) or a signed-in staff user's JWT.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: CORS });

const SHOPIFY_API = "2024-10";
const INTERNAL_DOMAINS = ["automotivegroup.com.au", "automotivegroupaustralia.com.au", "trailbait.com.au", "fleetcraft.com.au"];
const DEFAULT_MAILBOXES = ["info@trailbait.com.au", "johnp@automotivegroup.com.au", "kylef@automotivegroup.com.au", "damianf@automotivegroup.com.au"];
const RECEPTION_NUMBERS = new Set(["+61280001629"]);
const AUTOMATED_SENDER = /(no-?reply|donotreply|do-not-reply|notifications?@|mailer-daemon|postmaster|newsletter|bounce|alerts?@|@shopify\.com|@dearsystems\.com|@hubspot|@google\.com|@dialpad\.com|@xero\.com|@stripe\.com|@paypal|@afterpay|@zip\.co|@auspost|@startrack|@sendle|@shippit|@aramex|@couriersplease|@linkedin|@facebookmail|@synergywholesale|@vercel|@supabase|@github|@atlassian|@canva|@zoom\.us|@calendly|unsubscribe)/i;
const INITIAL_LOOKBACK_DAYS = 90;

// ── Auth ─────────────────────────────────────────────────────────────────────

async function authorise(req: Request): Promise<boolean> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (serviceKey && token === serviceKey) return true;
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    if (payload?.role === "service_role" && payload?.iss === "supabase") return true;
  } catch { /* not a JWT */ }
  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "", { global: { headers: { Authorization: `Bearer ${token}` } } });
    const { data: { user } } = await sb.auth.getUser();
    return Boolean(user);
  } catch { return false; }
}

// ── Normalisers ──────────────────────────────────────────────────────────────

export function normEmail(raw: unknown): string | null {
  const s = String(raw ?? "").trim().toLowerCase();
  const m = s.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/);
  return m ? m[0] : null;
}
/** Australian-first E.164: 04xx→+614xx, 61xx→+61xx, other 8+ digit numbers keep their digits. */
export function normPhone(raw: unknown): string | null {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (d.length < 8) return null;
  if (d.startsWith("0061")) d = d.slice(2);
  if (d.startsWith("61") && (d.length === 11 || d.length === 10)) return `+${d}`;
  if (d.startsWith("0") && d.length === 10) return `+61${d.slice(1)}`;
  if (d.length === 9 && /^[2-9]/.test(d)) return `+61${d}`;
  return `+${d}`;
}
const prettyPhone = (e164: string) => {
  const d = e164.replace(/\D/g, "");
  if (d.startsWith("614") && d.length === 11) return `0${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8)}`;
  if (d.startsWith("61") && d.length === 11) return `0${d[2]} ${d.slice(3, 7)} ${d.slice(7)}`;
  return e164;
};
const isInternalEmail = (e: string) => INTERNAL_DOMAINS.some((d) => e.endsWith(`@${d}`));
const splitName = (full: string | null | undefined) => {
  const s = String(full ?? "").replace(/\s+/g, " ").trim();
  if (!s) return { first: null as string | null, last: null as string | null };
  const parts = s.split(" ");
  return { first: parts[0], last: parts.slice(1).join(" ") || null };
};
const parseAddressHeader = (h: string): { name: string | null; email: string | null }[] =>
  h.split(",").map((part) => {
    const m = part.match(/^\s*"?([^"<]*)"?\s*<([^>]+)>\s*$/);
    if (m) return { name: m[1].trim() || null, email: normEmail(m[2]) };
    return { name: null, email: normEmail(part) };
  }).filter((x) => x.email);

// ── Supabase helpers ─────────────────────────────────────────────────────────

const admin = () => createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");

async function getState(sb: SupabaseClient, key: string): Promise<Record<string, unknown>> {
  const { data } = await sb.from("community_sync_state").select("value").eq("key", key).maybeSingle();
  return (data?.value as Record<string, unknown>) ?? {};
}
async function setState(sb: SupabaseClient, key: string, value: Record<string, unknown>) {
  await sb.from("community_sync_state").upsert({ key, value, updated_at: new Date().toISOString() });
}

interface Hints {
  emails?: (string | null | undefined)[];
  phones?: (string | null | undefined)[];
  shopify_customer_id?: string | number | null;
  first_name?: string | null; last_name?: string | null; company?: string | null;
  address?: Record<string, unknown> | null;
  newsletter?: boolean | null;
  source: string;
  seen_at?: string;
}

/**
 * Find-or-create the single contact for a set of identifiers. If the identifiers
 * currently point at several contacts, merge them (oldest wins). Returns contact id.
 */
async function resolveContact(sb: SupabaseClient, h: Hints): Promise<string | null> {
  const emails = [...new Set((h.emails ?? []).map(normEmail).filter((e): e is string => !!e && !isInternalEmail(e)))];
  const phones = [...new Set((h.phones ?? []).map(normPhone).filter((p): p is string => !!p && !RECEPTION_NUMBERS.has(p)))];
  const shopify = h.shopify_customer_id ? String(h.shopify_customer_id) : null;
  const keys: { kind: string; value: string }[] = [
    ...(shopify ? [{ kind: "shopify_customer", value: shopify }] : []),
    ...emails.map((value) => ({ kind: "email", value })),
    ...phones.map((value) => ({ kind: "phone", value })),
  ];
  if (!keys.length) return null;

  // Existing identities
  const filters = keys.map((k) => `and(kind.eq.${k.kind},value.eq."${k.value.replace(/"/g, "")}")`).join(",");
  const { data: found } = await sb.from("community_identities").select("contact_id,kind,value").or(filters);
  let contactIds = [...new Set((found ?? []).map((f) => f.contact_id as string))];

  let contactId: string;
  if (contactIds.length === 0) {
    const { data: created, error } = await sb.from("community_contacts").insert({
      first_name: h.first_name ?? null, last_name: h.last_name ?? null, company_name: h.company ?? null,
      email_jsonb: emails.map((email) => ({ email, type: "Work" })),
      phone_jsonb: phones.map((number) => ({ number: prettyPhone(number), type: "Work" })),
      address: h.address ?? null, has_newsletter: Boolean(h.newsletter), shopify_customer_id: shopify,
      first_seen: h.seen_at ?? new Date().toISOString(), last_seen: h.seen_at ?? new Date().toISOString(),
      status: "cold",
    }).select("id").single();
    if (error) throw new Error(`create contact: ${error.message}`);
    contactId = created.id;
  } else {
    if (contactIds.length > 1) {
      // Same person seen under two identities → merge newer into older.
      const { data: rows } = await sb.from("community_contacts").select("id,created_at").in("id", contactIds).order("created_at", { ascending: true });
      const ordered = (rows ?? []).map((r) => r.id as string);
      const keep = ordered[0] ?? contactIds[0];
      for (const drop of ordered.slice(1)) {
        const { error } = await sb.rpc("community_merge_contacts", { p_keep: keep, p_drop: drop });
        if (error) console.warn("[community-sync] merge failed", keep, drop, error.message);
      }
      contactIds = [keep];
    }
    contactId = contactIds[0];
    // Fill gaps + add newly seen identifiers to the display arrays
    const { data: c } = await sb.from("community_contacts").select("first_name,last_name,company_name,email_jsonb,phone_jsonb,address,shopify_customer_id,has_newsletter,last_seen,first_seen").eq("id", contactId).single();
    if (c) {
      const patch: Record<string, unknown> = {};
      const knownEmails = new Set((c.email_jsonb as { email: string }[]).map((e) => e.email.toLowerCase()));
      const addEmails = emails.filter((e) => !knownEmails.has(e));
      if (addEmails.length) patch.email_jsonb = [...(c.email_jsonb as unknown[]), ...addEmails.map((email) => ({ email, type: "Work" }))];
      const knownPhones = new Set((c.phone_jsonb as { number: string }[]).map((p) => normPhone(p.number)));
      const addPhones = phones.filter((p) => !knownPhones.has(p));
      if (addPhones.length) patch.phone_jsonb = [...(c.phone_jsonb as unknown[]), ...addPhones.map((number) => ({ number: prettyPhone(number), type: "Work" }))];
      if (!c.first_name && h.first_name) patch.first_name = h.first_name;
      if (!c.last_name && h.last_name) patch.last_name = h.last_name;
      if (!c.company_name && h.company) patch.company_name = h.company;
      if (!c.address && h.address) patch.address = h.address;
      if (!c.shopify_customer_id && shopify) patch.shopify_customer_id = shopify;
      if (h.newsletter && !c.has_newsletter) patch.has_newsletter = true;
      if (h.seen_at && h.seen_at > c.last_seen) patch.last_seen = h.seen_at;
      if (h.seen_at && h.seen_at < c.first_seen) patch.first_seen = h.seen_at;
      if (Object.keys(patch).length) await sb.from("community_contacts").update(patch).eq("id", contactId);
    }
  }
  // Register identities (ignore ones already owned)
  const rows = keys.map((k) => ({ contact_id: contactId, kind: k.kind, value: k.value, source: h.source }));
  const { error: idErr } = await sb.from("community_identities").upsert(rows, { onConflict: "kind,value", ignoreDuplicates: true });
  if (idErr) console.warn("[community-sync] identities", idErr.message);
  return contactId;
}

async function addNote(sb: SupabaseClient, note: { contact_id: string; kind: string; text: string; date: string; source_ref: string; meta: Record<string, unknown> }) {
  const { error } = await sb.from("community_notes").upsert({ ...note, status: note.kind }, { onConflict: "kind,source_ref", ignoreDuplicates: false });
  if (error) console.warn("[community-sync] note", note.kind, note.source_ref, error.message);
}

// ── Claude ───────────────────────────────────────────────────────────────────

async function claude(system: string, user: string, maxTokens = 400): Promise<string> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");
  const model = Deno.env.get("ANTHROPIC_MODEL_HAIKU") ?? "claude-haiku-4-5";
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }),
  });
  if (!r.ok) throw new Error(`Anthropic ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const data = await r.json();
  return data?.content?.map((c: { text?: string }) => c.text ?? "").join("") ?? "";
}
const parseJson = <T,>(t: string): T | null => { const m = t.match(/\{[\s\S]*\}/); if (!m) return null; try { return JSON.parse(m[0]) as T; } catch { return null; } };

// ── Google (domain-wide delegation) ──────────────────────────────────────────

function pemToBytes(pem: string): Uint8Array {
  const b64 = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}
const b64url = (obj: object) => btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
const tokenCache = new Map<string, { token: string; exp: number }>();
async function googleToken(scope: string, subject: string): Promise<string> {
  const key = `${scope}|${subject}`;
  const hit = tokenCache.get(key);
  if (hit && hit.exp > Date.now() + 60e3) return hit.token;
  const email = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  const pem = (Deno.env.get("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY") ?? "").replace(/\\n/g, "\n");
  if (!email || !pem) throw new Error("Google service account secrets missing");
  const now = Math.floor(Date.now() / 1000);
  const claims = { iss: email, sub: subject, scope, aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 };
  const sigInput = `${b64url({ alg: "RS256", typ: "JWT" })}.${b64url(claims)}`;
  const cryptoKey = await crypto.subtle.importKey("pkcs8", pemToBytes(pem), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", cryptoKey, new TextEncoder().encode(sigInput));
  const jwt = `${sigInput}.${btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")}`;
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}` });
  const data = await r.json();
  if (!data.access_token) throw new Error(`Google auth failed for ${subject}: ${data.error_description ?? data.error ?? JSON.stringify(data)}`);
  tokenCache.set(key, { token: data.access_token, exp: Date.now() + (Number(data.expires_in) || 3600) * 1000 });
  return data.access_token;
}

// ── Phase: Shopify orders ────────────────────────────────────────────────────

async function syncOrders(sb: SupabaseClient, deadline: number) {
  const token = Deno.env.get("SHOPIFY_ACCESS_TOKEN"); const store = Deno.env.get("SHOPIFY_STORE_DOMAIN");
  if (!token || !store) return { skipped: "SHOPIFY_ACCESS_TOKEN / SHOPIFY_STORE_DOMAIN not configured" };
  const state = await getState(sb, "shopify");
  const since = (state.updated_at as string) ?? new Date(Date.now() - INITIAL_LOOKBACK_DAYS * 86400e3).toISOString();
  const headers = { "X-Shopify-Access-Token": token };
  const fields = "id,name,order_number,created_at,updated_at,email,phone,customer,shipping_address,billing_address,total_price,currency,financial_status,fulfillment_status,line_items,tags,cancelled_at,note,buyer_accepts_marketing";
  let url: string | null = `https://${store}/admin/api/${SHOPIFY_API}/orders.json?status=any&updated_at_min=${encodeURIComponent(since)}&limit=100&order=updated_at+asc&fields=${fields}`;
  let processed = 0, pages = 0, maxUpdated = since;
  const touched = new Set<string>();
  while (url && pages < 5 && Date.now() < deadline) {
    const res: Response = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`Shopify ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const { orders = [] } = await res.json();
    pages++;
    for (const o of orders) {
      if (Date.now() > deadline) break;
      const cust = o.customer ?? {};
      const ship = o.shipping_address ?? {}; const bill = o.billing_address ?? {};
      const name = splitName(`${cust.first_name ?? ship.first_name ?? bill.first_name ?? ""} ${cust.last_name ?? ship.last_name ?? bill.last_name ?? ""}`);
      const contactId = await resolveContact(sb, {
        emails: [o.email, cust.email], phones: [o.phone, cust.phone, ship.phone, bill.phone],
        shopify_customer_id: cust.id ?? null, first_name: name.first, last_name: name.last,
        company: ship.company ?? bill.company ?? null,
        address: ship.address1 ? { address1: ship.address1, address2: ship.address2 ?? null, city: ship.city, province: ship.province, zip: ship.zip, country: ship.country } : null,
        newsletter: Boolean(o.buyer_accepts_marketing ?? cust.accepts_marketing), source: "shopify", seen_at: o.created_at,
      });
      if (!contactId) continue;
      touched.add(contactId);
      const items = (o.line_items ?? []).map((li: any) => ({ title: li.title, sku: li.sku ?? null, qty: li.quantity, price: Number(li.price) }));
      const total = Number(o.total_price);
      const status = [o.financial_status, o.fulfillment_status ?? "unfulfilled", o.cancelled_at ? "cancelled" : null].filter(Boolean).join(" · ");
      await addNote(sb, {
        contact_id: contactId, kind: "order", source_ref: String(o.id), date: o.created_at,
        text: `Order ${o.name} · ${items.reduce((s: number, i: any) => s + i.qty, 0)} item${items.length === 1 ? "" : "s"} · $${total.toFixed(2)} ${o.currency} · ${status}\n${items.map((i: any) => `• ${i.qty} × ${i.title}${i.sku ? ` (${i.sku})` : ""}`).join("\n")}`,
        meta: { order_id: o.id, name: o.name, total, currency: o.currency, financial_status: o.financial_status, fulfillment_status: o.fulfillment_status, cancelled_at: o.cancelled_at, line_items: items, tags: o.tags, note: o.note, url: `https://${store}/admin/orders/${o.id}` },
      });
      processed++;
      if (o.updated_at > maxUpdated) maxUpdated = o.updated_at;
    }
    const link = res.headers.get("link") ?? "";
    const next = link.match(/<([^>]+)>;\s*rel="next"/);
    url = next ? next[1] : null;
  }
  for (const id of touched) await sb.rpc("community_recompute_stats", { p_contact: id });
  if (processed) await setState(sb, "shopify", { updated_at: maxUpdated });
  return { processed, pages, contacts: touched.size, more: Boolean(url), watermark: maxUpdated };
}

// ── Phase: Dialpad calls ─────────────────────────────────────────────────────

async function syncCalls(sb: SupabaseClient, deadline: number) {
  const state = await getState(sb, "calls");
  const since = (state.started_at as string) ?? new Date(Date.now() - INITIAL_LOOKBACK_DAYS * 86400e3).toISOString();
  const { data: calls, error } = await sb.from("dialpad_calls")
    .select("call_id,started_at,direction,status,duration_seconds,external_number,contact_name,agent_name,ai_csat,ai_sentiment,ai_resolved,ai_purpose,ai_summary,ai_flags,ai_skip_reason,followup_status,transcript_text")
    .gt("started_at", since).order("started_at", { ascending: true }).limit(80);
  if (error) throw new Error(error.message);
  let processed = 0, skipped = 0, extracted = 0, last = since;
  const touched = new Set<string>();
  for (const c of calls ?? []) {
    if (Date.now() > deadline) break;
    last = c.started_at;
    if (c.ai_purpose === "Internal" || c.ai_purpose === "Supplier / parts sourcing") { skipped++; continue; }
    const phone = normPhone(c.external_number);
    const viaReception = !phone || RECEPTION_NUMBERS.has(phone) || /reception/i.test(c.contact_name ?? "");
    const hints: Hints = { phones: viaReception ? [] : [phone], source: "dialpad", seen_at: c.started_at };
    const nameFromDialpad = c.contact_name && !/^\+?[\d\s()-]+$/.test(c.contact_name) && !/reception/i.test(c.contact_name) ? splitName(c.contact_name) : null;
    if (nameFromDialpad) { hints.first_name = nameFromDialpad.first; hints.last_name = nameFromDialpad.last; }

    // Unknown caller (or reception line): let Claude read the transcript for identity.
    const known = !viaReception && (await sb.from("community_identities").select("contact_id").eq("kind", "phone").eq("value", phone!).maybeSingle()).data;
    if (!known && c.transcript_text && c.transcript_text.length > 200 && extracted < 20) {
      extracted++;
      const out = await claude(
        `Extract the CUSTOMER's identity from an Australian auto-accessories support call transcript (AGA staff: ${c.agent_name ?? "unknown"}). Respond with ONLY JSON: {"first_name": string|null, "last_name": string|null, "email": string|null, "company": string|null, "order_number": string|null, "vehicle": string|null}. Use null when not clearly stated. Never invent.`,
        c.transcript_text.slice(0, 7000), 200);
      const id = parseJson<{ first_name?: string | null; last_name?: string | null; email?: string | null; company?: string | null; order_number?: string | null }>(out);
      if (id) {
        if (id.email) hints.emails = [id.email];
        if (id.first_name && !hints.first_name) hints.first_name = id.first_name;
        if (id.last_name && !hints.last_name) hints.last_name = id.last_name;
        if (id.company) hints.company = id.company;
        if (id.order_number && !id.email) {
          const { data: ord } = await sb.from("community_notes").select("contact_id").eq("kind", "order").ilike("meta->>name", `%${String(id.order_number).replace(/[^0-9a-z]/gi, "")}`).limit(1).maybeSingle();
          if (ord) hints.emails = [...(hints.emails ?? [])], (hints as any).existing_contact = ord.contact_id;
        }
      }
    }
    let contactId: string | null = (hints as any).existing_contact ?? null;
    if (!contactId) contactId = await resolveContact(sb, hints);
    if (!contactId) { skipped++; continue; } // reception-line call with nothing identifiable
    touched.add(contactId);
    const mins = Math.floor(c.duration_seconds / 60), secs = c.duration_seconds % 60;
    const head = `${c.direction === "inbound" ? "Inbound" : "Outbound"} call · ${c.status}${c.status === "answered" ? ` · ${mins}m ${secs.toString().padStart(2, "0")}s` : ""}${c.agent_name ? ` · ${c.agent_name}` : ""}`;
    await addNote(sb, {
      contact_id: contactId, kind: "call", source_ref: c.call_id, date: c.started_at,
      text: c.ai_summary ? `${head}\n${c.ai_summary}` : head,
      meta: { direction: c.direction, status: c.status, duration_seconds: c.duration_seconds, agent: c.agent_name, csat: c.ai_csat, sentiment: c.ai_sentiment, resolved: c.ai_resolved, purpose: c.ai_purpose, flags: c.ai_flags, followup_status: c.followup_status, number: c.external_number },
    });
    processed++;
  }
  for (const id of touched) await sb.rpc("community_recompute_stats", { p_contact: id });
  if ((calls?.length ?? 0) > 0) await setState(sb, "calls", { started_at: last });
  return { processed, skipped, extracted, contacts: touched.size, more: (calls?.length ?? 0) >= 80, watermark: last };
}

// ── Phase: emails ────────────────────────────────────────────────────────────

async function syncEmails(sb: SupabaseClient, deadline: number) {
  const mailboxes: string[] = JSON.parse(Deno.env.get("COMMUNITY_MAILBOXES") ?? "null") ?? DEFAULT_MAILBOXES;
  const out: Record<string, unknown> = {};
  for (const mailbox of mailboxes) {
    if (Date.now() > deadline) { out[mailbox] = "budget exhausted"; break; }
    try {
      const state = await getState(sb, `gmail:${mailbox}`);
      const sinceMs = Number(state.internal_date_ms ?? 0) || Date.now() - INITIAL_LOOKBACK_DAYS * 86400e3;
      const token = await googleToken("https://www.googleapis.com/auth/gmail.readonly", mailbox);
      const h = { Authorization: `Bearer ${token}` };
      let pageToken: string | undefined; let pages = 0, processed = 0, skipped = 0, maxSeen = sinceMs;
      const touched = new Set<string>();
      do {
        const q = `after:${Math.floor(sinceMs / 1000)} -in:spam -in:trash -in:draft -category:promotions -category:social`;
        const list = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(q)}&maxResults=60${pageToken ? `&pageToken=${pageToken}` : ""}`, { headers: h });
        if (!list.ok) throw new Error(`Gmail list ${list.status}: ${(await list.text()).slice(0, 200)}`);
        const data = await list.json();
        pages++;
        for (const m of data.messages ?? []) {
          if (Date.now() > deadline) break;
          const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject`, { headers: h });
          if (!r.ok) continue;
          const msg = await r.json();
          const internal = Number(msg.internalDate);
          if (internal <= sinceMs) continue;
          if (internal > maxSeen) maxSeen = internal;
          const hdr = (n: string) => msg.payload?.headers?.find((x: any) => x.name?.toLowerCase() === n.toLowerCase())?.value ?? "";
          const from = parseAddressHeader(hdr("From"))[0];
          const to = [...parseAddressHeader(hdr("To")), ...parseAddressHeader(hdr("Cc"))];
          if (!from?.email) { skipped++; continue; }
          const outbound = isInternalEmail(from.email);
          const counterparts = outbound ? to.filter((t) => t.email && !isInternalEmail(t.email!)) : [from];
          const party = counterparts.find((p) => p.email && !AUTOMATED_SENDER.test(p.email));
          if (!party?.email || AUTOMATED_SENDER.test(from.email) || (!outbound && AUTOMATED_SENDER.test(from.email))) { skipped++; continue; }
          const name = splitName(party.name);
          const contactId = await resolveContact(sb, { emails: [party.email], first_name: name.first, last_name: name.last, source: `gmail:${mailbox}`, seen_at: new Date(internal).toISOString() });
          if (!contactId) { skipped++; continue; }
          touched.add(contactId);
          const subject = hdr("Subject") || "(no subject)";
          const snippet = String(msg.snippet ?? "").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
          await addNote(sb, {
            contact_id: contactId, kind: "email", source_ref: msg.id, date: new Date(internal).toISOString(),
            text: `${outbound ? "Sent" : "Received"}: ${subject}\n${snippet}`,
            meta: { direction: outbound ? "outbound" : "inbound", from: from.email, to: to.map((t) => t.email), subject, thread_id: msg.threadId, mailbox, url: `https://mail.google.com/mail/u/0/#all/${msg.threadId}` },
          });
          processed++;
        }
        pageToken = data.nextPageToken;
      } while (pageToken && pages < 2 && Date.now() < deadline); // ≤120 messages per mailbox per run so every mailbox gets a turn
      for (const id of touched) await sb.rpc("community_recompute_stats", { p_contact: id });
      if (maxSeen > sinceMs && !pageToken) await setState(sb, `gmail:${mailbox}`, { internal_date_ms: maxSeen });
      else if (maxSeen > sinceMs) await setState(sb, `gmail:${mailbox}`, { internal_date_ms: sinceMs, partial_max: maxSeen }); // more pages next run
      out[mailbox] = { processed, skipped, pages, contacts: touched.size, more: Boolean(pageToken) };
    } catch (e) {
      out[mailbox] = { error: (e as Error).message };
    }
  }
  return out;
}

// ── Phase: AI profile summaries ──────────────────────────────────────────────

async function syncProfiles(sb: SupabaseClient, deadline: number) {
  const { data: contacts } = await sb.from("community_contacts")
    .select("id,first_name,last_name,company_name,ai_summary_at,last_seen,nb_orders,nb_calls,nb_emails,total_spent")
    .or("ai_summary_at.is.null,ai_summary_at.lt.last_seen")
    .order("last_seen", { ascending: false }).limit(12);
  let written = 0;
  for (const c of contacts ?? []) {
    if (Date.now() > deadline) break;
    if (c.ai_summary_at && c.ai_summary_at >= c.last_seen) continue;
    const { data: notes } = await sb.from("community_notes").select("kind,date,text").eq("contact_id", c.id).order("date", { ascending: false }).limit(14);
    if (!notes?.length) continue;
    const feed = notes.map((n) => `[${n.date.slice(0, 10)} ${n.kind}] ${n.text.slice(0, 500)}`).join("\n");
    try {
      const summary = await claude(
        "You write a 2–3 sentence customer profile for Automotive Group Australia staff (brands TrailBait, FleetCraft; 4x4 and trailer accessories). Plain English, present tense, no bullet points, no preamble. Cover: who they are (trade / retail, vehicle if known), what they've bought or asked about, how things stand now (open issue, happy, waiting on us).",
        `Contact: ${[c.first_name, c.last_name].filter(Boolean).join(" ") || "unknown name"}${c.company_name ? ` (${c.company_name})` : ""}\nOrders: ${c.nb_orders} ($${Number(c.total_spent).toFixed(0)}) · Calls: ${c.nb_calls} · Emails: ${c.nb_emails}\n\nActivity, newest first:\n${feed.slice(0, 9000)}`, 300);
      await sb.from("community_contacts").update({ ai_summary: summary.trim().slice(0, 900), ai_summary_at: new Date().toISOString() }).eq("id", c.id);
      written++;
    } catch (e) { console.warn("[community-sync] summary", c.id, (e as Error).message); }
  }
  return { written };
}

// ── Main ─────────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!(await authorise(req))) return json({ error: "Unauthorized" }, 401);
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* ok */ }
  const sb = admin();

  if (body.action === "status") {
    const { data } = await sb.from("community_sync_state").select("key,value,updated_at");
    const { count } = await sb.from("community_contacts").select("id", { count: "exact", head: true });
    return json({ contacts: count, state: data });
  }

  const phases = (Array.isArray(body.phases) && body.phases.length ? body.phases : ["orders", "calls", "emails", "profiles"]) as string[];
  const t0 = Date.now();
  const budget = Math.min(Number(body.budget_ms) || 120e3, 140e3);
  const out: Record<string, unknown> = {};
  // Absolute per-phase deadlines so the later phases always get their share.
  const at = (share: number) => t0 + Math.floor(budget * share);
  try {
    if (phases.includes("orders")) out.orders = await syncOrders(sb, at(0.22)).catch((e) => ({ error: (e as Error).message }));
    if (phases.includes("calls")) out.calls = await syncCalls(sb, at(0.5)).catch((e) => ({ error: (e as Error).message }));
    if (phases.includes("emails")) out.emails = await syncEmails(sb, at(0.82)).catch((e) => ({ error: (e as Error).message }));
    if (phases.includes("profiles")) out.profiles = await syncProfiles(sb, t0 + budget - 3e3).catch((e) => ({ error: (e as Error).message }));
    await setState(sb, "last_run", { at: new Date().toISOString(), elapsed_ms: Date.now() - t0, result: out });
    return json({ ok: true, elapsed_ms: Date.now() - t0, ...out });
  } catch (e) {
    return json({ ok: false, error: (e as Error).message, elapsed_ms: Date.now() - t0, ...out }, 500);
  }
});
