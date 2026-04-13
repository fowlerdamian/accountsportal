import Anthropic from 'npm:@anthropic-ai/sdk';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface DocumentInput {
  id: string;
  title: string;
  clause: string;
  generatedContent: string;
  messages: Array<{ role: string; content: string }>;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { documents }: { documents: DocumentInput[] } = await req.json();

    const client = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') });

    const results = [];

    for (const doc of documents) {
      const message = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1200,
        messages: [{
          role: 'user',
          content: `You are a highly experienced ISO 9001:2015 lead auditor conducting a rigorous third-party certification audit. Your job is to find problems — not to be encouraging. You are known for thorough, uncompromising audits that catch what internal teams miss.

Document: ${doc.title} (Clause ${doc.clause})

DOCUMENT CONTENT:
${doc.generatedContent}

Audit this document against ISO 9001:2015 clause ${doc.clause} requirements with maximum scrutiny. You must:

1. Assume the document is a first draft and look for EVERY deficiency
2. Flag vague, generic, or boilerplate language that lacks company-specific detail
3. Flag missing mandatory elements required by the clause
4. Flag undefined roles, undefined frequencies, missing metrics, missing records
5. Flag anything an external auditor would question during certification
6. Flag process steps described without measurable criteria or evidence requirements
7. Only mark "pass" if the element is genuinely complete and audit-ready — do NOT pass things that are merely adequate

Common issues to specifically check for in clause ${doc.clause}:
- Missing defined responsibilities (who exactly is accountable)
- Missing timeframes or frequencies for reviews/activities
- Missing reference to records or evidence that would be produced
- Vague commitments ("will be monitored") without how, when, or by whom
- Missing links to other QMS documents/procedures
- Generic text not tailored to the company's actual operations
- Missing nonconformance/corrective action triggers
- Scope not clearly defined

Respond with a JSON array — one finding per issue. Every real deficiency deserves its own finding. Be specific about exactly what is missing or inadequate:
[
  {
    "documentId": "${doc.id}",
    "clause": "${doc.clause}",
    "status": "fail" | "observation" | "pass",
    "finding": "Specific, detailed finding referencing the exact gap in the document",
    "recommendation": "Specific corrective action required to address this finding"
  }
]

Use "fail" for missing mandatory requirements or non-conformances. Use "observation" for improvement opportunities or minor gaps. Only use "pass" for elements that are genuinely complete. Most real documents will have multiple findings.`,
        }],
      });

      const text = message.content[0].type === 'text' ? message.content[0].text : '[]';
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const docResults = JSON.parse(jsonMatch[0]);
        for (const r of docResults) {
          r.documentTitle = doc.title;
          if (r.status === 'minor') r.status = 'observation';
          if (r.status === 'major') r.status = 'fail';
          if (!['pass', 'observation', 'fail'].includes(r.status)) r.status = 'observation';
          results.push(r);
        }
      }
    }

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
