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
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
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

Revise the document to address all findings while maintaining the existing structure and company-specific content. Return the complete updated document in Markdown format only — no preamble or explanation.`,
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
