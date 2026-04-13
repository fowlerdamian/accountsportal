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

const GEMINI_MODEL = 'gemini-2.5-pro';

async function callGemini(apiKey: string, systemInstruction: string, userPrompt: string): Promise<string> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemInstruction }] },
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        generationConfig: { maxOutputTokens: 8192, temperature: 1 },
      }),
    }
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${err}`);
  }
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { documents, allDocTitles = [] }: { documents: DocumentInput[]; allDocTitles: string[] } = await req.json();

    const apiKey = Deno.env.get('GEMINI_API_KEY') ?? '';
    if (!apiKey) throw new Error('GEMINI_API_KEY not configured');

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

      const prompt = `Review this document against ISO 9001:2015 clause ${doc.clause} requirements.

DOCUMENT: ${doc.title}
CLAUSE: ${doc.clause}
${evidenceContext}
${docTitlesContext}

DOCUMENT CONTENT:
${doc.generatedContent}

---

AUDIT INSTRUCTIONS:

Return only genuine findings — real non-conformances or observations. If the document genuinely meets a requirement well, do not fabricate a finding for it. Quality over quantity.

Check ALL of the following and raise a finding only where there is a real gap:

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

If there are no genuine findings, return an empty array [].

Respond ONLY with a JSON array. No preamble, no explanation, no markdown fences:
[
  {
    "documentId": "${doc.id}",
    "clause": "${doc.clause}",
    "status": "fail" | "observation",
    "finding": "Precise finding — quote the specific language or name the specific missing element",
    "recommendation": "Exact corrective action with specific wording or content to add"
  }
]`;

      const text = await callGemini(
        apiKey,
        `You are a senior ISO 9001:2015 lead auditor preparing an organisation for third-party certification. Your role is to conduct a thorough, honest gap analysis — finding real non-conformances and observations while recognising genuinely compliant content. You are rigorous and precise. You do not invent problems, but you do not miss real ones either. Your findings must be specific and actionable.`,
        prompt
      );

      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const docResults = JSON.parse(jsonMatch[0]);
        for (const r of docResults) {
          r.documentTitle = doc.title;
          // Normalise status aliases
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
