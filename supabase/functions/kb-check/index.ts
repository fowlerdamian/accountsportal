import Anthropic from 'npm:@anthropic-ai/sdk';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { question, hint, documentTitle, clause, companyProfile, previousAnswers } = await req.json();

    const client = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') });

    const previousContext = previousAnswers && Object.keys(previousAnswers).length > 0
      ? `\nPrevious answers provided:\n${Object.entries(previousAnswers).map(([q, a]) => `Q: ${q}\nA: ${a}`).join('\n\n')}`
      : '';

    // Fetch relevant KB items for this company
    let kbContext = '';
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const companyDomain = companyProfile?.email?.split('@')[1]?.toLowerCase();

    if (companyDomain && supabaseUrl && supabaseKey) {
      try {
        const kbRes = await fetch(
          `${supabaseUrl}/rest/v1/compliance_kb_items?company_domain=eq.${encodeURIComponent(companyDomain)}&select=title,content&limit=8`,
          {
            headers: {
              apikey: supabaseKey,
              Authorization: `Bearer ${supabaseKey}`,
            },
          }
        );
        const items: { title: string; content: string }[] = await kbRes.json();
        if (Array.isArray(items) && items.length > 0) {
          kbContext = `\n\nCompany Knowledge Base (use this context to give a more tailored answer):\n${
            items.map((i) => `[${i.title}]\n${i.content.slice(0, 2000)}`).join('\n\n---\n\n')
          }`;
        }
      } catch {
        // Non-critical — continue without KB context
      }
    }

    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: `You are an ISO 9001:2015 QMS expert helping a company complete their compliance documentation.

Company: ${companyProfile?.companyName || 'Unknown'}
Industry: ${companyProfile?.industry || 'Unknown'}
Document: ${documentTitle} (Clause ${clause})
${previousContext}${kbContext}

Based on the company context above, suggest a specific, practical answer for:
Question: ${question}
${hint ? `Hint: ${hint}` : ''}

Provide a concise, tailored answer (2-4 sentences) that this company could use or adapt. Write as if you are the company describing their own processes. Do not include preamble or explanation — just the answer text.`,
      }],
    });

    const answer = message.content[0].type === 'text' ? message.content[0].text.trim() : '';

    return new Response(JSON.stringify({ answer }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
