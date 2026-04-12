const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `You are an expert at parsing product installation instruction documents for automotive parts.
Extract the following and return ONLY valid JSON — no markdown, no preamble, no backticks:
{
  "title": "string",
  "product_code": "string or null",
  "short_description": "string, max 300 chars — clean customer-facing sentence",
  "tools_required": ["array of tool name strings"],
  "estimated_time": "string or null",
  "vehicles": [{"make": "string", "model": "string", "year_from": number, "year_to": number or null}],
  "steps": [
    {
      "step_number": 1,
      "subtitle": "short descriptive title",
      "description": "full instructions, line breaks as \\n",
      "has_image": true or false
    }
  ]
}
Rules:
- Identify steps from headings like Step 1, 1., numbered lists, or procedural breaks
- For tools look for Tools Required, What You Will Need, Materials, Equipment sections
- Also extract tools mentioned inline (e.g. "use a 10mm spanner")
- For estimated time look for Installation Time, Time Required, Approx time
- For vehicles look for Suitable For, Fits, Compatible With, Vehicle Application sections
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
    const { text, pdfBase64, pageImages } = body;

    if (!text && !pdfBase64 && (!pageImages || pageImages.length === 0)) {
      return new Response(
        JSON.stringify({ error: "No text, pdfBase64, or pageImages provided" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build Claude API request
    const messages: any[] = [];

    if (pageImages?.length) {
      // Vision mode: pre-rendered JPEG page images (avoids large PDF body)
      const imageBlocks = pageImages.slice(0, 20).map((b64: string) => ({
        type: "image",
        source: { type: "base64", media_type: "image/jpeg", data: b64 },
      }));
      messages.push({
        role: "user",
        content: [
          ...imageBlocks,
          {
            type: "text",
            text: "Extract all installation guide information from these PDF page images. Follow the system instructions exactly.",
          },
        ],
      });
    } else if (pdfBase64) {
      // Legacy vision mode: full PDF base64 document
      messages.push({
        role: "user",
        content: [
          {
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: pdfBase64 },
          },
          {
            type: "text",
            text: "Extract all installation guide information from this PDF document. Follow the system instructions exactly.",
          },
        ],
      });
    } else {
      // Text mode
      messages.push({
        role: "user",
        content: `Extract all installation guide information from the following document text. Follow the system instructions exactly.\n\n${text}`,
      });
    }

    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages,
      }),
    });

    if (!claudeRes.ok) {
      const errText = await claudeRes.text();
      return new Response(
        JSON.stringify({ error: `Claude API error: ${claudeRes.status}`, detail: errText.substring(0, 300) }),
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
