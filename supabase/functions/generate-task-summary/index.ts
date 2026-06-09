// Generates a short AI summary for a staff_task and writes it to
// staff_tasks.ai_summary. Targets ~40 characters — a concise but readable
// label for the bottom dock pill (the dock no longer hard-truncates).
//
// Pattern mirrors supabase/functions/generate-case-summary/index.ts.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_CHARS = 40;    // soft target the model aims for
const SAFETY_MAX = 64;   // hard cap, only ever trimmed at a word boundary

/** Trim to `max` at the LAST word boundary — never cuts a word mid-way. */
function wordTrim(s: string, max: number): string {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max + 1);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut.slice(0, max)).trim();
}

// Fallback: drop filler words, keep the salient nouns/verbs at the start.
function naiveSummary(title: string, desc: string | null): string {
  const src = (title ?? "").trim() || (desc ?? "").trim();
  if (!src) return "task";
  if (src.length <= MAX_CHARS) return src;
  // Cut at the last word boundary inside the limit
  const cut = src.slice(0, MAX_CHARS + 1);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 8 ? cut.slice(0, lastSpace) : cut.slice(0, MAX_CHARS)).trim();
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { task_id } = await req.json();
    if (!task_id) {
      return new Response(JSON.stringify({ error: "task_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data: t, error } = await supabase
      .from("staff_tasks")
      .select("id, title, description")
      .eq("id", task_id)
      .single();

    if (error || !t) {
      return new Response(JSON.stringify({ summary: null }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let summary: string;
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");

    if (!apiKey) {
      summary = naiveSummary(t.title, t.description);
    } else {
      const prompt =
        `Write a short label for this task — aim for about ${MAX_CHARS} characters, and never exceed ${SAFETY_MAX}. ` +
        `Keep it short by using common abbreviations (PO, qty, approx, #, &, w/, hrs, mgr, doc, req, info) and by dropping filler words — NOT by cutting words off. ` +
        `It must read as a complete phrase: no clipped or truncated words, no ellipsis, no quotes, no trailing punctuation. ` +
        `Use action verbs and concrete nouns; avoid generic words like "task" or "item". ` +
        `Return only the label text.\n\n` +
        `Title: ${t.title}\n` +
        (t.description ? `Description: ${t.description.slice(0, 400)}` : "");

      try {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method:  "POST",
          headers: {
            "x-api-key":         apiKey,
            "anthropic-version": "2023-06-01",
            "content-type":      "application/json",
          },
          body: JSON.stringify({
            model:      "claude-haiku-4-5-20251001",
            max_tokens: 50,
            messages:   [{ role: "user", content: prompt }],
          }),
        });

        if (!res.ok) {
          summary = naiveSummary(t.title, t.description);
        } else {
          const data = await res.json();
          const raw  = data.content?.[0]?.text?.trim() ?? "";
          // Strip quotes the model sometimes adds, trim trailing punctuation.
          // Safety net only: trim at a word boundary if the model overshoots —
          // never clip mid-word.
          const cleaned = raw.replace(/^["'`]|["'`]$/g, "").replace(/[.,;:!]+$/, "").trim();
          summary = wordTrim(cleaned, SAFETY_MAX) || naiveSummary(t.title, t.description);
        }
      } catch {
        summary = naiveSummary(t.title, t.description);
      }
    }

    // Write back
    await supabase
      .from("staff_tasks")
      .update({ ai_summary: summary })
      .eq("id", task_id);

    return new Response(JSON.stringify({ summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("generate-task-summary error:", err);
    return new Response(JSON.stringify({ summary: null }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
