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
      "description": "string — charge description",
      "detail": "string or null — extra detail, shipment ref, zone, etc.",
      "charged_total": number,
      "contracted_total": null
    }
  ]
}
Rules:
- invoice_ref: look for Invoice No, Invoice Number, Ref, Reference, Tax Invoice #
- carrier_name: the company that issued the invoice (not the recipient)
- invoice_date: look for Invoice Date, Date, Tax Invoice Date
- due_date: look for Due Date, Payment Due, Pay By
- lines: each distinct charge row — road freight, fuel levy, remote area surcharge, handling fees, GST, etc.
- charged_total: numeric dollar amount (no $ sign, no commas) — always positive
- contracted_total: always null (we do not know contracted rates from the invoice alone)
- If a value cannot be found, use null
- Return ONLY the raw JSON object`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json();
    const { text } = body;

    if (!text) {
      return new Response(
        JSON.stringify({ error: "No text provided" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: [{
          role: "user",
          content: `Parse this freight invoice:\n\n${text}`,
        }],
      }),
    });

    if (!claudeRes.ok) {
      const errText = await claudeRes.text();
      let errDetail = errText.substring(0, 300);
      try { errDetail = JSON.parse(errText)?.error?.message ?? errDetail; } catch {}
      return new Response(
        JSON.stringify({ error: `Claude API error: ${claudeRes.status} — ${errDetail}` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const claudeData = await claudeRes.json();
    const responseText = claudeData.content?.[0]?.text ?? "";

    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return new Response(
        JSON.stringify({ error: "Claude did not return valid JSON", raw: responseText.substring(0, 500) }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return new Response(
      JSON.stringify(parsed),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
