// guide-rewrite — rewrite a piece of installation-guide text into ASD-STE100
// (Simplified Technical English) so customers can follow it without ambiguity.
// Input:  { text, kind: "title" | "step" | "description" | "subtitle" | "notice" | "step_title", context? }
// Output: { text }
//
// kind "step_title" is different from the rest: `text` is a step's description
// and the output is a short clause (3–8 words) summarising it, used to
// auto-generate the step heading in the guide editor.
import { resolveModel } from "../_shared/model.ts";
import { requireStaff, isStaffUser, forbidden } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const SYSTEM = `You rewrite text for vehicle-accessory installation guides (4x4 light bars, wiring kits, fuse panels, mounts) into ASD-STE100 Simplified Technical English.

Apply the STE writing rules strictly:
- One instruction per sentence. Procedural sentences: max 20 words. Descriptive sentences: max 25 words.
- Use the imperative (command) form for instructions: "Remove the bolt." not "The bolt should be removed."
- Active voice only. Present tense unless describing a result.
- One approved meaning per word. Prefer the STE approved vocabulary: use "remove", "install", "connect", "disconnect", "tighten", "loosen", "make sure", "do not", "before", "after". Avoid: "ensure" (→ "make sure"), "utilise" (→ "use"), "perform" (→ "do"), "prior to" (→ "before"), "in order to" (→ "to"), "should"/"may" for instructions.
- Use articles ("the", "a") consistently. Name each part the same way every time; keep the author's part names, SKUs, torque values, wire colours, quantities and measurements exactly.
- No noun clusters longer than 3 words. Break long sentences into short ones. Use a numbered list only if the original is a list.
- Warnings/cautions: start with "WARNING:" or "CAUTION:" and state the hazard and the action.
- Keep the same meaning. Do not add steps, tools, or facts that are not in the source. Do not remove safety information.
- Keep the customer's Australian English spelling (colour, tyre, centre).

Output ONLY the rewritten text — no preamble, no quotes, no explanations, no markdown headings. Preserve line breaks where the source has them.`;

const KIND_HINT: Record<string, string> = {
  title: "This is a short step heading (max ~8 words). Return one line, no full stop.",
  subtitle: "This is a short step heading (max ~8 words). Return one line, no full stop.",
  step: "This is the body of one installation step.",
  description: "This is a short customer-facing product description shown at the top of the guide (max 300 characters).",
  notice: "This is a notice shown to the customer before they start. Keep it to 1–3 sentences.",
  step_title:
    "Write the heading for this installation step: ONE short clause of 3–8 words that summarises what the step does. " +
    "Imperative form, active voice, STE vocabulary, no step number, no trailing full stop, no quotes. " +
    "Name the main part exactly as the step does. Return only the heading on one line.",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const auth = await requireStaff(req, corsHeaders);
  if (!auth.ok) return auth.response;
  if (!(await isStaffUser(auth.userId))) return forbidden(corsHeaders);

  try {
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "ANTHROPIC_API_KEY not configured" }, 500);

    const { text, kind = "step", context } = await req.json();
    const source = String(text ?? "").trim();
    if (!source) return json({ error: "text is required" }, 400);
    if (source.length > 4000) return json({ error: "Text too long (max 4000 characters)" }, 400);

    const user =
      `${KIND_HINT[kind] ?? KIND_HINT.step}` +
      (context ? `\nGuide: ${String(context).slice(0, 200)}` : "") +
      (kind === "step_title"
        ? `\n\nSummarise this step as a heading:\n\n${source}`
        : `\n\nRewrite this into ASD-STE100:\n\n${source}`);

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: AbortSignal.timeout(45_000),
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        // Headings are tiny and fired on every description blur — use the fast tier.
        model: await resolveModel(apiKey, kind === "step_title" ? "haiku" : "sonnet"),
        max_tokens: kind === "step_title" ? 60 : 1024,
        temperature: 0.2,
        system: SYSTEM,
        messages: [{ role: "user", content: user }],
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      let detail = errText.slice(0, 300);
      try { detail = JSON.parse(errText)?.error?.message ?? detail; } catch { /* keep */ }
      return json({ error: `Claude API error: ${res.status} — ${detail}` }, 502);
    }
    const data = await res.json();
    let out = String(data.content?.[0]?.text ?? "").trim();
    out = out.replace(/^["'“”]+|["'“”]+$/g, "").trim();
    if (kind === "title" || kind === "subtitle" || kind === "step_title") {
      out = out.split("\n")[0].replace(/^(step\s*\d+\s*[:.\-–—]\s*)/i, "").replace(/[.\s]+$/, "").trim();
    }
    if (kind === "step_title" && out.length > 90) out = out.slice(0, 90).replace(/\s+\S*$/, "");
    if (kind === "description" && out.length > 300) out = out.slice(0, 297).replace(/\s+\S*$/, "") + "…";
    return json({ text: out || source });
  } catch (err) {
    console.error("guide-rewrite error:", err);
    return json({ error: String((err as any)?.message ?? err) }, 500);
  }
});
