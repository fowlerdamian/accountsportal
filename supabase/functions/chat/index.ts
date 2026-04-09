import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { messages, staffName } = await req.json();

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Pull live context from the database
    const [
      { data: cases },
      { data: actionItems },
      { data: teamMembers },
    ] = await Promise.all([
      supabase
        .from("cases")
        .select("case_number, type, status, priority, customer_name, product_name, order_number, description, created_at, updated_at, error_origin")
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("action_items")
        .select("id, description, status, due_date, assigned_to, case_id")
        .neq("status", "done")
        .limit(50),
      supabase
        .from("team_members")
        .select("id, name, role")
        .eq("active", true),
    ]);

    const today = new Date().toISOString().split("T")[0];

    const systemPrompt = `You are a helpful support operations assistant for a customer service team.
Today's date is ${today}. The staff member talking to you is ${staffName}.

You have access to the following live data:

## Open/Active Cases (most recent 100)
${JSON.stringify(cases ?? [], null, 2)}

## Pending Action Items
${JSON.stringify(actionItems ?? [], null, 2)}

## Team Members
${JSON.stringify(teamMembers ?? [], null, 2)}

Guidelines:
- Answer questions about cases, workload, overdue items, patterns, and team status
- When listing cases, include case number, type, status, and customer name
- Keep responses concise and formatted with markdown where helpful
- If asked to calculate overdue items, check where status is not 'closed' and created_at is older than 2 business days
- Warranty claims, order errors, freight issues, and complaints are the main case types
- Be direct and actionable — this team needs quick answers`;

    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicKey) {
      return new Response(
        JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
      );
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        system: systemPrompt,
        messages: messages.map((m: { role: string; content: string }) => ({
          role: m.role,
          content: m.content,
        })),
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error("Anthropic error:", err);
      return new Response(
        JSON.stringify({ error: "AI service error. Please try again." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
      );
    }

    const result = await response.json();
    const reply = result.content?.[0]?.text ?? "No response.";

    return new Response(
      JSON.stringify({ reply }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("chat function error:", err);
    return new Response(
      JSON.stringify({ error: "Something went wrong." }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
