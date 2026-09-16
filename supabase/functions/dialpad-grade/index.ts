// dialpad-grade — grades a Dialpad call transcript for customer satisfaction.
//
// POST { call_id, transcript, direction, agent_name, contact_name, duration_seconds }
//  → { csat, sentiment, resolved, purpose, summary, flags, model }
//
// Called by api/dialpad-sync.js (Vercel) with the service-role key. Self-contained
// (no _shared imports) so it deploys cleanly through the Supabase MCP.
//
// Secrets: ANTHROPIC_API_KEY, optional ANTHROPIC_MODEL_HAIKU override.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

const PURPOSES = [
  "Order status", "Product enquiry", "Fitment / compatibility", "Pricing / quote",
  "Warranty / fault", "Return / refund", "Freight / delivery", "Payment / invoice",
  "Supplier / parts sourcing", "Internal", "Other",
];

const FLAGS = ["complaint", "escalation_risk", "churn_risk", "praise", "callback_promised", "unresolved"];

const SYSTEM = `You grade phone calls for Automotive Group Australia (AGA), an Australian
4x4 / trailer accessories business (brands: TrailBait, FleetCraft). Given a
transcript, infer how satisfied the CUSTOMER (the non-AGA party) was by the end
of the call. AGA staff are the agents; suppliers AGA is calling count as the
"customer" of the call only for tone purposes, and the purpose should then be
"Supplier / parts sourcing". Transcripts are machine-generated and noisy — judge
the substance, not typos.

Respond with ONLY a JSON object, no prose:
{
  "csat": 1-5 integer (5 = delighted, 4 = satisfied, 3 = neutral/unclear, 2 = frustrated, 1 = angry or clearly failed),
  "sentiment": "positive" | "neutral" | "negative",
  "resolved": true | false  (was the customer's need met or clearly handed to a concrete next step on this call),
  "purpose": one of ${JSON.stringify(PURPOSES)},
  "summary": one sentence, max 25 words, plain English, no names of private individuals,
  "flags": subset of ${JSON.stringify(FLAGS)}
}`;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: CORS });
}

function isServiceRole(req: Request): boolean {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (serviceKey && token === serviceKey) return true;
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload?.role === "service_role" && payload?.iss === "supabase";
  } catch { return false; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!isServiceRole(req)) return json({ error: "Unauthorized" }, 401);

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ error: "ANTHROPIC_API_KEY not configured" }, 500);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Bad JSON" }, 400); }

  const transcript = String(body.transcript ?? "").trim();
  if (transcript.length < 40) return json({ error: "transcript too short" }, 400);

  const meta = [
    `Direction: ${body.direction ?? "unknown"}`,
    `AGA agent: ${body.agent_name ?? "unknown"}`,
    `Other party: ${body.contact_name ?? "unknown"}`,
    `Duration: ${body.duration_seconds ?? "?"}s`,
  ].join("\n");

  const model = Deno.env.get("ANTHROPIC_MODEL_HAIKU") ?? "claude-haiku-4-5";
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model,
      max_tokens: 400,
      system: SYSTEM,
      messages: [{ role: "user", content: `${meta}\n\nTranscript:\n${transcript.slice(0, 24000)}` }],
    }),
  });
  if (!r.ok) {
    const text = await r.text();
    console.error("[dialpad-grade] anthropic", r.status, text.slice(0, 300));
    return json({ error: `Anthropic ${r.status}`, detail: text.slice(0, 300) }, 502);
  }
  const data = await r.json();
  const text: string = data?.content?.map((c: { text?: string }) => c.text ?? "").join("") ?? "";
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return json({ error: "no JSON in model output", raw: text.slice(0, 300) }, 502);

  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(match[0]); } catch { return json({ error: "unparseable JSON", raw: text.slice(0, 300) }, 502); }

  const csat = Math.min(5, Math.max(1, Math.round(Number(parsed.csat) || 3)));
  const sentiment = ["positive", "neutral", "negative"].includes(String(parsed.sentiment)) ? String(parsed.sentiment) : "neutral";
  const purpose = PURPOSES.includes(String(parsed.purpose)) ? String(parsed.purpose) : "Other";
  const flags = Array.isArray(parsed.flags) ? parsed.flags.map(String).filter((f) => FLAGS.includes(f)) : [];

  return json({
    call_id: body.call_id ?? null,
    csat,
    sentiment,
    resolved: Boolean(parsed.resolved),
    purpose,
    summary: String(parsed.summary ?? "").slice(0, 300),
    flags,
    model,
  });
});
