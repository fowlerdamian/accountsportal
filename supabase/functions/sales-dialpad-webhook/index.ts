import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Strip everything except digits, then return the last 10 digits for comparison.
 *  AU mobiles are 10 digits (04xx xxx xxx); international +61 strips to 11 → last 10 = 04xx...
 *  9 digits was too short: 0412345678 and 0512345678 both end in "412345678" if only 9 taken. */
function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 8 ? digits.slice(-10) : null;
}

function deriveStatus(payload: Record<string, any>): "answered" | "missed" | "voicemail" {
  if (payload.voicemail_url || payload.state === "voicemail") return "voicemail";
  if ((payload.duration ?? 0) > 0) return "answered";
  return "missed";
}

// ─── JWT verification ─────────────────────────────────────────────────────────
// Dialpad signs webhook events as HS256 JWTs using the secret configured on the
// webhook. Verify the signature before trusting the payload.

function b64urlToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64.padEnd(b64.length + (4 - b64.length % 4) % 4, "=");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

async function verifyDialpadJwt(body: string, secret: string): Promise<Record<string, any> | null> {
  const parts = body.trim().split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;

  try {
    const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(headerB64)));
    if (header.alg !== "HS256") return null;

    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      b64urlToBytes(sigB64),
      new TextEncoder().encode(`${headerB64}.${payloadB64}`),
    );
    if (!valid) return null;

    return JSON.parse(new TextDecoder().decode(b64urlToBytes(payloadB64)));
  } catch {
    return null;
  }
}

// ─── Main handler ─────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  // Fail closed: the webhook secret must be configured, and every event must be
  // a JWT with a valid HMAC-SHA256 signature under it.
  const webhookSecret = Deno.env.get("DIALPAD_WEBHOOK_SECRET");
  if (!webhookSecret) {
    console.error("[dialpad-webhook] DIALPAD_WEBHOOK_SECRET not set — refusing request");
    return new Response(JSON.stringify({ error: "auth not configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  let payload: Record<string, any>;
  try {
    const body = await req.text();
    const verified = await verifyDialpadJwt(body, webhookSecret);
    if (!verified) {
      console.warn("[dialpad-webhook] rejected event with invalid/missing JWT signature");
      return new Response("Unauthorized", { status: 401 });
    }
    payload = verified;
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  // Only process hangup/ended events
  const eventType = payload.event_type ?? payload.state ?? "";
  if (!["hangup", "hungup", "ended", "missed", "voicemail"].includes(eventType)) {
    return new Response(JSON.stringify({ skipped: true, event: eventType }), { status: 200 });
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const direction: "inbound" | "outbound" =
    payload.direction === "inbound" ? "inbound" : "outbound";

  // The customer's number (external party)
  const externalNumber: string | null =
    payload.external_number ?? payload.contact_phone ?? null;

  const fromNumber = direction === "outbound"
    ? (payload.internal_number ?? payload.caller_number ?? null)
    : externalNumber;

  const toNumber = direction === "outbound"
    ? externalNumber
    : (payload.internal_number ?? payload.called_number ?? null);

  // Dialpad reports `duration` in milliseconds as a float (e.g. "323902.389");
  // the column is integer seconds.
  const durationSeconds = Math.max(0, Math.round(Number(payload.duration ?? 0) / 1000)) || 0;
  const status = deriveStatus(payload);

  const startedAt = payload.date_started
    ? new Date(payload.date_started).toISOString()
    : null;
  const endedAt = payload.date_ended
    ? new Date(payload.date_ended).toISOString()
    : null;

  // ── Match lead by normalizing the external phone number ────────────────────
  let leadId: string | null = null;
  const normExternal = normalizePhone(externalNumber);

  if (normExternal) {
    // Check lusha_mobile and phone columns
    const { data: leads } = await sb
      .from("sales_leads")
      .select("id, phone, lusha_mobile")
      .or(`phone.not.is.null,lusha_mobile.not.is.null`)
      .limit(500);

    if (leads) {
      const matched = leads.find((l) => {
        return (
          normalizePhone(l.phone)        === normExternal ||
          normalizePhone(l.lusha_mobile) === normExternal
        );
      });
      if (matched) leadId = matched.id;
    }
  }

  // ── Insert or upsert call log ──────────────────────────────────────────────
  const { error } = await sb.from("sales_call_logs").upsert(
    {
      dialpad_call_id:  payload.call_id ?? payload.id ?? null,
      lead_id:          leadId,
      direction,
      from_number:      fromNumber,
      to_number:        toNumber,
      duration_seconds: durationSeconds,
      status,
      started_at:       startedAt,
      ended_at:         endedAt,
      recording_url:    payload.recording_url ?? payload.voicemail_url ?? null,
    },
    { onConflict: "dialpad_call_id", ignoreDuplicates: false },
  );

  if (error) {
    console.error("[dialpad-webhook] insert error:", error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  console.log("[dialpad-webhook] logged call:", {
    call_id: payload.call_id, leadId, status, durationSeconds,
  });

  return new Response(JSON.stringify({ ok: true, leadId, status }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
