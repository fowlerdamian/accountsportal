// logistics-parse-invoice v2 — extract STRUCTURED line data for the audit
// engine (logistics-match-invoice).
// Speed: real carrier invoices are big (TNT weekly ≈ 5 pages / 110 charge
// lines ≈ 8k+ output tokens), so this uses Haiku (fast) with a 32k output
// budget, streamed so nothing times out or truncates.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Haiku on purpose: 3-5x faster than Sonnet for structured extraction.
const PARSE_MODEL = "claude-haiku-4-5-20251001";

// mode:"header" — fast first stage: only the invoice header fields, from the
// start of the document. Lets the upload window close in seconds while the
// full line extraction runs as a second background call.
const HEADER_PROMPT = `You are an expert at reading freight carrier invoices.
Extract ONLY the invoice header and return ONLY valid JSON — no markdown, no preamble:
{
  "invoice_ref": "string — invoice/reference number (Invoice No, Tax Invoice Number, Ref)",
  "carrier_name": "string — the company that ISSUED the invoice (not the recipient)",
  "invoice_date": "YYYY-MM-DD or null",
  "due_date": "YYYY-MM-DD or null"
}
Return ONLY the raw JSON object.`;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `You are an expert at parsing freight carrier invoices.
Extract the following and return ONLY valid JSON — no markdown, no preamble, no backticks:
{
  "invoice_ref": "string — invoice/reference number",
  "carrier_name": "string — carrier or company name that issued this invoice",
  "invoice_date": "YYYY-MM-DD or null",
  "due_date": "YYYY-MM-DD or null",
  "lines": [
    {
      "description": "string — charge description as printed",
      "detail": "string or null — shipment ref, zone, extra detail",
      "tracking": "string or null — con note / consignment / tracking number for this shipment line",
      "service": "string or null — normalised service name (e.g. 'Road Express', 'Overnight', 'Fuel Levy', 'GST')",
      "origin": "string or null — origin city/zone code (e.g. 'SYD')",
      "destination": "string or null — destination city/zone code (e.g. 'MEL')",
      "weight_kg": number or null,
      "qty": number or null,
      "charged_total": number
    }
  ]
}
Rules:
- invoice_ref: look for Invoice No, Invoice Number, Ref, Reference, Tax Invoice #
- carrier_name: the company that ISSUED the invoice (not the recipient)
- lines: one per distinct charge row — freight legs, fuel levy, surcharges, handling, GST. Skip payment/credit/balance rows (negative "Payment, Thank You" style entries).
- charged_total: the line total EXCLUDING GST. When the invoice shows both GST-inclusive and GST-exclusive totals per line (TNT style), ALWAYS use the "Total excluding GST" figure (it already includes any per-line fuel/security surcharge). Never use the GST-inclusive figure.
- service: normalise to the carrier's service name; use 'Fuel Levy' for standalone fuel surcharge lines, 'Manual Handling' for MHP / manual handling process fees, and 'GST' for tax lines
- origin/destination: use 3-letter city codes where identifiable (SYD, MEL, BNE, ADL, PER, HBA, DRW, CBR); otherwise the name as printed; null if not applicable (e.g. levy lines)
- tracking: the con note / consignment / article / tracking number tied to the shipment — critical for weight verification; null for levy/tax lines
- weight_kg: chargeable/billed weight if shown, else actual weight; null if none
- qty: item/consignment count if shown
- charged_total: numeric dollars, no $ or commas, always positive
- If a value cannot be found, use null
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

    const { text, mode } = await req.json();
    if (!text) throw new Error("No text provided");
    const isHeader = mode === "header";

    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: PARSE_MODEL,
        max_tokens: isHeader ? 400 : 32000,   // large weekly invoices — never truncate
        stream: true,        // required for large max_tokens; also avoids idle timeouts
        system: isHeader ? HEADER_PROMPT : SYSTEM_PROMPT,
        messages: [{
          role: "user",
          // Header fields live at the top of the document — a slice keeps it fast
          content: `Parse this freight invoice:\n\n${isHeader ? text.slice(0, 6000) : text}`,
        }],
      }),
    });

    if (!claudeRes.ok) {
      const errText = await claudeRes.text();
      let errDetail = errText.substring(0, 300);
      try { errDetail = JSON.parse(errText)?.error?.message ?? errDetail; } catch { /* raw */ }
      throw new Error(`Claude API error: ${claudeRes.status} — ${errDetail}`);
    }

    // Accumulate the SSE stream into the full response text
    let responseText = "";
    const reader = claudeRes.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const events = buf.split("\n");
      buf = events.pop() ?? "";
      for (const line of events) {
        if (!line.startsWith("data: ")) continue;
        let ev;
        try { ev = JSON.parse(line.slice(6)); } catch { continue; } // keepalives/partials
        if (ev.type === "content_block_delta" && ev.delta?.text) responseText += ev.delta.text;
        if (ev.type === "error") throw new Error(ev.error?.message ?? "stream error");
      }
    }
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("Claude did not return valid JSON");

    const parsed = JSON.parse(jsonMatch[0]);
    if (isHeader) {
      return new Response(JSON.stringify(parsed), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!Array.isArray(parsed.lines) || parsed.lines.length === 0) {
      throw new Error("No line items found in the document");
    }
    // Defensive numeric coercion — drop unusable rows rather than fail the import
    parsed.lines = parsed.lines
      .filter((l: Record<string, unknown>) => l.description && l.charged_total != null)
      .map((l: Record<string, unknown>) => ({
        ...l,
        charged_total: Number(l.charged_total),
        weight_kg: l.weight_kg != null ? Number(l.weight_kg) : null,
        qty: l.qty != null ? Number(l.qty) : null,
      }))
      .filter((l: { charged_total: number }) => !Number.isNaN(l.charged_total));

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
