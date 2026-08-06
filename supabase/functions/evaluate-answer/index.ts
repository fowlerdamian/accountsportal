import Anthropic from 'npm:@anthropic-ai/sdk';
import { requireStaff } from '../_shared/auth.ts';
import { resolveModel } from '../_shared/model.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const auth = await requireStaff(req, corsHeaders);
  if (!auth.ok) return auth.response;

  try {
    const { question, answer, documentTitle, clause, companyProfile } = await req.json();

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY')!;
    const client = new Anthropic({ apiKey });

    const message = await client.messages.create({
      model: await resolveModel(apiKey, 'haiku'),
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: `You are an ISO 9001:2015 compliance expert evaluating answers for a QMS document.

Document: ${documentTitle} (Clause ${clause})
Company: ${companyProfile?.companyName || 'Unknown'}
Industry: ${companyProfile?.industry || 'Unknown'}

Question: ${question}
Answer: ${answer}

Evaluate if this answer is satisfactory for ISO 9001:2015 compliance. A satisfactory answer should be specific, actionable, and demonstrate understanding of the requirement.

Respond with JSON only:
{ "satisfactory": true/false, "feedback": "brief feedback if not satisfactory, or empty string if satisfactory" }`,
      }],
    });

    const text = message.content[0].type === 'text' ? message.content[0].text : '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const result = jsonMatch ? JSON.parse(jsonMatch[0]) : { satisfactory: true, feedback: '' };

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
