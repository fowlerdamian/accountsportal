import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Channel = "trailbait" | "fleetcraft" | "aga";

// ─── Weighted scoring system ─────────────────────────────────────────────────
//
// Each scoring factor evaluates to a normalized sub-score in [0, 1], then the
// final 0-100 lead_score is weighted-averaged against the weights in the
// sales_scoring_weights DB table:
//
//     score = Σ(sub_score × weight) / Σ(weights) × 100
//
// Changing how much a factor matters is a one-row SQL update — no redeploy.
// A factor with weight=0 is effectively disabled.
//
// The score_breakdown jsonb column stores three fields per factor for
// transparency: raw sub-score, weight used, and weighted contribution.

type FactorResult = { score: number; note?: string };

// ─── Shared helpers ──────────────────────────────────────────────────────────

function inferCompanySize(lead: any): "large" | "medium" | "small" | "unknown" {
  const rc = lead.google_review_count ?? 0;
  if (rc >= 100) return "large";
  if (rc >= 30)  return "medium";
  if (rc >= 5)   return "small";
  return "unknown";
}

function contactFactor(lead: any): FactorResult {
  if (lead.recommended_contact_name && lead.recommended_contact_position) return { score: 1.0 };
  if (lead.recommended_contact_name) return { score: 0.75 };
  if (lead.recommended_contact_position) return { score: 0.4 };
  return { score: 0 };
}

function socialFactor(lead: any): FactorResult {
  const n = [lead.social_facebook, lead.social_instagram, lead.social_linkedin].filter(Boolean).length;
  if (n >= 3) return { score: 1.0 };
  if (n === 2) return { score: 0.75 };
  if (n === 1) return { score: 0.4 };
  return { score: 0 };
}

function websiteQualityFactor(lead: any): FactorResult {
  const rawWq = lead.score_breakdown?.website_quality;
  const wq = typeof rawWq === "string" ? rawWq : (lead.website ? "basic" : "none");
  if (wq === "products") return { score: 1.0 };
  if (wq === "basic")    return { score: 0.5 };
  return { score: 0 };
}

function newOpportunityFactor(lead: any): FactorResult {
  return { score: lead.is_existing_customer ? 0 : 1.0 };
}

function websiteAgeFactor(lead: any): FactorResult {
  const years = lead.score_breakdown?.website_age_years;
  if (typeof years !== "number") return { score: 0 };
  if (years >= 10) return { score: 1.0 };
  if (years >= 5)  return { score: 0.75 };
  if (years >= 2)  return { score: 0.5 };
  if (years >= 1)  return { score: 0.25 };
  return { score: 0.1 };
}

function websitePerformanceFactor(lead: any): FactorResult {
  const p = lead.score_breakdown?.website_performance;
  if (typeof p !== "number") return { score: 0 };
  // 0-100 Lighthouse score → normalize
  return { score: Math.max(0, Math.min(1, p / 100)) };
}

function apolloSeniorContactsFactor(lead: any): FactorResult {
  const n = lead.score_breakdown?.apollo_total_senior_contacts;
  if (typeof n !== "number" || n <= 0) return { score: 0 };
  if (n >= 50) return { score: 1.0 };
  if (n >= 20) return { score: 0.75 };
  if (n >= 5)  return { score: 0.5 };
  return { score: 0.25 };
}

// ─── Per-channel factor sets ─────────────────────────────────────────────────

function factorsTrailBait(lead: any, orderHistory: any | null): Record<string, FactorResult> {
  const factors: Record<string, FactorResult> = {};

  const r = lead.google_rating;
  factors.google_rating =
    r == null            ? { score: 0 } :
    r >= 4.7             ? { score: 1.0 } :
    r >= 4.3             ? { score: 0.75 } :
    r >= 4.0             ? { score: 0.5 } :
    r >= 3.5             ? { score: 0.25 } :
                           { score: 0.1 };

  const rc = lead.google_review_count ?? 0;
  factors.google_review_count =
    rc >= 200 ? { score: 1.0 } :
    rc >= 100 ? { score: 0.8 } :
    rc >= 50  ? { score: 0.6 } :
    rc >= 20  ? { score: 0.4 } :
    rc >= 5   ? { score: 0.2 } :
                { score: 0 };

  factors.website_quality    = websiteQualityFactor(lead);
  factors.social_presence    = socialFactor(lead);
  factors.is_new_opportunity = newOpportunityFactor(lead);

  factors.winback_candidate = {
    score: (lead.is_existing_customer && orderHistory?.is_winback_candidate) ? 1.0 : 0,
  };

  if (lead.is_existing_customer && orderHistory) {
    const trend = calcOrderTrend(orderHistory);
    factors.order_health = {
      score: trend === "declining" ? 1.0 : trend === "stable" ? 0.4 : 0,
      note:  `trend=${trend}`,
    };
  } else {
    factors.order_health = { score: 0.5, note: "new lead — neutral" };
  }

  factors.contact_found = contactFactor(lead);

  const addr = lead.address ?? "";
  const metro  = ["Sydney", "Melbourne", "Brisbane", "Perth", "Adelaide", "Gold Coast", "Newcastle", "Canberra"];
  const remote = ["NT", "Far North", "Outback", "Remote"];
  factors.geography = {
    score: metro.some((m) => addr.includes(m)) ? 1.0 : remote.some((r) => addr.includes(r)) ? 0.2 : 0.6,
  };

  factors.website_age_years     = websiteAgeFactor(lead);
  factors.website_performance   = websitePerformanceFactor(lead);

  return factors;
}

function factorsFleetCraft(lead: any): Record<string, FactorResult> {
  const factors: Record<string, FactorResult> = {};
  const summary     = (lead.website_summary ?? "").toLowerCase();
  const keyProducts = (lead.key_products_services ?? []).join(" ").toLowerCase();
  const companyName = (lead.company_name ?? "").toLowerCase();
  const allText     = `${summary} ${keyProducts} ${companyName}`;

  const installerKeywords = [
    "fitout", "fit-out", "fit out", "upfit", "upfitter", "upfitting",
    "installer", "installation", "modification", "vehicle mod",
    "body builder", "body build", "custom build", "conversion",
    "fleet conversion", "fleet build", "fleet services", "fleet solution",
    "emergency vehicle", "police vehicle", "ambulance", "rescue vehicle",
    "tray body", "canopy", "toolbox fit", "bull bar fit",
  ];
  const confirmedKeywords = [
    "specialist", "dedicated", "fleet", "commercial vehicle",
    "government vehicle", "emergency", "mining vehicle", "work vehicle",
  ];
  const isConfirmed = installerKeywords.some((k) => allText.includes(k)) && confirmedKeywords.some((k) => allText.includes(k));
  const isLikely    = installerKeywords.some((k) => allText.includes(k));
  factors.is_installer = { score: isConfirmed ? 1.0 : isLikely ? 0.5 : 0 };

  const tenderKeywords = [
    "government", "council", "defence", "police", "ambulance",
    "tender", "contract", "procurement", "state fleet", "federal",
  ];
  const hasTender    = !!lead.tender_context;
  const tenderTextHit = tenderKeywords.some((k) => allText.includes(k));
  factors.government_contracts = { score: hasTender ? 1.0 : tenderTextHit ? 0.5 : 0 };

  const size = lead.score_breakdown?.company_size ?? inferCompanySize(lead);
  factors.company_size =
    size === "large"   ? { score: 1.0 } :
    size === "medium"  ? { score: 0.6 } :
    size === "small"   ? { score: 0.25 } :
                         { score: 0.4 };

  factors.website_quality        = websiteQualityFactor(lead);
  factors.social_presence        = socialFactor(lead);
  factors.contact_found          = contactFactor(lead);
  factors.is_new_opportunity     = newOpportunityFactor(lead);
  factors.apollo_senior_contacts = apolloSeniorContactsFactor(lead);

  return factors;
}

function factorsAGA(lead: any): Record<string, FactorResult> {
  const factors: Record<string, FactorResult> = {};
  const summary     = (lead.website_summary ?? "").toLowerCase();
  const keyProducts = (lead.key_products_services ?? []).join(" ").toLowerCase();
  const companyName = (lead.company_name ?? "").toLowerCase();
  const allText     = `${summary} ${keyProducts} ${companyName}`;

  // has_own_brand is a pass/fail gate handled during enrichment — not scored here

  const imports        = lead.score_breakdown?.currently_imports;
  const importKw       = ["import", "overseas", "china", "taiwan", "sourced from", "offshore", "oem supplier"];
  const localMfgKw     = ["manufacture locally", "made in australia", "australian made", "local manufacture"];
  const importEvidence = imports ?? importKw.some((k) => allText.includes(k));
  const localMfg       = localMfgKw.some((k) => allText.includes(k));
  factors.currently_imports = {
    score: importEvidence && !localMfg ? 1.0 : localMfg ? 0.2 : 0.5,
  };

  const size = lead.score_breakdown?.company_size ?? inferCompanySize(lead);
  factors.company_size =
    size === "large"  ? { score: 1.0 } :
    size === "medium" ? { score: 0.66 } :
    size === "small"  ? { score: 0.33 } :
                        { score: 0.5 };

  factors.website_quality = websiteQualityFactor(lead);

  const autoKeywords = [
    "automotive", "4x4", "4wd", "off-road", "offroad", "vehicle", "accessories",
    "lighting", "towing", "bull bar", "suspension", "tray", "canopy", "winch",
    "recovery", "camping gear", "touring", "ute accessories",
  ];
  const adjacentKeywords = ["industrial", "marine", "recreational", "outdoor", "sports", "powersports"];
  const isAuto = autoKeywords.some((k) => allText.includes(k));
  const isAdj  = adjacentKeywords.some((k) => allText.includes(k));
  factors.product_fit = { score: isAuto ? 1.0 : isAdj ? 0.5 : 0 };

  factors.contact_found          = contactFactor(lead);
  factors.is_new_opportunity     = newOpportunityFactor(lead);
  factors.website_age_years      = websiteAgeFactor(lead);
  factors.website_performance    = websitePerformanceFactor(lead);
  factors.apollo_senior_contacts = apolloSeniorContactsFactor(lead);

  return factors;
}

function calcOrderTrend(orderHistory: any): "declining" | "stable" | "growing" {
  const c90 = orderHistory.order_count_90d ?? 0;
  const c30 = orderHistory.order_count_30d ?? 0;
  const expectedMonthly = c90 / 3;
  if (c30 < expectedMonthly * 0.5)  return "declining";
  if (c30 >= expectedMonthly * 1.2) return "growing";
  return "stable";
}

// ─── Weighted roll-up ────────────────────────────────────────────────────────

function applyWeights(
  factors: Record<string, FactorResult>,
  weights: Record<string, number>,
): { score: number; breakdown: Record<string, any> } {
  const breakdown: Record<string, any> = {};
  let weightedSum = 0;
  let totalWeight = 0;

  for (const [key, factor] of Object.entries(factors)) {
    const weight = weights[key] ?? 0;
    const clamped = Math.max(0, Math.min(1, factor.score));
    const contribution = clamped * weight;
    weightedSum += contribution;
    totalWeight += weight;
    breakdown[key] = {
      sub_score:    Math.round(clamped * 100) / 100,
      weight,
      contribution: Math.round(contribution * 100) / 100,
      ...(factor.note ? { note: factor.note } : {}),
    };
  }

  const score = totalWeight > 0 ? Math.round((weightedSum / totalWeight) * 100) : 0;
  return { score, breakdown };
}

// ─── Main handler ────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let body: { lead_id?: string; channel?: Channel } = {};
  try { body = await req.json(); } catch { /* no body */ }

  // Load all weights once per invocation (small table, per-channel lookup)
  const { data: weightRows } = await supabase
    .from("sales_scoring_weights")
    .select("channel, factor_key, weight");
  const weightsByChannel: Record<string, Record<string, number>> = {};
  for (const row of weightRows ?? []) {
    const ch = row.channel as string;
    (weightsByChannel[ch] ||= {})[row.factor_key as string] = Number(row.weight);
  }

  let query = supabase
    .from("sales_leads")
    .select("*")
    .in("status", ["enriched", "new", "queued", "researched", "scored"])
    .order("created_at", { ascending: true })
    .limit(200);

  if (body.lead_id) {
    query = supabase.from("sales_leads").select("*").eq("id", body.lead_id);
  } else if (body.channel) {
    query = query.eq("channel", body.channel);
  }

  const { data: leads, error } = await query;
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // Order history for TrailBait winback/order-health factors
  const trailbaitIds = (leads ?? [])
    .filter((l: any) => l.channel === "trailbait" && l.cin7_customer_id)
    .map((l: any) => l.cin7_customer_id);
  const orderHistoryMap: Record<string, any> = {};
  if (trailbaitIds.length) {
    const { data: histories } = await supabase
      .from("trailbait_order_history")
      .select("*")
      .in("cin7_customer_id", trailbaitIds);
    for (const h of histories ?? []) orderHistoryMap[h.cin7_customer_id] = h;
  }

  const { data: job } = await supabase
    .from("research_jobs")
    .insert({ channel: body.channel ?? "all", job_type: "scoring", status: "running", started_at: new Date().toISOString() })
    .select("id").single();

  let scored = 0;
  const errors: string[] = [];

  for (const lead of leads ?? []) {
    try {
      const ch = lead.channel as Channel;
      const weights = weightsByChannel[ch] ?? {};
      const orderHistory = lead.cin7_customer_id ? (orderHistoryMap[lead.cin7_customer_id] ?? null) : null;

      const factors =
        ch === "trailbait"  ? factorsTrailBait(lead, orderHistory) :
        ch === "fleetcraft" ? factorsFleetCraft(lead) :
                              factorsAGA(lead);

      const { score, breakdown } = applyWeights(factors, weights);

      // Preserve existing score_breakdown keys (Wayback/PageSpeed/Places/Apollo
      // signals produced by enrichment) — merge, don't overwrite.
      const merged = { ...(lead.score_breakdown ?? {}), ...breakdown };

      await supabase.from("sales_leads").update({
        lead_score:      score,
        score_breakdown: merged,
        status:          "scored",
      }).eq("id", lead.id);

      scored++;
    } catch (err) {
      errors.push(`Lead ${lead.id}: ${err}`);
    }
  }

  await supabase.from("research_jobs").update({
    status:        "completed",
    leads_enriched: scored,
    completed_at:  new Date().toISOString(),
    error_log:     errors.length ? errors.join("\n") : null,
  }).eq("id", job?.id);

  return new Response(
    JSON.stringify({ ok: true, scored }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
