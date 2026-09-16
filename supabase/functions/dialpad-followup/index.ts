// dialpad-followup — did the customer's issue get resolved by email after the call?
//
// For flagged Dialpad calls (unresolved / callback promised / complaint / low
// CSAT) this reads the handling agent's Gmail mailbox through the Google service
// account (domain-wide delegation, gmail.readonly) and asks Claude whether the
// follow-up correspondence shows the issue resolved.
//
// POST { action: "check", limit?: 8, call_ids?: string[], force?: boolean }
//   → { checked, results: [{ call_id, status, note }] }
// POST { action: "whoami" }
//   → service-account identity (client id for the Workspace admin's DWD screen)
// POST { action: "search", mailbox, query }   (debug: raw Gmail search)
//
// Auth: service-role key (pg_cron / Vercel) or a signed-in staff user's JWT.
// Secrets: GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
//          ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY.
//          Optional DIALPAD_AGENT_MAILBOXES = {"Agent Name":"mailbox@…"}, DIALPAD_DEFAULT_MAILBOX.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

// Agent → own mailbox (searched first), then the shared inbox and every staff
// mailbox: the callback is often actioned by someone else (e.g. the fitment team).
const DEFAULT_MAILBOXES: Record<string, string> = {
  "John Paguio": "johnp@automotivegroup.com.au",
  "Damian Fowler": "damianf@automotivegroup.com.au",
};
const DEFAULT_ALL_MAILBOXES = ["info@trailbait.com.au", "johnp@automotivegroup.com.au", "kylef@automotivegroup.com.au", "damianf@automotivegroup.com.au"];
const RECEPTION_NUMBERS = new Set(["+61280001629"]); // inbound via the main line carries no caller identity
const NON_CUSTOMER = ["Supplier / parts sourcing", "Internal"];
const ATTENTION_FLAGS = ["complaint", "escalation_risk", "churn_risk", "unresolved", "callback_promised"];
const STATUSES = ["resolved", "in_progress", "awaiting_customer", "no_follow_up", "unclear"];
const RECHECK_AFTER_MS = 24 * 3600e3;   // re-check open items daily
const GIVE_UP_AFTER_MS = 21 * 86400e3;  // stop re-checking calls older than 3 weeks
const MAX_THREADS = 6;
const MAX_CHARS_PER_MESSAGE = 2500;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: CORS });

// ── Auth ─────────────────────────────────────────────────────────────────────

async function authorise(req: Request): Promise<boolean> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (serviceKey && token === serviceKey) return true;
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    if (payload?.role === "service_role" && payload?.iss === "supabase") return true;
  } catch { /* not a JWT we recognise */ }
  // Signed-in staff user
  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user } } = await sb.auth.getUser();
    return Boolean(user);
  } catch { return false; }
}

// ── Google service account (domain-wide delegation) ──────────────────────────

function pemToBytes(pem: string): Uint8Array {
  const b64 = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}
const b64url = (obj: object) => btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");

const tokenCache = new Map<string, { token: string; exp: number }>();

async function googleToken(scope: string, subject?: string): Promise<string> {
  const key = `${scope}|${subject ?? ""}`;
  const hit = tokenCache.get(key);
  if (hit && hit.exp > Date.now() + 60e3) return hit.token;

  const email = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  const pem = (Deno.env.get("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY") ?? "").replace(/\\n/g, "\n");
  if (!email || !pem) throw new Error("Google service account secrets missing");

  const now = Math.floor(Date.now() / 1000);
  const claims: Record<string, unknown> = { iss: email, scope, aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 };
  if (subject) claims.sub = subject;
  const sigInput = `${b64url({ alg: "RS256", typ: "JWT" })}.${b64url(claims)}`;
  const cryptoKey = await crypto.subtle.importKey("pkcs8", pemToBytes(pem), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", cryptoKey, new TextEncoder().encode(sigInput));
  const jwt = `${sigInput}.${btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")}`;

  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  const data = await r.json();
  if (!data.access_token) throw new Error(`Google auth failed${subject ? ` for ${subject}` : ""}: ${data.error_description ?? data.error ?? JSON.stringify(data)}`);
  tokenCache.set(key, { token: data.access_token, exp: Date.now() + (Number(data.expires_in) || 3600) * 1000 });
  return data.access_token;
}

// ── Gmail ────────────────────────────────────────────────────────────────────

interface MailMessage { id: string; date: string; from: string; to: string; subject: string; text: string }
interface MailThread { id: string; subject: string; messages: MailMessage[] }

function decodeB64Url(s: string): string {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bytes = Uint8Array.from(atob(b64.padEnd(b64.length + (4 - b64.length % 4) % 4, "=")), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
function stripHtml(html: string): string {
  return html.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|tr|li|h\d)>/gi, "\n").replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
// deno-lint-ignore no-explicit-any
function bodyText(payload: any): string {
  let plain = "", html = "";
  const walk = (p: any) => {
    if (!p) return;
    if (p.mimeType === "text/plain" && p.body?.data && !plain) plain = decodeB64Url(p.body.data);
    else if (p.mimeType === "text/html" && p.body?.data && !html) html = decodeB64Url(p.body.data);
    for (const c of p.parts ?? []) walk(c);
  };
  walk(payload);
  const text = plain || stripHtml(html);
  // Drop quoted history so each message contributes only its own words.
  return text.split(/\r?\n(?:On .{5,120} wrote:|From: .{3,120}\r?\nSent:|-{3,} ?Original Message)/i)[0].trim();
}

async function gmailSearch(mailbox: string, query: string, max = MAX_THREADS): Promise<MailThread[]> {
  const token = await googleToken("https://www.googleapis.com/auth/gmail.readonly", mailbox);
  const h = { Authorization: `Bearer ${token}` };
  const list = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/threads?q=${encodeURIComponent(query)}&maxResults=${max}`, { headers: h });
  if (!list.ok) throw new Error(`Gmail search ${list.status}: ${(await list.text()).slice(0, 200)}`);
  const { threads = [] } = await list.json();
  const out: MailThread[] = [];
  for (const t of threads.slice(0, max)) {
    const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${t.id}?format=full`, { headers: h });
    if (!r.ok) continue;
    const full = await r.json();
    const messages: MailMessage[] = (full.messages ?? []).map((m: any) => {
      const hdr = (n: string) => m.payload?.headers?.find((x: any) => x.name?.toLowerCase() === n)?.value ?? "";
      return {
        id: m.id,
        date: new Date(Number(m.internalDate)).toISOString(),
        from: hdr("from"), to: hdr("to"), subject: hdr("subject"),
        text: bodyText(m.payload).slice(0, MAX_CHARS_PER_MESSAGE),
      };
    });
    out.push({ id: t.id, subject: messages[0]?.subject ?? "", messages });
  }
  return out;
}

// ── Claude ───────────────────────────────────────────────────────────────────

async function claude(system: string, user: string, maxTokens = 600): Promise<string> {
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
function parseJson<T>(text: string): T | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]) as T; } catch { return null; }
}

// ── Query building ───────────────────────────────────────────────────────────

function phoneVariants(e164: string | null): string[] {
  const d = (e164 ?? "").replace(/\D/g, "");
  if (d.length < 9) return [];
  const local9 = d.slice(-9);                 // 4xxxxxxxx
  const local10 = `0${local9}`;              // 04xxxxxxxx
  const out = new Set<string>([local10, `${local10.slice(0, 4)} ${local10.slice(4, 7)} ${local10.slice(7)}`, `${local9.slice(0, 3)} ${local9.slice(3, 6)} ${local9.slice(6)}`]);
  if (d.startsWith("61")) out.add(`+61 ${local9[0]} ${local9.slice(1, 4)} ${local9.slice(4, 7)} ${local9.slice(7)}`); // mobile spacing
  if (local10.startsWith("02") || local10.startsWith("03") || local10.startsWith("07") || local10.startsWith("08")) {
    out.add(`${local10.slice(0, 2)} ${local10.slice(2, 6)} ${local10.slice(6)}`);   // landline 02 9258 7111
    out.add(`(${local10.slice(0, 2)}) ${local10.slice(2, 6)} ${local10.slice(6)}`);
  }
  return [...out];
}

interface CallRow {
  call_id: string; started_at: string; direction: string; agent_name: string | null; contact_name: string | null;
  external_number: string | null; duration_seconds: number; ai_csat: number | null; ai_resolved: boolean | null;
  ai_purpose: string | null; ai_summary: string | null; ai_flags: string[]; transcript_text: string | null;
  followup_status: string | null; followup_checked_at: string | null;
}

async function buildQueries(call: CallRow): Promise<string[]> {
  const after = new Date(new Date(call.started_at).getTime() - 86400e3).toISOString().slice(0, 10).replace(/-/g, "/");
  const phones = phoneVariants(call.external_number).map((p) => `"${p}"`);
  const name = call.contact_name && !/^\+?[\d\s()-]+$/.test(call.contact_name) && !/reception/i.test(call.contact_name) ? `"${call.contact_name}"` : null;
  const orderRefs = [...(call.ai_summary ?? "").matchAll(/\b(?:#|SO-?|order\s*#?\s*)(\d{4,})\b/gi)].map((m) => m[1]);
  const queries: string[] = [];
  const direct = [...phones, ...(name ? [name] : []), ...orderRefs.map((r) => `"${r}"`)];
  if (direct.length) queries.push(`after:${after} (${direct.join(" OR ")})`);

  // Ask Claude for a keyword query from the transcript — catches the customer's
  // name/email spoken on the call, product names, order numbers, etc.
  const out = await claude(
    `You write Gmail search queries. Given a phone call summary and transcript excerpt, output ONLY a JSON object {"query": "...", "customer_identifiers": ["..."]}. The query must be a valid Gmail search string of 2–6 distinctive terms joined with OR (product names, vehicle model, order numbers, the customer's name or email if spoken, company name). No dates, no generic words like "order" or "call" on their own. If nothing distinctive exists, return {"query": "", "customer_identifiers": []}.`,
    `Summary: ${call.ai_summary ?? ""}\nContact: ${call.contact_name ?? ""} ${call.external_number ?? ""}\nTranscript excerpt:\n${(call.transcript_text ?? "").slice(0, 6000)}`,
    300,
  );
  const parsed = parseJson<{ query?: string; customer_identifiers?: string[] }>(out);
  if (parsed?.query?.trim()) queries.push(`after:${after} (${parsed.query.trim()})`);
  return queries;
}

// ── Verdict ──────────────────────────────────────────────────────────────────

interface LaterCall { call_id: string; started_at: string; direction: string; status: string; duration_seconds: number; agent_name: string | null; ai_summary: string | null; ai_resolved: boolean | null; ai_csat: number | null }

interface Verdict { status: string; note: string; next_action: string | null; evidence_thread_ids: string[]; evidence_call_ids?: string[] }

async function judge(call: CallRow, mailboxes: string[], threads: MailThread[], laterCalls: LaterCall[]): Promise<Verdict> {
  if (!threads.length && !laterCalls.length) return { status: "no_follow_up", note: "No email or phone follow-up found after the call.", next_action: call.ai_resolved ? null : "Follow up with the customer.", evidence_thread_ids: [], evidence_call_ids: [] };
  const mailbox = mailboxes.join(", ");
  const renderedCalls = laterCalls.map((c) => `CALL ${c.call_id} [${c.started_at}] ${c.direction} ${c.status} ${c.duration_seconds}s, agent ${c.agent_name ?? "?"}${c.ai_summary ? ` — ${c.ai_summary}` : ""}${c.ai_resolved === null ? "" : ` (resolved on that call: ${c.ai_resolved})`}`).join("\n");
  const callTime = new Date(call.started_at).getTime();
  const rendered = !threads.length ? "(none found)" : threads.map((t) => `THREAD ${t.id} — "${t.subject}"\n` + t.messages.map((m) => `  [${m.date}] ${m.date > call.started_at ? "(after call)" : "(before call)"} from ${m.from} to ${m.to}\n  ${m.text.replace(/\n/g, "\n  ")}`).join("\n")).join("\n\n");
  const out = await claude(
    `You are auditing customer-service follow-through for Automotive Group Australia (AGA; brands TrailBait, FleetCraft). You get a phone call summary, the email threads found in staff mailboxes (${mailbox}), and any LATER PHONE CALLS with the same customer number (with their own transcript summaries). Decide whether the issue raised on the call was subsequently resolved — by email or by a later call.

Respond with ONLY JSON:
{
  "status": "resolved" | "in_progress" | "awaiting_customer" | "no_follow_up" | "unclear",
  "note": one sentence (max 30 words) citing what the emails show,
  "next_action": one short sentence for AGA staff, or null if nothing is needed,
  "evidence_thread_ids": [thread ids that support the verdict],
  "evidence_call_ids": [later call ids that support the verdict]
}
Rules: "resolved" needs concrete evidence after the call (replacement sent, instructions emailed, refund confirmed, customer confirming, or a later answered call whose summary shows the need met). "in_progress" = AGA has acted (email sent, callback attempted, later call still open) but it isn't finished. "awaiting_customer" = AGA's last message/call is unanswered and needs the customer. "no_follow_up" = the threads and calls are unrelated or nothing happened after the call. Threads clearly about a different customer count as unrelated. A missed/unanswered outbound attempt alone is "in_progress", not resolved. Only items after ${new Date(callTime).toISOString()} count.`,
    `CALL (${call.started_at}, ${call.direction}, agent ${call.agent_name}, contact ${call.contact_name ?? ""} ${call.external_number ?? ""})\nPurpose: ${call.ai_purpose}\nCall summary: ${call.ai_summary}\nFlags: ${call.ai_flags.join(", ")}\nResolved on call per transcript grade: ${call.ai_resolved}\n\nLATER PHONE CALLS WITH THIS NUMBER:\n${renderedCalls || "(none)"}\n\nEMAILS:\n${rendered.slice(0, 40000)}`,
    500,
  );
  const v = parseJson<Verdict>(out);
  if (!v || !STATUSES.includes(v.status)) return { status: "unclear", note: "Could not judge the correspondence.", next_action: null, evidence_thread_ids: [], evidence_call_ids: [] };
  return { status: v.status, note: String(v.note ?? "").slice(0, 300), next_action: v.next_action ? String(v.next_action).slice(0, 200) : null, evidence_thread_ids: Array.isArray(v.evidence_thread_ids) ? v.evidence_thread_ids.map(String) : [], evidence_call_ids: Array.isArray(v.evidence_call_ids) ? v.evidence_call_ids.map(String) : [] };
}

// ── Main ─────────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!(await authorise(req))) return json({ error: "Unauthorized" }, 401);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty body ok */ }
  const action = String(body.action ?? "check");

  if (action === "whoami") {
    const email = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_EMAIL") ?? null;
    let identity: unknown = null, error: string | null = null;
    try {
      const token = await googleToken("https://www.googleapis.com/auth/cloud-platform");
      const r = await fetch(`https://iam.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(email ?? "")}`, { headers: { Authorization: `Bearer ${token}` } });
      identity = r.ok ? await r.json() : { status: r.status, body: (await r.text()).slice(0, 300) };
    } catch (e) { error = (e as Error).message; }
    return json({ service_account_email: email, identity, error, dwd_scope: "https://www.googleapis.com/auth/gmail.readonly" });
  }

  if (action === "search") {
    try {
      const threads = await gmailSearch(String(body.mailbox), String(body.query), Number(body.max) || 3);
      return json({ threads: threads.map((t) => ({ id: t.id, subject: t.subject, messages: t.messages.map((m) => ({ date: m.date, from: m.from, chars: m.text.length, preview: m.text.slice(0, 200) })) })) });
    } catch (e) { return json({ error: (e as Error).message }, 502); }
  }

  // action: check
  const sb = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
  const limit = Math.min(Number(body.limit) || 8, 25);
  const agentMailboxes = { ...DEFAULT_MAILBOXES, ...(JSON.parse(Deno.env.get("DIALPAD_AGENT_MAILBOXES") ?? "{}") as Record<string, string>) };
  const allMailboxes: string[] = JSON.parse(Deno.env.get("DIALPAD_MAILBOXES") ?? "null") ?? DEFAULT_ALL_MAILBOXES;

  let q = sb.from("dialpad_calls")
    .select("call_id,started_at,direction,agent_name,contact_name,external_number,duration_seconds,ai_csat,ai_resolved,ai_purpose,ai_summary,ai_flags,transcript_text,followup_status,followup_checked_at")
    .not("ai_graded_at", "is", null).is("ai_skip_reason", null)
    .gte("started_at", new Date(Date.now() - 30 * 86400e3).toISOString())
    .order("started_at", { ascending: false });
  if (Array.isArray(body.call_ids) && body.call_ids.length) q = q.in("call_id", body.call_ids.map(String));
  const { data, error } = await q.limit(400);
  if (error) return json({ error: error.message }, 500);

  const now = Date.now();
  const due = ((data ?? []) as CallRow[]).filter((c) => {
    if (NON_CUSTOMER.includes(c.ai_purpose ?? "")) return false;
    const flagged = c.ai_resolved === false || (c.ai_csat ?? 5) <= 2 || c.ai_flags.some((f) => ATTENTION_FLAGS.includes(f));
    if (!flagged && !body.force) return false;
    if (body.force) return true;
    if (!c.followup_checked_at) return true;
    if (c.followup_status === "resolved") return false;
    const age = now - new Date(c.started_at).getTime();
    return age < GIVE_UP_AFTER_MS && now - new Date(c.followup_checked_at).getTime() > RECHECK_AFTER_MS;
  }).slice(0, limit);

  const results: Array<Record<string, unknown>> = [];
  const t0 = Date.now();
  for (const call of due) {
    if (Date.now() - t0 > 110e3) break; // stay under the edge runtime wall clock
    const own = agentMailboxes[call.agent_name ?? ""];
    const mailboxes = [...new Set([...(own ? [own] : []), ...allMailboxes])];
    try {
      // Later calls with the same customer number (phone callbacks count as follow-through).
      let laterCalls: LaterCall[] = [];
      if (call.external_number && !RECEPTION_NUMBERS.has(call.external_number) && !/reception/i.test(call.contact_name ?? "")) {
        const { data: lc } = await sb.from("dialpad_calls")
          .select("call_id,started_at,direction,status,duration_seconds,agent_name,ai_summary,ai_resolved,ai_csat")
          .eq("external_number", call.external_number).gt("started_at", call.started_at)
          .order("started_at", { ascending: true }).limit(6);
        laterCalls = (lc ?? []) as LaterCall[];
      }
      const queries = await buildQueries(call);
      const seen = new Map<string, MailThread & { mailbox: string }>();
      outer: for (const mailbox of mailboxes) {
        for (const query of queries) {
          try {
            for (const t of await gmailSearch(mailbox, query)) if (!seen.has(t.id)) seen.set(t.id, { ...t, mailbox });
          } catch (e) {
            const msg = (e as Error).message;
            if (/Google auth failed/i.test(msg) && mailbox === mailboxes[0]) throw e; // DWD problem on the primary box — surface it
            console.warn("[dialpad-followup] search failed", mailbox, msg);
          }
          if (seen.size >= MAX_THREADS) break outer;
        }
      }
      const threads = [...seen.values()].slice(0, MAX_THREADS);
      const v = await judge(call, mailboxes, threads, laterCalls);
      const evidence: Record<string, unknown>[] = threads.filter((t) => v.evidence_thread_ids.includes(t.id)).map((t) => ({
        type: "email", thread_id: t.id, subject: t.subject, mailbox: t.mailbox,
        date: t.messages[t.messages.length - 1]?.date ?? null, from: t.messages[t.messages.length - 1]?.from ?? null,
        messages: t.messages.length,
      }));
      for (const c of laterCalls.filter((c) => (v.evidence_call_ids ?? []).includes(c.call_id))) {
        evidence.push({ type: "call", thread_id: `call:${c.call_id}`, call_id: c.call_id, subject: `Call ${new Date(c.started_at).toLocaleDateString("en-AU", { day: "numeric", month: "short" })} (${c.direction}, ${c.status})${c.ai_summary ? `: ${c.ai_summary}` : ""}`, mailbox: null, date: c.started_at, from: c.agent_name, messages: 1 });
      }
      await sb.from("dialpad_calls").update({
        followup_status: v.status, followup_note: v.note, followup_next_action: v.next_action,
        followup_evidence: evidence, followup_mailbox: mailboxes.join(","), followup_checked_at: new Date().toISOString(), followup_error: null,
      }).eq("call_id", call.call_id);
      results.push({ call_id: call.call_id, status: v.status, note: v.note, threads: threads.length, later_calls: laterCalls.length, queries });
    } catch (e) {
      const msg = (e as Error).message;
      await sb.from("dialpad_calls").update({ followup_error: msg.slice(0, 300), followup_checked_at: new Date().toISOString() }).eq("call_id", call.call_id);
      results.push({ call_id: call.call_id, error: msg });
      if (/Google auth failed|unauthorized_client|invalid_grant/i.test(msg)) break; // DWD not set up — don't burn the batch
    }
  }
  return json({ checked: results.length, due: due.length, results });
});
