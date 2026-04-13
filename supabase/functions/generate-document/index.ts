import Anthropic from 'npm:@anthropic-ai/sdk';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { documentTitle, clause, messages, companyProfile } = await req.json();

    const client = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') });

    const conversation = messages
      .map((m: { role: string; content: string }) => `${m.role === 'user' ? 'Company' : 'Assistant'}: ${m.content}`)
      .join('\n\n');

    const company = companyProfile || {};

    const prompt = `You are an ISO 9001:2015 QMS documentation expert. Generate a professional, audit-ready document based on the following information.

COMPANY DETAILS:
- Name: ${company.companyName || 'Company'}
- ABN: ${company.abn || 'N/A'}
- Industry: ${company.industry || 'N/A'}
- Address: ${[company.address, company.suburb, company.state, company.postcode].filter(Boolean).join(', ') || 'N/A'}
- Contact: ${company.contactName || 'N/A'} — ${company.contactTitle || 'N/A'}
- Email: ${company.email || 'N/A'}
- Phone: ${company.phone || 'N/A'}
- Website: ${company.website || 'N/A'}
- Employees: ${company.employeeCount || 'N/A'}
- Products/Services: ${company.mainProducts || 'N/A'}

DOCUMENT: ${documentTitle}
ISO 9001:2015 CLAUSE: ${clause}

INFORMATION GATHERED (Q&A):
${conversation}

Generate the complete document in professional Markdown format. Include:
1. Document header with company name, document title, clause reference, version (1.0), and date
2. Purpose and scope section
3. All relevant procedures, responsibilities, and processes based on the Q&A above
4. References to relevant ISO 9001:2015 clauses
5. Document control footer

Use the company's actual answers to make this document specific and authentic, not generic. Format it as a real QMS document that would satisfy an ISO auditor.`;

    const stream = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      stream: true,
      messages: [{ role: 'user', content: prompt }],
    });

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const event of stream) {
            if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`));
            }
          }
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        } finally {
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
      },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
