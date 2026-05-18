import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Same channel pitches the UI falls back to — kept here so the model sees the
// "house line" as one of the raw inputs to rephrase.
const CHANNEL_PITCH: Record<string, string> = {
  trailbait:  "Accelerate accessory fitment times through innovative products. Add additional unique products to increase average invoice value.",
  fleetcraft: "Accelerate accessory fitment times through innovative products such as wiring looms and brackets.",
  aga:        "We offer turn-key products to complement your range without the need to design and manufacture yourself.",
};

const CHANNEL_LABEL: Record<string, string> = {
  trailbait:  "TrailBait (wholesale & distribution)",
  fleetcraft: "FleetCraft (fleet & commercial upfit)",
  aga:        "AGA Bespoke (OEM / own-brand)",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  let body: { lead_id?: string; force?: boolean } = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const leadId = body.lead_id?.trim();
  const force  = !!body.force;
  if (!leadId) {
    return new Response(
      JSON.stringify({ error: "lead_id required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY") ?? "";

  const { data: lead, error } = await supabase
    .from("sales_leads")
    .select("*")
    .eq("id", leadId)
    .maybeSingle();
  if (error || !lead) {
    return new Response(
      JSON.stringify({ error: error?.message ?? "lead not found" }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Serve the cache unless the caller explicitly forced a refresh.
  if (!force && Array.isArray(lead.ai_brief_bullets) && lead.ai_brief_bullets.length > 0) {
    return new Response(
      JSON.stringify({ bullets: lead.ai_brief_bullets, cached: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // ── Build the raw-data block the model summarises ──────────────────────────
  const contact = lead.recommended_contact_name
    ? `${[lead.recommended_contact_title, lead.recommended_contact_name, lead.recommended_contact_last_name].filter(Boolean).join(" ")}${lead.recommended_contact_position ? ", " + lead.recommended_contact_position : ""}`
    : null;

  const notes = Array.isArray(lead.hubspot_previous_contact)
    ? lead.hubspot_previous_contact
        .slice(0, 3)
        .map((n: { date: string; body: string }) => `  - [${n.date}] ${(n.body ?? "").slice(0, 200)}`)
        .join("\n")
    : "";

  const sections: string[] = [
    `Company: ${lead.company_name}`,
    `Sales channel: ${CHANNEL_LABEL[lead.channel] ?? lead.channel}`,
    `Channel pitch (our standard angle): ${CHANNEL_PITCH[lead.channel] ?? ""}`,
    lead.address               ? `Address: ${lead.address}`                                                       : "",
    lead.website               ? `Website: ${lead.website}`                                                       : "",
    lead.google_rating != null ? `Google: ${lead.google_rating}★ (${lead.google_review_count ?? 0} reviews)`     : "",
    lead.industry              ? `Industry: ${lead.industry}`                                                     : "",
    lead.employee_count        ? `Employees: ${lead.employee_count}`                                              : "",
    lead.founded_year          ? `Founded: ${lead.founded_year}`                                                  : "",
    lead.is_existing_customer  ? `Existing TrailBait customer (Cin7 tag: ${lead.cin7_customer_tag ?? "yes"}).`    : "",
    lead.website_summary       ? `Website summary:\n${lead.website_summary}`                                      : "",
    lead.company_description   ? `Company description:\n${lead.company_description}`                              : "",
    lead.tender_context        ? `Tender / contract context:\n${lead.tender_context}`                             : "",
    lead.key_products_services?.length ? `Key products/services: ${lead.key_products_services.join(", ")}`        : "",
    contact                    ? `Recommended contact: ${contact}${lead.recommended_contact_source ? " (via " + lead.recommended_contact_source + ")" : ""}` : "",
    notes                      ? `Recent HubSpot notes:\n${notes}`                                                : "",
    lead.disqualification_reason ? `Prior disqualification reason: ${lead.disqualification_reason}`               : "",
  ].filter(Boolean);

  const prompt = `You are preparing a fact-sheet for an Australian automotive accessories distributor's salesperson before they call this lead. Read the raw data and write EXACTLY 3 bullets that collate the verified facts and figures already present.

Each bullet must:
- Be one sentence, max 25 words.
- Cite specific names, numbers, dates, products, contracts, locations, or counts visible in the data.
- State facts only. Do NOT recommend, pitch, suggest opening lines, propose questions, or speculate about fit.
- Never invent details that are not in the raw data. If a field is missing, leave it out — do not fill gaps.

Together the 3 bullets should cover, in order:
(1) What the company is and what it sells / does.
(2) Its scale and footprint — employees, locations, founded year, revenue, key product lines or contracts.
(3) The most specific signal worth noting before calling — named contact, recent activity, tender win, customer status, prior conversation. Skip this bullet entirely (return only 2) if no such signal exists in the data.

Return ONLY the bullets, one per line, each starting with "- ". No headers, no preamble, no closing remarks.

Raw data:
${sections.join("\n")}`;

  const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
    method:  "POST",
    headers: {
      "x-api-key":         apiKey,
      "anthropic-version": "2023-06-01",
      "content-type":      "application/json",
    },
    body: JSON.stringify({
      model:      "claude-haiku-4-5-20251001",
      max_tokens: 350,
      messages:   [{ role: "user", content: prompt }],
    }),
  });

  if (!aiRes.ok) {
    const txt = await aiRes.text().catch(() => "");
    return new Response(
      JSON.stringify({ error: `Anthropic ${aiRes.status}: ${txt.slice(0, 300)}` }),
      { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const json: any = await aiRes.json();
  const raw: string = json?.content?.[0]?.text ?? "";
  // Parse "- bullet" lines, strip leading dash + spaces, drop empties, take 3.
  const bullets = raw
    .split(/\r?\n/)
    .map((l) => l.replace(/^[\s•\-\*\d.\)]+/, "").trim())
    .filter((l) => l.length > 0)
    .slice(0, 3);

  if (bullets.length === 0) {
    return new Response(
      JSON.stringify({ error: "Empty AI response", raw }),
      { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  await supabase
    .from("sales_leads")
    .update({ ai_brief_bullets: bullets, ai_brief_generated_at: new Date().toISOString() })
    .eq("id", leadId);

  return new Response(
    JSON.stringify({ bullets, cached: false }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
