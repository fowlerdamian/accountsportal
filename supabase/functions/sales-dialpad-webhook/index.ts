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

// ─── Main handler ─────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  let payload: Record<string, any>;
  try {
    const body = await req.text();
    // Dialpad sends events as a JWT — decode the payload segment (base64url → JSON)
    if (body.includes(".")) {
      const parts = body.trim().split(".");
      if (parts.length >= 2) {
        const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
        const json = atob(b64.padEnd(b64.length + (4 - b64.length % 4) % 4, "="));
        payload = JSON.parse(json);
      } else {
        payload = JSON.parse(body);
      }
    } else {
      payload = JSON.parse(body);
    }
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

  const durationSeconds = payload.duration ?? 0;
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
