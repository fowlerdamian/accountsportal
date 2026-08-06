import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { requireStaff } from "../_shared/auth.ts";
import { resolveModel } from "../_shared/model.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const auth = await requireStaff(req, corsHeaders);
  if (!auth.ok) return auth.response;

  try {
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ matched_category: null, confidence: "low" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { title, short_description, categories } = await req.json();

    if (!categories || categories.length === 0) {
      return new Response(
        JSON.stringify({ matched_category: null, confidence: "low" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const categoryNames = categories.map((c: any) => c.name).join(", ");

    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: await resolveModel(apiKey, "haiku"),
        max_tokens: 200,
        system: "You categorize automotive product guides. Return ONLY valid JSON with no markdown.",
        messages: [{
          role: "user",
          content: `Given this guide:\nTitle: ${title || "unknown"}\nDescription: ${short_description || "none"}\n\nWhich of these categories best fits? Categories: ${categoryNames}\n\nReturn JSON: {"matched_category": "exact category name or null", "confidence": "high" | "medium" | "low"}`,
        }],
      }),
    });

    if (!claudeRes.ok) {
      return new Response(
        JSON.stringify({ matched_category: null, confidence: "low" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await claudeRes.json();
    const text = data.content?.[0]?.text ?? "";
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      return new Response(
        JSON.stringify({ matched_category: null, confidence: "low" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(match[0], {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch {
    return new Response(
      JSON.stringify({ matched_category: null, confidence: "low" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
