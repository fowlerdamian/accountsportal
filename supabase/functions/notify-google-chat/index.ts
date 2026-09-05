// notify-google-chat — the single gate for every Google Chat notification the
// portal sends (Guide feedback/support, auto-delivery alerts, task DMs, task
// reminders, finance digest, contractor hub, ShipStation, daily focus digest).
//
// Business hours: Mon–Fri 8:00–17:00 Australia/Brisbane. Inside them a message
// posts immediately. Outside them it is parked in public.chat_outbox with
// send_after = next opening time; the chat-outbox-flush cron (every 5 min)
// calls { action: "flush" } and the backlog goes out at 8am.
//
// Body:
//   { text, webhook_url?, urgent?, source?, policy? }
//                                             — send (webhook_url override needs a
//                                               staff JWT or the service key). policy:
//                                               "queue" (default) parks off-hours messages
//                                               for 8am; "skip" drops them (daily digests /
//                                               reminders that would only be stale by then).
//                                               Anonymous callers can only reach the support spaces.
//   { action: "flush" }                       — service role / cron: send everything due
//   { action: "status" }                      — staff: queue depth + hours state

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireStaff } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const TZ = "Australia/Brisbane";
const OPEN_HOUR = 8, CLOSE_HOUR = 17;

function brisbaneParts(at: Date) {
  const parts = new Intl.DateTimeFormat("en-AU", { timeZone: TZ, weekday: "short", hour: "numeric", hour12: false, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday").slice(0, 3));
  return { weekday, hour: Number(get("hour")) % 24, y: Number(get("year")), m: Number(get("month")), d: Number(get("day")) };
}
export function isBusinessHours(at = new Date()): boolean {
  const { weekday, hour } = brisbaneParts(at);
  return weekday >= 1 && weekday <= 5 && hour >= OPEN_HOUR && hour < CLOSE_HOUR;
}
/** Next 8am Brisbane on a weekday (or now, when open). Brisbane has no DST, so +10:00 is exact. */
export function nextSendTime(at = new Date()): Date {
  if (isBusinessHours(at)) return at;
  const { weekday, hour, y, m, d } = brisbaneParts(at);
  const eightAm = (yy: number, mm: number, dd: number) => new Date(Date.UTC(yy, mm - 1, dd, OPEN_HOUR - 10, 0, 0));
  if (weekday >= 1 && weekday <= 5 && hour < OPEN_HOUR) return eightAm(y, m, d);
  let day = new Date(Date.UTC(y, m - 1, d));
  let wd = weekday;
  do { day = new Date(day.getTime() + 86_400_000); wd = (wd + 1) % 7; } while (wd === 0 || wd === 6);
  return eightAm(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate());
}

function supportSpaces(): string[] {
  return [...new Set(
    [Deno.env.get("GCHAT_SUPPORT_WEBHOOK"), Deno.env.get("GCHAT_SUPPORT_WEBHOOK_2")]
      .filter((v): v is string => !!v).flatMap((v) => v.split(",")).map((v) => v.trim()).filter(Boolean),
  )];
}

async function post(url: string, text: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }), signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { ok: false, error: `Webhook ${res.status}: ${(await res.text()).slice(0, 200)}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String((e as any)?.message ?? e) };
  }
}

function admin() {
  return createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
}

async function flush() {
  const db = admin();
  const { data: due, error } = await db.from("chat_outbox").select("id,webhook_url,text,attempts")
    .is("sent_at", null).lte("send_after", new Date().toISOString()).lt("attempts", 5)
    .order("created_at").limit(200);
  if (error) throw error;
  let sent = 0, failed = 0;
  for (const row of due ?? []) {
    const r = await post(row.webhook_url, row.text);
    if (r.ok) { sent++; await db.from("chat_outbox").update({ sent_at: new Date().toISOString(), attempts: row.attempts + 1, last_error: null }).eq("id", row.id); }
    else { failed++; await db.from("chat_outbox").update({ attempts: row.attempts + 1, last_error: r.error }).eq("id", row.id); }
  }
  return { ok: true, due: (due ?? []).length, sent, failed };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "");

    if (action === "flush" || action === "status") {
      const auth = await requireStaff(req, corsHeaders);
      if (!auth.ok) return auth.response;
      if (action === "flush") return json(await flush());
      const db = admin();
      const { count } = await db.from("chat_outbox").select("id", { count: "exact", head: true }).is("sent_at", null);
      return json({ open: isBusinessHours(), next_send: nextSendTime().toISOString(), queued: count ?? 0 });
    }

    const text = String(body.text ?? "").trim();
    if (!text) return json({ ok: false, error: "No text provided" }, 400);
    if (text.length > 4000) return json({ ok: false, error: "Text too long" }, 400);

    // Targets: explicit webhook (staff/service only) or the configured support spaces.
    let targets: string[];
    if (body.webhook_url) {
      const auth = await requireStaff(req, corsHeaders);
      if (!auth.ok) return auth.response;
      const url = String(body.webhook_url);
      if (!/^https:\/\/chat\.googleapis\.com\//.test(url)) return json({ ok: false, error: "webhook_url must be a Google Chat webhook" }, 400);
      targets = [url];
    } else {
      targets = supportSpaces();
      if (targets.length === 0) {
        console.warn("No GCHAT_SUPPORT_WEBHOOK(_2) configured");
        return json({ ok: false, error: "Webhook not configured" });
      }
    }

    const urgent = body.urgent === true;
    const now = new Date();
    if (!urgent && !isBusinessHours(now)) {
      if (body.policy === "skip") return json({ ok: true, skipped: true, reason: "outside business hours" });
      const send_after = nextSendTime(now).toISOString();
      const db = admin();
      const { error } = await db.from("chat_outbox").insert(targets.map((webhook_url) => ({ webhook_url, text, source: body.source ? String(body.source).slice(0, 80) : null, send_after })));
      if (error) throw error;
      return json({ ok: true, queued: targets.length, send_after });
    }

    const results = await Promise.all(targets.map((u) => post(u, text)));
    const delivered = results.filter((r) => r.ok).length;
    results.forEach((r, i) => { if (!r.ok) console.error(`Google Chat webhook ${i} failed:`, r.error); });
    return json({ ok: delivered > 0, delivered, total: targets.length });
  } catch (err: any) {
    console.error("notify-google-chat error:", err);
    return json({ ok: false, error: err?.message ?? String(err) }, 500);
  }
});
