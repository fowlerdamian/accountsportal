import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { caseId } = await req.json();
    if (!caseId) {
      return new Response(
        JSON.stringify({ error: "caseId required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { data: c, error } = await supabase
      .from("cases")
      .select("case_number, type, status, priority, customer_name, product_name, order_number, description, error_origin")
      .eq("id", caseId)
      .single();

    if (error || !c) {
      return new Response(
        JSON.stringify({ summary: null }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let summary: string | null = null;
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");

    if (apiKey) {
      const context = [
        `Type: ${c.type}`,
        c.customer_name  ? `Customer: ${c.customer_name}`  : null,
        c.order_number   ? `Order: ${c.order_number}`      : null,
        c.product_name   ? `Product: ${c.product_name}`    : null,
        c.description    ? `Description: ${c.description.slice(0, 600)}` : null,
      ].filter(Boolean).join("\n");

      try {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 120,
            messages: [{
              role: "user",
              content: `Summarise this support case in one concise sentence (max 100 chars). Return only the sentence, no punctuation at the end.\n\n${context}`,
            }],
          }),
        });
        if (res.ok) {
          const data = await res.json();
          summary = data.content?.[0]?.text?.trim() || null;
        }
      } catch { /* fall through to fallback */ }
    }

    if (!summary) {
      summary = (c.description ?? "").slice(0, 100).trim() || c.product_name || c.type;
    }

    // Persist so the dashboard can show it without re-generating.
    await supabase
      .from("cases")
      .update({ ai_summary: summary, ai_summary_generated_at: new Date().toISOString() })
      .eq("id", caseId);

    return new Response(
      JSON.stringify({ summary }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err: any) {
    console.error("generate-case-summary error:", err);
    return new Response(
      JSON.stringify({ summary: null }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
