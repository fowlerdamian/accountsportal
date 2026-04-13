import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const HS_BASE     = "https://api.hubapi.com";
const APOLLO_BASE = "https://api.apollo.io/v1";

type Channel = "trailbait" | "fleetcraft" | "aga";

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

function extractDomain(url: string): string | null {
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, "");
  } catch { return null; }
}

// ─── Contact position priorities per channel ──────────────────────────────────
// Each inner array is a tier — tier 0 is most desirable. Lower tier = better match.

const CONTACT_PRIORITIES: Record<Channel, string[][]> = {
  trailbait: [
    ["owner", "proprietor", "co-founder", "founder"],
    ["purchasing manager", "procurement manager", "buyer", "merchandise manager"],
    ["general manager", "operations manager", "store manager", "branch manager"],
    ["director", "managing director", "ceo", "md"],
    ["manager"],
  ],
  fleetcraft: [
    ["fleet manager", "fleet coordinator", "fleet supervisor"],
    ["procurement manager", "purchasing manager", "supply chain manager"],
    ["operations manager", "operations director", "general manager"],
    ["director", "managing director", "owner", "ceo"],
    ["manager"],
  ],
  aga: [
    ["purchasing director", "procurement director", "category director", "head of procurement"],
    ["purchasing manager", "procurement manager", "category manager", "sourcing manager"],
    ["product manager", "brand manager", "merchandise manager"],
    ["managing director", "ceo", "md", "director", "owner"],
    ["manager"],
  ],
};

// ─── Apollo.io contact finder ─────────────────────────────────────────────────

interface ApolloContact {
  name:     string;
  position: string;
  email:    string | null;
}

async function findContactViaApollo(
  domain: string,
  channel: Channel,
  apiKey: string
): Promise<ApolloContact | null> {
  try {
    const res = await fetch(`${APOLLO_BASE}/mixed_people/search`, {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Cache-Control": "no-cache",
        "X-Api-Key":     apiKey,
      },
      body: JSON.stringify({
        organization_domains: [domain],
        page:     1,
        per_page: 15,
        // No server-side title filter — we rank client-side for flexibility
      }),
    });

    if (!res.ok) return null;
    const data   = await res.json();
    const people = (data.people ?? []).filter((p: any) => p.first_name && p.last_name);
    if (!people.length) return null;

    const priorities = CONTACT_PRIORITIES[channel];
    let bestPerson: any = null;
    let bestTier        = priorities.length;

    for (const person of people) {
      const title = (person.title ?? "").toLowerCase();
      for (let tier = 0; tier < priorities.length; tier++) {
        if (priorities[tier].some((kw) => title.includes(kw))) {
          if (tier < bestTier) {
            bestTier   = tier;
            bestPerson = person;
          }
          break;
        }
      }
    }

    // Apollo returns results roughly by seniority — first result is a safe fallback
    if (!bestPerson) bestPerson = people[0];
    if (!bestPerson) return null;

    return {
      name:     bestPerson.name ?? `${bestPerson.first_name} ${bestPerson.last_name}`.trim(),
      position: bestPerson.title ?? "",
      email:    bestPerson.email ?? null,
    };
  } catch {
    return null;
  }
}

function hsHeaders(token: string) {
  return { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" };
}

// ─── HubSpot communication filters ───────────────────────────────────────────

/**
 * Returns HubSpot company IDs that have had a note created in the last `daysBack` days.
 * Uses a single batch search call — avoids per-company API calls.
 */
async function fetchRecentlyContactedCompanyIds(token: string, daysBack: number): Promise<Set<string>> {
  const since = Date.now() - daysBack * 86_400_000;
  const companyIds = new Set<string>();
  try {
    const res = await fetch(`${HS_BASE}/crm/v3/objects/notes/search`, {
      method:  "POST",
      headers: hsHeaders(token),
      body: JSON.stringify({
        filterGroups: [{ filters: [{ propertyName: "hs_timestamp", operator: "GTE", value: since }] }],
        properties:   ["hs_timestamp"],
        associations: ["companies"],
        limit: 100,
      }),
    });
    if (!res.ok) return companyIds;
    const data = await res.json();
    for (const note of data.results ?? []) {
      for (const assoc of note.associations?.companies?.results ?? []) {
        companyIds.add(String(assoc.id));
      }
    }
  } catch { /* ignore — fail open */ }
  return companyIds;
}

/**
 * Returns the subset of `dealIds` whose stage is closedwon or closedlost.
 * Uses a single batch read call.
 */
async function fetchClosedDealIds(dealIds: string[], token: string): Promise<Set<string>> {
  const closedIds = new Set<string>();
  if (!dealIds.length) return closedIds;
  try {
    const res = await fetch(`${HS_BASE}/crm/v3/objects/deals/batch/read`, {
      method:  "POST",
      headers: hsHeaders(token),
      body: JSON.stringify({
        inputs:     dealIds.map((id) => ({ id })),
        properties: ["dealstage"],
      }),
    });
    if (!res.ok) return closedIds;
    const data = await res.json();
    for (const deal of data.results ?? []) {
      const stage = deal.properties?.dealstage;
      if (stage === "closedwon" || stage === "closedlost") closedIds.add(deal.id);
    }
  } catch { /* ignore — fail open */ }
  return closedIds;
}

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

// ─── Website team/about page contact scraper ─────────────────────────────────

async function findContactViaWebsitePages(
  website: string,
  channel: Channel,
  anthropicKey: string
): Promise<{ name: string; position: string } | null> {
  if (!anthropicKey) return null;
  let base: string;
  try {
    base = new URL(website.startsWith("http") ? website : `https://${website}`).origin;
  } catch { return null; }
  // Limit to 3 highest-yield paths with a short timeout — prevents blowing the edge function budget
  const paths = ["/about-us", "/our-team", "/contact-us"];

  for (const path of paths) {
    try {
      const res = await fetch(`${base}${path}`, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; ResearchBot/1.0)" },
        signal:  AbortSignal.timeout(6000),
      });
      if (!res.ok) continue;
      const html = await res.text();
      const text = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 3000);
      if (text.length < 150) continue;

      const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
        method:  "POST",
        headers: { "Content-Type": "application/json", "x-api-key": anthropicKey, "anthropic-version": "2023-06-01" },
        signal:  AbortSignal.timeout(10000),
        body: JSON.stringify({
          model:      "claude-haiku-4-5-20251001",
          max_tokens: 120,
          messages:   [{ role: "user", content: `Find the most senior decision-maker's name and title on this ${channel === "trailbait" ? "retail/wholesale" : channel === "fleetcraft" ? "fleet fitout" : "automotive brand"} company page. Return ONLY valid JSON: {"name":"Full Name","position":"Title"} or null if no person found.\n\nPage text:\n${text}` }],
        }),
      });
      if (!aiRes.ok) continue;
      const aiData = await aiRes.json();
      const raw    = aiData.content?.[0]?.text?.trim() ?? "";
      const parsed = JSON.parse(raw === "null" ? "null" : raw);
      if (parsed?.name && parsed.name.length > 3) return parsed;
    } catch { /* try next path */ }
  }
  return null;
}

async function generateAICallReason(
  lead: any,
  orderHistory: any | null,
  channel: Channel,
  anthropicKey: string
): Promise<{ call_reason: string; talking_points: string[]; recommended_pitch: string }> {
  const cin7Context = orderHistory ? `
- Last order: ${orderHistory.last_order_date ? new Date(orderHistory.last_order_date).toLocaleDateString("en-AU") : "unknown"}
- Orders in last 30 days: ${orderHistory.order_count_30d}
- Orders in last 90 days: ${orderHistory.order_count_90d}
- Average order value: $${Math.round(orderHistory.average_order_value ?? 0).toLocaleString()}
- Top products: ${(orderHistory.top_products ?? []).slice(0,3).map((p: any) => p.name ?? p.sku).join(", ")}
- Win-back candidate: ${orderHistory.is_winback_candidate ? "YES" : "no"}` : "";

  const channelContext = channel === "trailbait"
    ? "TrailBait — we wholesale 4x4/4WD accessories (bull bars, suspension, roof racks, wiring looms, brackets). We sell to independent 4x4 shops and accessory retailers."
    : channel === "fleetcraft"
    ? "FleetCraft — we supply fleet vehicle accessories and fitout products (wiring looms, brackets, mounting systems, emergency vehicle accessories). We sell to vehicle upfitters and fleet fitout companies."
    : "AGA — we supply turn-key branded automotive accessories and OEM components. We help brands add products to their range without designing/manufacturing themselves.";

  const contactLine = lead.recommended_contact_name
    ? `Contact name: ${lead.recommended_contact_name}${lead.recommended_contact_position ? ` (${lead.recommended_contact_position})` : ""}`
    : "";

  const prompt = `You are writing a personalised sales call brief for a rep about to call this company.

Our company: ${channelContext}

Company being called: ${lead.company_name}
${lead.address ? `Location: ${lead.address}` : ""}
${contactLine}
${lead.google_rating ? `Google rating: ${lead.google_rating}/5 (${lead.google_review_count ?? 0} reviews)` : ""}
${lead.website_summary ? `About them: ${lead.website_summary}` : ""}
${lead.key_products_services?.length ? `Their products/services: ${lead.key_products_services.join(", ")}` : ""}
${lead.tender_context ? `Recent news: ${lead.tender_context.slice(0, 200)}` : ""}
${lead.is_existing_customer ? "Note: This is an EXISTING customer." : "Note: This is a NEW prospect — first contact."}
${cin7Context}

Write a JSON object with:
- "call_reason": 1-2 sentences — WHY call this specific company today. Be specific and reference their actual business.
- "recommended_pitch": A natural 2-3 sentence phone opening you'd actually say. ${lead.recommended_contact_name ? `Address ${lead.recommended_contact_name} by name.` : "Use a friendly opener."} Immediately reference something specific about THEIR business that connects to what we sell. Make it feel researched, not cold.
- "talking_points": Exactly 3 short bullet points — specific conversation hooks relevant to this company (reference their products, location, rating, news, or industry context).

No fluff. Be specific. Return valid JSON only.`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method:  "POST",
      headers: {
        "Content-Type":      "application/json",
        "x-api-key":         anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      signal: AbortSignal.timeout(20000),
      body: JSON.stringify({
        model:      "claude-sonnet-4-5",
        max_tokens: 500,
        messages:   [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) throw new Error("Anthropic API error");
    const data   = await res.json();
    const parsed = JSON.parse(data.content?.[0]?.text ?? "{}");
    return {
      call_reason:       parsed.call_reason       ?? generateRuleBasedReason(lead, orderHistory),
      recommended_pitch: parsed.recommended_pitch ?? CHANNEL_PITCH[channel],
      talking_points:    parsed.talking_points    ?? [],
    };
  } catch {
    return {
      call_reason:       generateRuleBasedReason(lead, orderHistory),
      recommended_pitch: CHANNEL_PITCH[channel],
      talking_points:    [],
    };
  }
}

// ─── Build context brief ──────────────────────────────────────────────────────

function buildContextBrief(
  lead: any,
  orderHistory: any | null,
  callReason: string,
  recommendedPitch: string,
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
      last_order:            orderHistory.last_order_date ? new Date(orderHistory.last_order_date).toLocaleDateString("en-AU") : null,
      days_since_last_order: orderHistory.days_since_last_order,
      order_count_90d:       orderHistory.order_count_90d,
      order_count_30d:       orderHistory.order_count_30d,
      avg_order_value:       orderHistory.average_order_value,
      top_products:          (orderHistory.top_products ?? []).map((p: any) => p.sku ?? p.name),
      is_winback:            orderHistory.is_winback_candidate,
    } : null,
    call_reason:         callReason,
    recommended_pitch:   recommendedPitch,
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
        .in("status", ["queued", "contacted", "enriched"])
        .gt("lead_score", 0)
        .order("lead_score", { ascending: false })
        .limit(30);

      if (!leads?.length) {
        await supabase.from("research_jobs").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", job?.id);
        summary[channel] = 0;
        continue;
      }

      // ── HubSpot communication filter ────────────────────────────────────────
      // Suppress leads that already have active HubSpot engagement so we don't
      // double-call anyone currently in an open sales conversation.
      const hsToken = Deno.env.get("HUBSPOT_ACCESS_TOKEN") ?? "";
      let filteredLeads = leads as any[];

      if (hsToken) {
        const suppressedIds = new Set<string>();

        // 1. Suppress closed deals (won or lost) — no point calling
        const dealIds = leads.filter((l: any) => l.hubspot_deal_id).map((l: any) => l.hubspot_deal_id);
        const closedDealIds = await fetchClosedDealIds(dealIds, hsToken);
        for (const lead of leads as any[]) {
          if (lead.hubspot_deal_id && closedDealIds.has(lead.hubspot_deal_id)) {
            suppressedIds.add(lead.id);
          }
        }

        // 2. Suppress companies with a HubSpot note in the last 14 days
        const recentCompanyIds = await fetchRecentlyContactedCompanyIds(hsToken, 14);
        for (const lead of leads as any[]) {
          if (lead.hubspot_company_id && recentCompanyIds.has(String(lead.hubspot_company_id))) {
            suppressedIds.add(lead.id);
          }
        }

        if (suppressedIds.size) {
          filteredLeads = leads.filter((l: any) => !suppressedIds.has(l.id));
        }
      }

      if (!filteredLeads.length) {
        await supabase.from("research_jobs").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", job?.id);
        summary[channel] = 0;
        continue;
      }

      // Boost win-back candidates for TrailBait
      let ranked = [...filteredLeads];
      if (channel === "trailbait") {
        // Fetch order history for win-back check
        const cin7Ids = filteredLeads.filter((l: any) => l.cin7_customer_id).map((l: any) => l.cin7_customer_id);
        const historyMap: Record<string, any> = {};
        if (cin7Ids.length) {
          const { data: histories } = await supabase
            .from("trailbait_order_history")
            .select("*")
            .in("cin7_customer_id", cin7Ids);
          for (const h of histories ?? []) historyMap[h.cin7_customer_id] = h;
        }

        // Attach order history and compute priority score
        ranked = filteredLeads
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
        ranked = filteredLeads.map((l: any) => ({ ...l, _orderHistory: null }));
      }

      // Take top 15 — keeps total AI time well within Supabase's 150s limit
      const top20 = ranked.slice(0, 15);

      // Resolve contacts — Apollo first, then website team/about pages as fallback
      const apolloKey = Deno.env.get("APOLLO_API_KEY") ?? "";
      for (const lead of top20) {
        // Try if: no contact at all, or contact was scraped from homepage (often just company name), or source unknown
        const needsContact = !lead.recommended_contact_name
          || lead.recommended_contact_source === "website"
          || !lead.recommended_contact_source;

        if (!needsContact) continue;

        let contact: ApolloContact | null = null;
        let contactSource = "website_team_page";

        // 1. Apollo (fastest and most reliable when available)
        if (apolloKey && lead.website) {
          const domain = extractDomain(lead.website);
          if (domain) {
            contact = await findContactViaApollo(domain, channel, apolloKey);
            if (contact) contactSource = "apollo";
            await sleep(300);
          }
        }

        // 2. Fallback: scrape team/about/contact pages with Claude Haiku
        if (!contact && lead.website && anthropicKey) {
          const scraped = await findContactViaWebsitePages(lead.website, channel, anthropicKey);
          if (scraped) {
            contact = { name: scraped.name, position: scraped.position, email: null };
            // contactSource remains "website_team_page"
          }
        }

        if (contact) {
          const contactUpdate: Record<string, any> = {
            recommended_contact_name:     contact.name,
            recommended_contact_position: contact.position,
            recommended_contact_source:   contactSource,
          };
          if (contact.email && !lead.email) contactUpdate.email = contact.email;

          await supabase.from("sales_leads").update(contactUpdate).eq("id", lead.id);

          lead.recommended_contact_name     = contact.name;
          lead.recommended_contact_position = contact.position;
          lead.recommended_contact_source   = contactUpdate.recommended_contact_source;
          if (contact.email && !lead.email) lead.email = contact.email;
        }
      }

      // Generate call list entries
      const inserts = [];
      for (let i = 0; i < top20.length; i++) {
        const lead         = top20[i];
        const orderHistory = (lead as any)._orderHistory ?? null;

        let callReason       = generateRuleBasedReason(lead, orderHistory);
        let recommendedPitch = CHANNEL_PITCH[channel];
        let talkingPoints: string[] = [];

        // Generate AI pitch for every lead — personalised pitch is the core value
        if (useAI && anthropicKey) {
          const ai      = await generateAICallReason(lead, orderHistory, channel, anthropicKey);
          callReason       = ai.call_reason;
          recommendedPitch = ai.recommended_pitch;
          talkingPoints    = ai.talking_points;
          await sleep(200); // brief pause between Claude calls
        }

        const contextBrief = buildContextBrief(lead, orderHistory, callReason, recommendedPitch, channel);

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
