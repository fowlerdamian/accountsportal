import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Channel = "trailbait" | "fleetcraft" | "aga";

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
  const summary = (lead.website_summary ?? "").toLowerCase();

  // Is installer/upfitter (20)
  const installerKeywords = ["fitout", "fit-out", "upfit", "upfitter", "installer", "modification", "vehicle mod"];
  const confirmedKeywords = ["specialist", "dedicated", "fleet", "commercial vehicle"];
  const isConfirmed = installerKeywords.some((k) => summary.includes(k)) && confirmedKeywords.some((k) => summary.includes(k));
  const isLikely    = installerKeywords.some((k) => summary.includes(k));
  bd.is_installer = isConfirmed ? 20 : isLikely ? 10 : 0;

  // Government contracts (15)
  const hasTender = !!(lead.tender_context || summary.includes("contract") || summary.includes("government"));
  bd.government_contracts = hasTender ? 15 : 0;

  // Google rating (10)
  if      (lead.google_rating == null)    bd.google_rating = 0;
  else if (lead.google_rating >= 4.5)     bd.google_rating = 10;
  else if (lead.google_rating >= 4.0)     bd.google_rating = 7;
  else                                     bd.google_rating = 3;

  // Company size (15)
  const size = lead.score_breakdown?.company_size ?? "unknown";
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

  // Has own brand (25)
  const hasBrand = lead.score_breakdown?.has_own_brand ?? false;
  bd.has_own_brand = hasBrand ? 25 : 0;

  // Currently imports (15)
  const imports = lead.score_breakdown?.currently_imports;
  const summary = (lead.website_summary ?? "").toLowerCase();
  const importEvidence = imports || summary.includes("import") || summary.includes("overseas") || summary.includes("china");
  const localMfg = summary.includes("manufacture locally") || summary.includes("made in australia");
  bd.currently_imports = importEvidence && !localMfg ? 15 : localMfg ? 5 : 8;

  // Company size (15)
  const size = lead.score_breakdown?.company_size ?? "unknown";
  bd.company_size = size === "large" ? 15 : size === "medium" ? 10 : size === "small" ? 5 : 7;

  // Website quality (10)
  const wq = lead.score_breakdown?.website_quality ?? (lead.website ? "basic" : "none");
  bd.website_quality = wq === "products" ? 10 : wq === "basic" ? 5 : 0;

  // Product fit for AGA (15)
  const autoKeywords = ["automotive", "4x4", "4wd", "offroad", "vehicle", "accessories", "lighting", "towing", "bull bar", "suspension"];
  const adjacentKeywords = ["industrial", "marine", "recreational", "outdoor", "sports"];
  const isAuto = autoKeywords.some((k) => summary.includes(k));
  const isAdj  = adjacentKeywords.some((k) => summary.includes(k));
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
    .in("status", ["enriched", "new"])
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
