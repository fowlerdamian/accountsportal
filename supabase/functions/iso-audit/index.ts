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
        max_tokens: 800,
        messages: [{
          role: 'user',
          content: `You are an ISO 9001:2015 lead auditor performing a document review.

Document: ${doc.title} (Clause ${doc.clause})

DOCUMENT CONTENT:
${doc.generatedContent}

Review this document against ISO 9001:2015 requirements for clause ${doc.clause}. Identify any gaps, missing elements, or areas that need improvement.

Respond with JSON array only (one item per finding, or one passing item if compliant):
[
  {
    "documentId": "${doc.id}",
    "clause": "${doc.clause}",
    "status": "pass" | "minor" | "major",
    "finding": "specific finding or 'Meets requirements'",
    "recommendation": "specific improvement or empty string if passing"
  }
]`,
        }],
      });

      const text = message.content[0].type === 'text' ? message.content[0].text : '[]';
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const docResults = JSON.parse(jsonMatch[0]);
        results.push(...docResults);
      }
    }

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
