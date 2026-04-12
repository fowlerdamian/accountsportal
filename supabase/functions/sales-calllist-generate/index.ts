import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Channel = "trailbait" | "fleetcraft" | "aga";

const CHANNEL_PITCH: Record<Channel, string> = {
  trailbait:  "Accelerate accessory fitment times through innovative products. Add additional unique products to increase average invoice value.",
  fleetcraft: "Accelerate accessory fitment times through innovative products such as wiring looms and brackets.",
  aga:        "We offer turn-key products to complement your range without the need to design and manufacture yourself.",
};

// ─── Rule-based call reason generator ────────────────────────────────────────

function generateRuleBasedReason(lead: any, orderHistory: any | null): string {
  if (lead.is_existing_customer && orderHistory?.is_winback_candidate) {
    const days = orderHistory.days_since_last_order ?? "?";
    const avg  = orderHistory.average_order_value ? `$${Math.round(orderHistory.average_order_value).toLocaleString()}` : "";
    return `Win-back: No orders in ${days} days. Previously averaging ${avg} per order. Last order included ${(orderHistory.top_products ?? []).slice(0,2).map((p: any) => p.name ?? p.sku).join(" and ") || "accessories"}.`;
  }

  if (lead.is_existing_customer) {
    const trend = orderHistory?.order_count_30d < (orderHistory?.order_count_90d / 3) * 0.7 ? "declining" : "active";
    return trend === "declining"
      ? `Existing customer showing declining order frequency — worth a check-in call.`
      : `Follow-up with existing customer to explore new product opportunities.`;
  }

  if (lead.tender_context) {
    return `New prospect — recently awarded a fleet/government contract. Strong fit for fleet accessories. Context: ${lead.tender_context.slice(0, 150)}`;
  }

  return `New high-scoring lead (${lead.lead_score}/100) — first outreach call. ${lead.website_summary ? lead.website_summary.slice(0, 100) + "..." : ""}`;
}

// ─── Claude Sonnet: AI-enhanced call reason + talking points ─────────────────

async function generateAICallReason(
  lead: any,
  orderHistory: any | null,
  channel: Channel,
  anthropicKey: string
): Promise<{ call_reason: string; talking_points: string[] }> {
  const cin7Context = orderHistory ? `
- Last order: ${orderHistory.last_order_date ? new Date(orderHistory.last_order_date).toLocaleDateString("en-AU") : "unknown"}
- Orders in last 30 days: ${orderHistory.order_count_30d}
- Orders in last 90 days: ${orderHistory.order_count_90d}
- Average order value: $${Math.round(orderHistory.average_order_value ?? 0).toLocaleString()}
- Top products: ${(orderHistory.top_products ?? []).slice(0,3).map((p: any) => p.name ?? p.sku).join(", ")}
- Win-back candidate: ${orderHistory.is_winback_candidate ? "YES" : "no"}` : "";

  const prompt = `You are preparing a sales call brief for ${channel === "trailbait" ? "TrailBait (4x4/4WD wholesale)" : channel === "fleetcraft" ? "FleetCraft (fleet vehicle accessories)" : "AGA (bespoke automotive manufacturing)"}.

Company: ${lead.company_name}
Score: ${lead.lead_score}/100
Channel: ${channel}
Summary: ${lead.website_summary ?? "No summary available"}
Existing customer: ${lead.is_existing_customer ? "YES" : "no"}
Tender context: ${lead.tender_context ?? "none"}
${cin7Context}

Our pitch: "${CHANNEL_PITCH[channel]}"

Generate a JSON object with:
- "call_reason": 1-2 sentences explaining WHY to call this specific company TODAY (be specific and actionable)
- "talking_points": Array of exactly 3 short, punchy conversation starters tailored to this company

Be specific, reference their actual business details. No generic phrases.
Return valid JSON only.`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method:  "POST",
      headers: {
        "Content-Type":      "application/json",
        "x-api-key":         anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model:      "claude-sonnet-4-5",
        max_tokens: 400,
        messages:   [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) throw new Error("Anthropic API error");
    const data   = await res.json();
    const parsed = JSON.parse(data.content?.[0]?.text ?? "{}");
    return {
      call_reason:    parsed.call_reason ?? generateRuleBasedReason(lead, orderHistory),
      talking_points: parsed.talking_points ?? [],
    };
  } catch {
    return {
      call_reason:    generateRuleBasedReason(lead, orderHistory),
      talking_points: [],
    };
  }
}

// ─── Build context brief ──────────────────────────────────────────────────────

function buildContextBrief(
  lead: any,
  orderHistory: any | null,
  callReason: string,
  channel: Channel
): object {
  return {
    company_name:        lead.company_name,
    website:             lead.website,
    phone:               lead.phone,
    address:             lead.address,
    google_rating:       lead.google_rating,
    google_reviews:      lead.google_review_count,
    recommended_contact: lead.recommended_contact_name
      ? `${lead.recommended_contact_name}${lead.recommended_contact_position ? ", " + lead.recommended_contact_position : ""}`
      : null,
    contact_source:      lead.recommended_contact_source,
    company_summary:     lead.website_summary,
    social: {
      facebook:  lead.social_facebook,
      instagram: lead.social_instagram,
      linkedin:  lead.social_linkedin,
    },
    is_existing_customer: lead.is_existing_customer,
    cin7_data: orderHistory ? {
      last_order:           orderHistory.last_order_date ? new Date(orderHistory.last_order_date).toLocaleDateString("en-AU") : null,
      days_since_last_order: orderHistory.days_since_last_order,
      order_count_90d:      orderHistory.order_count_90d,
      order_count_30d:      orderHistory.order_count_30d,
      avg_order_value:      orderHistory.average_order_value,
      top_products:         (orderHistory.top_products ?? []).map((p: any) => p.sku ?? p.name),
      is_winback:           orderHistory.is_winback_candidate,
    } : null,
    call_reason:         callReason,
    channel_pitch:       CHANNEL_PITCH[channel],
    lead_score:          lead.lead_score,
    tender_context:      lead.tender_context,
  };
}

// ─── Main handler ─────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY") ?? "";

  let body: { channel?: Channel; date?: string; use_ai?: boolean } = {};
  try { body = await req.json(); } catch { /* no body */ }

  const targetDate = body.date ?? new Date().toISOString().split("T")[0];
  const useAI      = body.use_ai !== false; // default true
  const channels: Channel[] = body.channel ? [body.channel] : ["trailbait", "fleetcraft", "aga"];

  const summary: Record<string, number> = {};

  for (const channel of channels) {
    // Create job record
    const { data: job } = await supabase
      .from("research_jobs")
      .insert({ channel, job_type: "calllist_gen", status: "running", started_at: new Date().toISOString() })
      .select("id").single();

    try {
      // Delete today's existing list for this channel first
      await supabase
        .from("call_list")
        .delete()
        .eq("channel", channel)
        .eq("scheduled_date", targetDate)
        .eq("is_complete", false);

      // Fetch top scored leads
      const { data: leads } = await supabase
        .from("sales_leads")
        .select("*")
        .eq("channel", channel)
        .in("status", ["queued", "contacted"])
        .gt("lead_score", 0)
        .order("lead_score", { ascending: false })
        .limit(30);

      if (!leads?.length) {
        await supabase.from("research_jobs").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", job?.id);
        summary[channel] = 0;
        continue;
      }

      // Boost win-back candidates for TrailBait
      let ranked = [...leads];
      if (channel === "trailbait") {
        // Fetch order history for win-back check
        const cin7Ids = leads.filter((l: any) => l.cin7_customer_id).map((l: any) => l.cin7_customer_id);
        const historyMap: Record<string, any> = {};
        if (cin7Ids.length) {
          const { data: histories } = await supabase
            .from("trailbait_order_history")
            .select("*")
            .in("cin7_customer_id", cin7Ids);
          for (const h of histories ?? []) historyMap[h.cin7_customer_id] = h;
        }

        // Attach order history and compute priority score
        ranked = leads
          .map((l: any) => ({
            ...l,
            _orderHistory: l.cin7_customer_id ? (historyMap[l.cin7_customer_id] ?? null) : null,
          }))
          .map((l: any) => ({
            ...l,
            _priorityScore: l.lead_score + (l._orderHistory?.is_winback_candidate ? 20 : 0),
          }))
          .sort((a: any, b: any) => b._priorityScore - a._priorityScore);
      } else {
        ranked = leads.map((l: any) => ({ ...l, _orderHistory: null }));
      }

      // Take top 20
      const top20 = ranked.slice(0, 20);

      // Generate call list entries
      const inserts = [];
      for (let i = 0; i < top20.length; i++) {
        const lead         = top20[i];
        const orderHistory = (lead as any)._orderHistory ?? null;

        let callReason    = generateRuleBasedReason(lead, orderHistory);
        let talkingPoints: string[] = [];

        if (useAI && anthropicKey && lead.lead_score >= 60) {
          const ai  = await generateAICallReason(lead, orderHistory, channel, anthropicKey);
          callReason    = ai.call_reason;
          talkingPoints = ai.talking_points;
        }

        const contextBrief = buildContextBrief(lead, orderHistory, callReason, channel);

        inserts.push({
          lead_id:        lead.id,
          channel,
          priority_rank:  i + 1,
          call_reason:    callReason,
          talking_points: talkingPoints,
          context_brief:  contextBrief,
          scheduled_date: targetDate,
        });
      }

      if (inserts.length) {
        await supabase.from("call_list").insert(inserts);
      }

      await supabase.from("research_jobs").update({ status: "completed", leads_found: inserts.length, completed_at: new Date().toISOString() }).eq("id", job?.id);
      summary[channel] = inserts.length;
    } catch (err) {
      await supabase.from("research_jobs").update({ status: "failed", error_log: String(err), completed_at: new Date().toISOString() }).eq("id", job?.id);
    }
  }

  return new Response(
    JSON.stringify({ ok: true, summary }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
