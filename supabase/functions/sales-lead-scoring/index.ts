import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Channel = "trailbait" | "fleetcraft" | "aga";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Infer company size from Google review count when AI enrichment didn't produce a size signal.
 * High review counts are a reasonable proxy for established/larger businesses.
 */
function inferCompanySize(lead: any): "large" | "medium" | "small" | "unknown" {
  const rc = lead.google_review_count ?? 0;
  if (rc >= 100) return "large";
  if (rc >= 30)  return "medium";
  if (rc >= 5)   return "small";
  return "unknown";
}

// ─── Scoring logic per channel ────────────────────────────────────────────────

function scoreTrailBait(lead: any, orderHistory: any | null): { score: number; breakdown: Record<string, number> } {
  const bd: Record<string, number> = {};

  // Google rating (15)
  if (lead.google_rating == null)       bd.google_rating = 0;
  else if (lead.google_rating >= 4.5)   bd.google_rating = 15;
  else if (lead.google_rating >= 4.0)   bd.google_rating = 10;
  else                                   bd.google_rating = 5;

  // Google review count (10)
  const rc = lead.google_review_count ?? 0;
  if      (rc >= 50) bd.google_review_count = 10;
  else if (rc >= 20) bd.google_review_count = 7;
  else if (rc >= 5)  bd.google_review_count = 4;
  else if (rc >= 1)  bd.google_review_count = 1;
  else               bd.google_review_count = 0;

  // Website quality (10)
  const wq = lead.score_breakdown?.website_quality ?? (lead.website ? "basic" : "none");
  bd.website_quality = wq === "products" ? 10 : wq === "basic" ? 5 : 0;

  // Social presence (10)
  const socialCount = [lead.social_facebook, lead.social_instagram, lead.social_linkedin].filter(Boolean).length;
  bd.social_presence = socialCount >= 2 ? 10 : socialCount === 1 ? 5 : 0;

  // Existing customer (10) — existing = 0 pts (already a customer, not a new opportunity)
  bd.is_existing_customer = lead.is_existing_customer ? 0 : 10;

  // Win-back candidate (15)
  bd.winback_candidate = (lead.is_existing_customer && orderHistory?.is_winback_candidate) ? 15 : 0;

  // Order history health (15)
  if (lead.is_existing_customer && orderHistory) {
    const trend = calcOrderTrend(orderHistory);
    bd.order_health = trend === "declining" ? 15 : trend === "stable" ? 5 : 0;
  } else {
    bd.order_health = 8; // new lead bonus
  }

  // Contact found (10)
  if (lead.recommended_contact_name && lead.recommended_contact_position) bd.contact_found = 10;
  else if (lead.recommended_contact_name) bd.contact_found = 8;
  else if (lead.recommended_contact_position) bd.contact_found = 5;
  else bd.contact_found = 0;

  // Geography (5)
  const metro = ["Sydney", "Melbourne", "Brisbane", "Perth", "Adelaide", "Gold Coast", "Newcastle", "Canberra"];
  const isMetro = metro.some((m) => (lead.address ?? "").includes(m));
  const remote  = ["NT", "Far North", "Outback", "Remote"];
  const isRemote = remote.some((r) => (lead.address ?? "").includes(r));
  bd.geography = isMetro ? 5 : isRemote ? 1 : 3;

  const score = Object.values(bd).reduce((a, b) => a + b, 0);
  return { score, breakdown: bd };
}

function scoreFleetCraft(lead: any): { score: number; breakdown: Record<string, number> } {
  const bd: Record<string, number> = {};
  const summary     = (lead.website_summary ?? "").toLowerCase();
  const keyProducts = (lead.key_products_services ?? []).join(" ").toLowerCase();
  const companyName = (lead.company_name ?? "").toLowerCase();
  // Search across all available text signals, not just website_summary
  const allText     = `${summary} ${keyProducts} ${companyName}`;

  // Is installer/upfitter (20) — broad keyword net across all text signals
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
  bd.is_installer = isConfirmed ? 20 : isLikely ? 10 : 0;

  // Government contracts (15) — tender_context is the primary signal; also check summary
  const tenderKeywords = [
    "government", "council", "defence", "police", "ambulance",
    "tender", "contract", "procurement", "state fleet", "federal",
  ];
  const hasTender = !!(lead.tender_context || tenderKeywords.some((k) => allText.includes(k)));
  bd.government_contracts = hasTender ? 15 : 0;

  // Company size (15) — AI field preferred; fall back to Google review count as proxy
  const size = lead.score_breakdown?.company_size ?? inferCompanySize(lead);
  bd.company_size = size === "large" ? 15 : size === "medium" ? 8 : size === "small" ? 3 : 5;

  // Website quality (10)
  const wq = lead.score_breakdown?.website_quality ?? (lead.website ? "basic" : "none");
  bd.website_quality = wq === "products" ? 10 : wq === "basic" ? 5 : 0;

  // Social presence (10)
  const socialCount = [lead.social_facebook, lead.social_instagram, lead.social_linkedin].filter(Boolean).length;
  bd.social_presence = socialCount >= 2 ? 10 : socialCount === 1 ? 5 : 0;

  // Contact found (10)
  if (lead.recommended_contact_name && lead.recommended_contact_position) bd.contact_found = 10;
  else if (lead.recommended_contact_name) bd.contact_found = 8;
  else if (lead.recommended_contact_position) bd.contact_found = 5;
  else bd.contact_found = 0;

  // Existing customer (10)
  bd.is_existing_customer = lead.is_existing_customer ? 0 : 10;

  const score = Object.values(bd).reduce((a, b) => a + b, 0);
  return { score, breakdown: bd };
}

function scoreAGA(lead: any): { score: number; breakdown: Record<string, number> } {
  const bd: Record<string, number> = {};
  const summary     = (lead.website_summary ?? "").toLowerCase();
  const keyProducts = (lead.key_products_services ?? []).join(" ").toLowerCase();
  const companyName = (lead.company_name ?? "").toLowerCase();
  const allText     = `${summary} ${keyProducts} ${companyName}`;

  // Has own brand (25) — AI field preferred; fall back to text signals
  const brandKeywords = ["our brand", "brand ", "branded", "own label", "private label", "trademark", "proprietary"];
  const hasBrand = lead.score_breakdown?.has_own_brand
    ?? brandKeywords.some((k) => allText.includes(k));
  bd.has_own_brand = hasBrand ? 25 : 0;

  // Currently imports (15) — AI field preferred; fall back to text signals
  const imports    = lead.score_breakdown?.currently_imports;
  const importKw   = ["import", "overseas", "china", "taiwan", "sourced from", "offshore", "oem supplier"];
  const localMfgKw = ["manufacture locally", "made in australia", "australian made", "local manufacture"];
  const importEvidence = imports ?? importKw.some((k) => allText.includes(k));
  const localMfg       = localMfgKw.some((k) => allText.includes(k));
  bd.currently_imports = importEvidence && !localMfg ? 15 : localMfg ? 5 : 8;

  // Company size (15)
  const size = lead.score_breakdown?.company_size ?? inferCompanySize(lead);
  bd.company_size = size === "large" ? 15 : size === "medium" ? 10 : size === "small" ? 5 : 7;

  // Website quality (10)
  const wq = lead.score_breakdown?.website_quality ?? (lead.website ? "basic" : "none");
  bd.website_quality = wq === "products" ? 10 : wq === "basic" ? 5 : 0;

  // Product fit for AGA (15) — check across all text signals
  const autoKeywords = [
    "automotive", "4x4", "4wd", "off-road", "offroad", "vehicle", "accessories",
    "lighting", "towing", "bull bar", "suspension", "tray", "canopy", "winch",
    "recovery", "camping gear", "touring", "ute accessories",
  ];
  const adjacentKeywords = ["industrial", "marine", "recreational", "outdoor", "sports", "powersports"];
  const isAuto = autoKeywords.some((k) => allText.includes(k));
  const isAdj  = adjacentKeywords.some((k) => allText.includes(k));
  bd.product_fit = isAuto ? 15 : isAdj ? 8 : 0;

  // Contact found (10)
  if (lead.recommended_contact_name && lead.recommended_contact_position) bd.contact_found = 10;
  else if (lead.recommended_contact_name) bd.contact_found = 8;
  else if (lead.recommended_contact_position) bd.contact_found = 5;
  else bd.contact_found = 0;

  // Existing customer (10)
  bd.is_existing_customer = lead.is_existing_customer ? 0 : 10;

  const score = Object.values(bd).reduce((a, b) => a + b, 0);
  return { score, breakdown: bd };
}

function calcOrderTrend(orderHistory: any): "declining" | "stable" | "growing" {
  const c90 = orderHistory.order_count_90d ?? 0;
  const c30 = orderHistory.order_count_30d ?? 0;
  const expectedMonthly = c90 / 3;

  if      (c30 < expectedMonthly * 0.5)   return "declining";
  else if (c30 >= expectedMonthly * 1.2)  return "growing";
  else                                     return "stable";
}

// ─── Main handler ─────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  let body: { lead_id?: string; channel?: Channel } = {};
  try { body = await req.json(); } catch { /* no body */ }

  // Build leads query — include "new" so leads that were discovered but not yet enriched
  // (e.g. FleetCraft/AGA stuck at "new" due to old batch-limit bug) still get scored and promoted.
  let query = supabase
    .from("sales_leads")
    .select("*")
    .in("status", ["enriched", "new", "researched"])
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

  // Fetch all order history for TrailBait leads in one query
  const trailbaitIds = (leads ?? [])
    .filter((l: any) => l.channel === "trailbait" && l.cin7_customer_id)
    .map((l: any) => l.cin7_customer_id);

  const orderHistoryMap: Record<string, any> = {};
  if (trailbaitIds.length) {
    const { data: histories } = await supabase
      .from("trailbait_order_history")
      .select("*")
      .in("cin7_customer_id", trailbaitIds);
    for (const h of histories ?? []) {
      orderHistoryMap[h.cin7_customer_id] = h;
    }
  }

  // Create scoring job
  const { data: job } = await supabase
    .from("research_jobs")
    .insert({ channel: body.channel ?? "all", job_type: "scoring", status: "running", started_at: new Date().toISOString() })
    .select("id").single();

  let scored = 0;
  const errors: string[] = [];

  for (const lead of leads ?? []) {
    try {
      let result: { score: number; breakdown: Record<string, number> };

      const orderHistory = lead.cin7_customer_id ? (orderHistoryMap[lead.cin7_customer_id] ?? null) : null;

      if      (lead.channel === "trailbait")  result = scoreTrailBait(lead, orderHistory);
      else if (lead.channel === "fleetcraft") result = scoreFleetCraft(lead);
      else                                    result = scoreAGA(lead);

      // Cap at 100
      const capped = Math.min(100, Math.max(0, result.score));

      await supabase.from("sales_leads").update({
        lead_score:      capped,
        score_breakdown: { ...(lead.score_breakdown ?? {}), ...result.breakdown },
        status:          "queued",
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
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
