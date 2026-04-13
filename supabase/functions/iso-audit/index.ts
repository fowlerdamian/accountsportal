import Anthropic from 'npm:@anthropic-ai/sdk';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface EvidenceItem {
  title: string;
  uploaded: boolean;
}

interface DocumentInput {
  id: string;
  title: string;
  clause: string;
  generatedContent: string;
  messages: Array<{ role: string; content: string }>;
  requiredEvidence: EvidenceItem[];
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { documents, allDocTitles = [] }: { documents: DocumentInput[]; allDocTitles: string[] } = await req.json();

    const client = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') });

    const results = [];

    for (const doc of documents) {
      const evidence = doc.requiredEvidence || [];
      const missingEvidence = evidence.filter((e) => !e.uploaded);

      const evidenceContext = evidence.length > 0
        ? `\nREQUIRED EVIDENCE STATUS:\n${evidence.map((e) => `- ${e.title}: ${e.uploaded ? '✓ UPLOADED' : '✗ NOT UPLOADED — FAIL'}`).join('\n')}`
        : '';

      const docTitlesContext = allDocTitles.length > 0
        ? `\nEXISTING QMS DOCUMENTS:\n${allDocTitles.map((t) => `- ${t}`).join('\n')}`
        : '';

      const message = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 2000,
        system: `You are a ruthless ISO 9001:2015 lead auditor hired to find every gap before a certification audit. You have NEVER seen a perfect QMS document. Your reputation depends on finding problems that others miss. You are not here to be encouraging — you are here to identify non-conformances and observations that would fail a certification audit. Every document you review has gaps. Your job is to find them all.`,
        messages: [{
          role: 'user',
          content: `Review this document against ISO 9001:2015 clause ${doc.clause} requirements.

DOCUMENT: ${doc.title}
CLAUSE: ${doc.clause}
${evidenceContext}
${docTitlesContext}

DOCUMENT CONTENT:
${doc.generatedContent}

---

AUDIT INSTRUCTIONS:

You MUST produce between 3 and 8 specific findings. Do NOT produce a "pass" result — if something partially meets requirements, it is an "observation". Reserve "fail" for clear non-conformances and missing mandatory elements.

Do NOT include any passing items in your response. Only include problems.

Check ALL of the following — each unmet item is a finding:

CONTENT GAPS (fail if missing):
- Are responsibilities assigned to SPECIFIC named roles/positions (not just "management")?
- Are frequencies and timeframes defined (not vague like "regularly" or "as needed")?
- Are records specifically named, with retention periods defined?
- Is the scope explicitly stated with clear inclusions/exclusions?
- Are nonconformance triggers and escalation paths defined?
- Are measurable targets or KPIs included?
- Are review cycles explicitly scheduled?

LANGUAGE QUALITY (observation if present):
- Any vague language: "will be monitored", "as appropriate", "where applicable", "regularly", "periodically", "timely" without a defined timeframe
- Any generic boilerplate not specific to this company's industry or operations
- Responsibilities stated without naming a specific role/title

EVIDENCE & RELATED DOCS (fail if missing):
- Each ✗ NOT UPLOADED item above = mandatory fail finding
- Any document referenced in the Related Documents section that is NOT in the EXISTING QMS DOCUMENTS list = fail

Respond ONLY with a JSON array. No preamble, no explanation:
[
  {
    "documentId": "${doc.id}",
    "clause": "${doc.clause}",
    "status": "fail" | "observation",
    "finding": "Precise finding — quote the specific language or name the specific missing element",
    "recommendation": "Exact corrective action with specific wording or content to add"
  }
]`,
        }],
      });

      const text = message.content[0].type === 'text' ? message.content[0].text : '[]';
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const docResults = JSON.parse(jsonMatch[0]);
        for (const r of docResults) {
          r.documentTitle = doc.title;
          // Normalise status — never allow "pass" through from AI
          if (r.status === 'pass') r.status = 'observation';
          if (r.status === 'minor') r.status = 'observation';
          if (r.status === 'major') r.status = 'fail';
          if (!['observation', 'fail'].includes(r.status)) r.status = 'observation';
          results.push(r);
        }
      }

      // Hard-inject fails for missing evidence
      for (const missing of missingEvidence) {
        const alreadyFlagged = results.some(
          (r) => r.documentId === doc.id && r.finding?.toLowerCase().includes(missing.title.toLowerCase())
        );
        if (!alreadyFlagged) {
          results.push({
            documentId: doc.id,
            documentTitle: doc.title,
            clause: doc.clause,
            status: 'fail',
            finding: `Required evidence not uploaded: "${missing.title}" is listed as a required record but has not been provided.`,
            recommendation: `Upload "${missing.title}" via the Supporting Documentation section of this document before the audit.`,
          });
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
