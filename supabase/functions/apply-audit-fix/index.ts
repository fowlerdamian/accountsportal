import Anthropic from 'npm:@anthropic-ai/sdk';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { documentTitle, clause, currentContent, finding, recommendation, companyProfile } = await req.json();

    const client = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') });

    const message = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 8000,
      messages: [{
        role: 'user',
        content: `You are an ISO 9001:2015 QMS documentation expert. Update the following document to address audit findings.

Company: ${companyProfile?.companyName || 'Company'}
Document: ${documentTitle} (Clause ${clause})

AUDIT FINDINGS TO ADDRESS:
${finding}

RECOMMENDATIONS:
${recommendation}

CURRENT DOCUMENT:
${currentContent}

Make the SMALLEST possible edits that resolve the findings — this is a targeted fix, not a rewrite:
- Change ONLY the specific sections the findings call out. Add the missing element or correct the specific error.
- Preserve every other sentence, heading, table, and wording EXACTLY as-is, character for character. Do not rephrase, reorder, "improve", or re-flow unaffected text.
- Do not touch the metadata table (Document No., Version, dates).
This keeps the document stable so a re-audit doesn't surface new issues from changed wording.

Return the complete updated document in Markdown format only — no preamble or explanation.`,
      }],
    });

    const content = message.content[0].type === 'text' ? message.content[0].text : '';

    return new Response(JSON.stringify({ content }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
