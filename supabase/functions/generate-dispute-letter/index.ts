import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveModel } from "../_shared/model.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Verify Supabase JWT
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: authHeader } } }
  );
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const { invoice_ref, carrier_name, invoice_date, flagged_lines, total_overcharge_aud, carrier_terms } = await req.json();

    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not configured");

    const bulletLines = flagged_lines
      .map((l) => `• ${l.description} / ${l.detail} / overcharge: $${l.variance_aud.toFixed(2)}`)
      .join("\n");

    const termsBlock = carrier_terms
      ? `\nThe carrier's OWN PUBLISHED TERMS relevant to these charges:\n"""\n${carrier_terms}\n"""\n`
      : "";

    const prompt = `Write a professional freight invoice dispute email body to ${carrier_name} for invoice ${invoice_ref} dated ${invoice_date}.

Disputed line items (with supporting evidence from our booking records in square brackets):
${bulletLines}
Total disputed: $${total_overcharge_aud.toFixed(2)}
${termsBlock}
- Professional, firm and CONCISE — no over-explaining
- PLAIN TEXT ONLY — this is pasted into an email client. Absolutely NO markdown: no asterisks, no pipe tables, no headings, no blockquotes. Use plain sentences and simple bullet lines starting with "- "
- Reference the invoice number and date. Do NOT name or describe the recipient company (never write "issued to ..." or similar)
- Structure, in this exact order:
  1. Opening: one or two sentences disputing the charges on the invoice (number + date), stating the total disputed and requesting a credit note for the full amount within 5 business days
  2. Itemised list, ONE plain line per disputed item, e.g.: - DHI123456789 - 840 x 180 x 170 mm, 8,500 g - $9.93   (end with a "- Total - $X" line)
  3. LAST: the explanation — quote the carrier's relevant published criteria verbatim (in quotation marks) and state plainly that the items above fall outside those criteria (or, for overcharges, that the booked/quoted figure is the agreed price)
- No per-item paragraphs and no sentences about calibrated equipment / contractual records
- Under 180 words. BODY TEXT ONLY: no subject line, no letterhead, no address blocks, and NO signature block or sign-off`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: await resolveModel(ANTHROPIC_API_KEY),
        max_tokens: 1500,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Anthropic API error: ${response.status} ${errText}`);
    }

    const result = await response.json();
    const letter = result.content?.[0]?.text ?? "";

    return new Response(JSON.stringify({ letter }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
