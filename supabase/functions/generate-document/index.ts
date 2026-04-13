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

    // Extract only user answers paired with the preceding assistant question
    const pairs: { question: string; answer: string }[] = [];
    let lastQuestion = '';
    for (const m of messages as { role: string; content: string }[]) {
      if (m.role === 'assistant') {
        lastQuestion = m.content.replace(/^.*?\*\*(.+?)\*\*.*$/s, '$1').trim();
      } else if (m.role === 'user' && lastQuestion) {
        pairs.push({ question: lastQuestion, answer: m.content });
        lastQuestion = '';
      }
    }
    const contextFacts = pairs
      .map((p) => `- ${p.question}: ${p.answer}`)
      .join('\n');

    const company = companyProfile || {};

    const now = new Date();
    const issueDate = now.toLocaleDateString('en-AU', { day: '2-digit', month: 'long', year: 'numeric' });
    const reviewDate = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate())
      .toLocaleDateString('en-AU', { day: '2-digit', month: 'long', year: 'numeric' });

    const prompt = `You are a senior ISO 9001:2015 QMS consultant and technical writer with 20 years of experience producing certification-ready documentation. Your task is to write a complete, professional QMS document from scratch.

COMPANY:
- Name: ${company.companyName || 'Company'}
- Industry: ${company.industry || 'N/A'}
- Address: ${[company.address, company.suburb, company.state, company.postcode].filter(Boolean).join(', ') || 'N/A'}
- Contact: ${company.contactName || 'N/A'}, ${company.contactTitle || 'N/A'}
- Email: ${company.email || 'N/A'} | Phone: ${company.phone || 'N/A'}
- ABN: ${company.abn || 'N/A'} | Employees: ${company.employeeCount || 'N/A'}
- Products/Services: ${company.mainProducts || 'N/A'}

DOCUMENT TO WRITE: ${documentTitle}
ISO 9001:2015 CLAUSE: ${clause}

FACTUAL CONTEXT ABOUT THIS COMPANY'S OPERATIONS:
${contextFacts || '(Use company details above to infer reasonable practices for this industry)'}

INSTRUCTIONS:
Write this document entirely from scratch as a professional QMS author. Do NOT copy or paraphrase the factual context — use it as background knowledge to inform the content, just as a consultant would after interviewing the client.

The document must:
- Be written in formal, authoritative policy/procedure language throughout
- Use the company's actual details (names, processes, industry context) woven naturally into the text
- Cover all mandatory elements of ISO 9001:2015 clause ${clause}
- Include defined roles and responsibilities with named position titles
- Include measurable criteria, timeframes, and frequencies where applicable
- Reference the records and evidence that will be produced
- Link to related QMS documents/procedures where relevant
- Be structured so a certification auditor would accept it without revision

FORMAT (Markdown):
# [Document Title]

| | |
|---|---|
| **Document No.** | QMS-${clause}-001 |
| **Clause** | ${clause} |
| **Version** | 1.0 |
| **Issue Date** | ${issueDate} |
| **Review Date** | ${reviewDate} |
| **Prepared by** | ${company.contactName || 'Quality Manager'} |

---

## 1. Purpose
## 2. Scope
## 3. Definitions
## 4. Responsibilities
## 5. Procedure / Policy
## 6. Records & Evidence
## 7. Related Documents
## 8. Document Control

Write the full document now. Do not include any preamble or explanation — output only the document content.`;


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
