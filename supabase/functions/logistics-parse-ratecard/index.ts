// logistics-parse-ratecard — AI importer: maps any carrier rate card document
// (text extracted from PDF/CSV/XLSX client-side) into structured entries that
// the rate engine can compute against.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveModel } from "../_shared/model.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `You are an expert at parsing freight carrier rate cards / pricing schedules.
Extract the contracted rates and return ONLY valid JSON — no markdown, no preamble, no backticks:
{
  "name": "string — short label for this rate card (e.g. 'Toll FY26 National Rates')",
  "effective_from": "YYYY-MM-DD or null",
  "entries": [
    {
      "service": "string — service name (e.g. 'Road Express', 'Overnight', 'Fuel Levy')",
      "origin": "string or null — origin city/zone (3-letter code where identifiable: SYD, MEL, BNE, ADL, PER, HBA, DRW, CBR); null if the rate applies to all origins",
      "destination": "string or null — destination city/zone; null if all destinations",
      "rate_type": "per_kg | per_item | flat | percent",
      "rate": number,
      "base_charge": number — fixed charge added on top of per_kg/per_item calc; 0 if none,
      "min_charge": number or null — minimum charge floor,
      "notes": "string or null"
    }
  ]
}
Rules:
- One entry per service+lane combination. A rate matrix (origins × destinations) becomes one entry per cell.
- rate_type 'percent' is for fuel levies / surcharges expressed as % — rate is the percentage number (18.5, not 0.185)
- rate for per_kg is $/kg; per_item is $/item; flat is total $
- Never invent rates. Only extract what is in the document.
- If a value cannot be found, use null (or 0 for base_charge)
- Return ONLY the raw JSON object`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Verify Supabase JWT
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const supabaseAuth = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: authHeader } } }
  );
  const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
  if (authError || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");

    const { text } = await req.json();
    if (!text) throw new Error("No text provided");

    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: await resolveModel(apiKey),
        max_tokens: 16384,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: `Parse this carrier rate card:\n\n${text}` }],
      }),
    });

    if (!claudeRes.ok) {
      const errText = await claudeRes.text();
      let errDetail = errText.substring(0, 300);
      try { errDetail = JSON.parse(errText)?.error?.message ?? errDetail; } catch { /* raw */ }
      throw new Error(`Claude API error: ${claudeRes.status} — ${errDetail}`);
    }

    const claudeData = await claudeRes.json();
    const responseText = claudeData.content?.[0]?.text ?? "";
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("Claude did not return valid JSON");

    const parsed = JSON.parse(jsonMatch[0]);
    const VALID_TYPES = ["per_kg", "per_item", "flat", "percent"];
    if (!Array.isArray(parsed.entries)) throw new Error("No rate entries found in the document");
    parsed.entries = parsed.entries
      .filter((e: Record<string, unknown>) =>
        e.service && VALID_TYPES.includes(e.rate_type as string) && e.rate != null && !Number.isNaN(Number(e.rate)))
      .map((e: Record<string, unknown>) => ({
        ...e,
        rate: Number(e.rate),
        base_charge: e.base_charge != null && !Number.isNaN(Number(e.base_charge)) ? Number(e.base_charge) : 0,
        min_charge: e.min_charge != null && !Number.isNaN(Number(e.min_charge)) ? Number(e.min_charge) : null,
      }));
    if (parsed.entries.length === 0) throw new Error("No valid rate entries found in the document");

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
