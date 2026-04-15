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
  companyName: string,
  channel: Channel,
  apiKey: string
): Promise<ApolloContact | null> {
  const pickBest = (people: any[]): ApolloContact | null => {
    if (!people.length) return null;
    const priorities = CONTACT_PRIORITIES[channel];
    let bestPerson: any = null;
    let bestTier        = priorities.length;
    for (const person of people) {
      const title = (person.title ?? "").toLowerCase();
      for (let tier = 0; tier < priorities.length; tier++) {
        if (priorities[tier].some((kw) => title.includes(kw))) {
          if (tier < bestTier) { bestTier = tier; bestPerson = person; }
          break;
        }
      }
    }
    const p = bestPerson ?? people[0];
    return {
      name:     p.name ?? `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim(),
      position: p.title ?? "",
      email:    p.email ?? null,
    };
  };

  const apolloSearch = async (body: Record<string, unknown>): Promise<any[]> => {
    try {
      const res = await fetch(`${APOLLO_BASE}/people/search`, {
        method:  "POST",
        headers: { "Content-Type": "application/json", "X-Api-Key": apiKey },
        signal:  AbortSignal.timeout(8000),
        body:    JSON.stringify({ per_page: 15, page: 1, ...body }),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        console.error(`Apollo ${res.status}: ${txt.slice(0, 200)}`);
        return [];
      }
      const data = await res.json();
      return (data.people ?? []).filter((p: any) => p.first_name && p.last_name);
    } catch (e) {
      console.error("Apollo fetch error:", e);
      return [];
    }
  };

  // Strategy 1: search by domain (most precise)
  let people = await apolloSearch({ organization_domains: [domain] });
  if (people.length) return pickBest(people);

  // Strategy 2: search by organization name (catches companies not indexed by domain)
  await sleep(300);
  people = await apolloSearch({
    q_organization_name: companyName,
    person_seniorities: ["owner", "founder", "c_suite", "vp", "director", "manager"],
  });
  return pickBest(people);
}

function hsHeaders(token: string) {
  return { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" };
}

// ─── HubSpot communication filters ───────────────────────────────────────────

interface HubSpotNote {
  date: string;   // formatted e.g. "12 Apr 2026"
  body: string;   // truncated note text
}

/**
 * Fetches ALL notes for the given HubSpot company IDs via the associations batch API.
 * No date window — returns every note ever logged against those companies.
 * Returns: Map of company_id → notes sorted newest-first (max 5 per company).
 */
async function fetchHubSpotNotesForCompanies(
  token: string,
  companyIds: string[]
): Promise<Map<string, HubSpotNote[]>> {
  const notesMap = new Map<string, HubSpotNote[]>();
  if (!companyIds.length) return notesMap;

  try {
    // Step 1: batch-read note associations for all companies
    const assocRes = await fetch(`${HS_BASE}/crm/v4/associations/companies/notes/batch/read`, {
      method:  "POST",
      headers: hsHeaders(token),
      signal:  AbortSignal.timeout(10000),
      body: JSON.stringify({ inputs: companyIds.map((id) => ({ id })) }),
    });
    if (!assocRes.ok) return notesMap;
    const assocData = await assocRes.json();

    // Build company → noteIds map and collect all unique note IDs
    const companyNoteIds: Record<string, string[]> = {};
    const allNoteIds = new Set<string>();
    for (const result of assocData.results ?? []) {
      const cid     = String(result.from.id);
      const noteIds = (result.to ?? []).map((t: any) => String(t.toObjectId));
      if (noteIds.length) {
        companyNoteIds[cid] = noteIds;
        noteIds.forEach((id: string) => allNoteIds.add(id));
      }
    }
    if (!allNoteIds.size) return notesMap;

    // Step 2: batch-read note bodies (cap at 200)
    const noteList = [...allNoteIds].slice(0, 200);
    const notesRes = await fetch(`${HS_BASE}/crm/v3/objects/notes/batch/read`, {
      method:  "POST",
      headers: hsHeaders(token),
      signal:  AbortSignal.timeout(10000),
      body: JSON.stringify({
        inputs:     noteList.map((id) => ({ id })),
        properties: ["hs_timestamp", "hs_note_body"],
      }),
    });
    if (!notesRes.ok) return notesMap;
    const notesData = await notesRes.json();

    // Build noteId → HubSpotNote
    const noteById: Record<string, HubSpotNote> = {};
    for (const note of notesData.results ?? []) {
      const body = (note.properties?.hs_note_body ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (!body) continue;
      const ts   = note.properties?.hs_timestamp ? new Date(note.properties.hs_timestamp) : null;
      const date = ts ? ts.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" }) : "";
      noteById[note.id] = { date, body: body.slice(0, 300) };
    }

    // Assemble per-company note list sorted newest-first, max 5
    for (const [cid, noteIds] of Object.entries(companyNoteIds)) {
      const notes = noteIds
        .map((id) => noteById[id])
        .filter(Boolean)
        .sort((a, b) => {
          const ta = a.date ? new Date(a.date).getTime() : 0;
          const tb = b.date ? new Date(b.date).getTime() : 0;
          return tb - ta;
        })
        .slice(0, 5);
      if (notes.length) notesMap.set(cid, notes);
    }
  } catch (e) {
    console.error("[calllist] fetchHubSpotNotesForCompanies error:", e);
  }

  return notesMap;
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
  const paths = ["/about-us", "/our-team", "/team", "/contact-us", "/contact", "/about", "/meet-the-team", "/staff", "/who-we-are", ""];

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
  hsNotes: HubSpotNote[],
  channel: Channel,
  anthropicKey: string
): Promise<{ call_reason: string; talking_points: string[]; recommended_pitch: string; hook_tier: number }> {

  // ── Channel competitive framing ───────────────────────────────────────────────
  const channelCompetitive = channel === "trailbait"
    ? `TrailBait competes in the mid-market 4x4 accessory space. ARB sits above us (premium price, strong brand). Chinese imports sit below (cheap, unreliable, no support). Our angle: ARB-comparable quality at a price point independent shops can actually margin. Shops stocking only ARB are leaving mid-range sales on the table; shops stocking Chinese imports are getting warranty calls.`
    : channel === "fleetcraft"
    ? `FleetCraft supplies fleet vehicle accessories and fitout products (wiring looms, brackets, mounting systems, emergency vehicle accessories). Fleet upfitters need fast, reliable fitout that works first time — vehicle downtime costs their clients money. Our angle: fitout-ready product that reduces install time and callbacks.`
    : `AGA supplies turn-key branded automotive accessories and OEM components. Our angle: brands can expand their product range and earn margin without the design, tooling, or manufacturing investment. We absorb the product development risk; they keep the brand equity.`;

  // ── Cin7 order history block ──────────────────────────────────────────────────
  const cin7Lines: string[] = [];
  if (orderHistory) {
    const lastOrderDate = orderHistory.last_order_date
      ? new Date(orderHistory.last_order_date).toLocaleDateString("en-AU")
      : "unknown";
    cin7Lines.push(`Last order: ${lastOrderDate}`);
    cin7Lines.push(`Orders last 30d / 90d: ${orderHistory.order_count_30d} / ${orderHistory.order_count_90d}`);
    cin7Lines.push(`Average order value: $${Math.round(orderHistory.average_order_value ?? 0).toLocaleString()}`);
    if ((orderHistory.top_products ?? []).length) {
      cin7Lines.push(`Top products ordered: ${(orderHistory.top_products ?? []).slice(0,4).map((p: any) => p.name ?? p.sku).join(", ")}`);
    }
    if (orderHistory.is_winback_candidate) {
      cin7Lines.push(`⚠️ WIN-BACK: Has not ordered in ${orderHistory.days_since_last_order ?? "?"} days — previously a regular customer`);
    }
  }

  // ── Build research data block ─────────────────────────────────────────────────
  const researchLines: string[] = [];
  researchLines.push(`Company: ${lead.company_name}`);
  if (lead.address)                         researchLines.push(`Location: ${lead.address}`);
  if (lead.recommended_contact_name)        researchLines.push(`Contact: ${lead.recommended_contact_name}${lead.recommended_contact_position ? ` — ${lead.recommended_contact_position}` : ""} (source: ${lead.recommended_contact_source ?? "unknown"})`);
  if (lead.google_rating)                   researchLines.push(`Google: ${lead.google_rating}/5 from ${lead.google_review_count ?? 0} reviews`);
  if (lead.website_summary)                 researchLines.push(`About them: ${lead.website_summary}`);
  if (lead.key_products_services?.length)   researchLines.push(`Their products/services: ${lead.key_products_services.join(", ")}`);
  if (lead.tender_context)                  researchLines.push(`Recent news / tender: ${lead.tender_context.slice(0, 300)}`);
  researchLines.push(lead.is_existing_customer ? `Customer status: EXISTING customer` : `Customer status: NEW prospect — no prior relationship`);
  if (cin7Lines.length)                     researchLines.push(...cin7Lines);
  researchLines.push(`Lead score: ${lead.lead_score}/100`);
  if (hsNotes.length) {
    researchLines.push(`Previous HubSpot contact (${hsNotes.length} note${hsNotes.length > 1 ? "s" : ""}):`);
    for (const n of hsNotes) researchLines.push(`  [${n.date}] ${n.body}`);
  } else {
    researchLines.push(`Previous HubSpot contact: none on record`);
  }

  const researchBlock = researchLines.map(l => `  ${l}`).join("\n");

  const prompt = `You are writing a pre-call intelligence brief for a B2B sales rep.

Your output is a CALL DIRECTION — a strategic compass for the rep, not a phone script.

═══ WHAT WE SELL ═══
${channelCompetitive}

═══ PROSPECT RESEARCH ═══
${researchBlock}

═══ YOUR TASK ═══
Write a call direction using this exact 3-sentence structure:

  Sentence 1 — PRESSURE CONTEXT: Who this company/person is and what pressure or dynamic they are operating under right now. Draw on their business type, location, customer base, competitive position, or order pattern. Make it feel like you understand their world.

  Sentence 2 — SPECIFIC HOOK (the reason to call NOW): Use the highest available tier:
    • Tier 1 (best): Time-sensitive trigger — win-back lapse, tender/contract win, recent news, job posting signals expansion, regulatory deadline
    • Tier 2: Known pain point — declining orders, competitor gap, downstream customer pressure, product range weakness
    • Tier 3 (fallback only): General fit — location, product alignment, market position

  Sentence 3 — ANGLE: How our product/solution enters their world as an opportunity FOR THEM. Frame it from their perspective — what they gain or avoid — not as a product description.

═══ RULES ═══
- Sentences 1 and 2 are entirely about THEM. "We" or our product name must not appear until sentence 3.
- Be specific. Reference actual data from the research. Never write generic phrases like "they sell accessories", "they value quality", "as a [channel] business".
- If the contact name is from "apollo" or "website_team_page", you may reference their role but not their name in the call direction (the rep will use the name verbally).
- The call direction is intelligence for the rep, not words they will read aloud.
- "talking_points" must each reference a specific detail from the research — not generic advice.

Return ONLY valid JSON, no markdown:
{
  "call_direction": "Sentence 1. Sentence 2. Sentence 3.",
  "call_reason": "One crisp sentence summarising why this lead is on the list today (for the list view — can be blunt).",
  "talking_points": ["specific hook 1", "specific hook 2", "specific hook 3"],
  "hook_tier": 1
}`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method:  "POST",
      headers: {
        "Content-Type":      "application/json",
        "x-api-key":         anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      signal: AbortSignal.timeout(25000),
      body: JSON.stringify({
        model:      "claude-sonnet-4-20250514",
        max_tokens: 600,
        messages:   [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      console.error(`[calllist] Anthropic ${res.status}: ${txt.slice(0, 200)}`);
      throw new Error("Anthropic API error");
    }
    const data   = await res.json();
    const raw    = (data.content?.[0]?.text ?? "").trim();
    // Strip any markdown code fences if present
    const clean  = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
    const parsed = JSON.parse(clean);
    return {
      call_reason:       parsed.call_reason       ?? generateRuleBasedReason(lead, orderHistory),
      recommended_pitch: parsed.call_direction     ?? CHANNEL_PITCH[channel],
      talking_points:    parsed.talking_points     ?? [],
      hook_tier:         parsed.hook_tier          ?? 3,
    };
  } catch (err) {
    console.error(`[calllist] generateAICallReason failed for ${lead.company_name}:`, err);
    return {
      call_reason:       generateRuleBasedReason(lead, orderHistory),
      recommended_pitch: CHANNEL_PITCH[channel],
      talking_points:    [],
      hook_tier:         3,
    };
  }
}

// ─── Build context brief ──────────────────────────────────────────────────────

function buildContextBrief(
  lead: any,
  orderHistory: any | null,
  callReason: string,
  recommendedPitch: string,
  channel: Channel,
  hookTier: number = 3,
  hsNotes: HubSpotNote[] = []
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
    hook_tier:           hookTier,
    hubspot_notes:       hsNotes.length ? hsNotes : null,
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
      // notesMap is populated from HubSpot and attached to each lead for context
      let hsNotesMap = new Map<string, HubSpotNote[]>();

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

        // 2. Fetch all notes for leads that have a hubspot_company_id (no date limit)
        const leadCompanyIds = (leads as any[])
          .filter((l: any) => l.hubspot_company_id)
          .map((l: any) => String(l.hubspot_company_id));
        if (leadCompanyIds.length) {
          hsNotesMap = await fetchHubSpotNotesForCompanies(hsToken, leadCompanyIds);
        }

        // 3. Suppress companies with a note in the last 14 days
        const cutoff14 = Date.now() - 14 * 86_400_000;
        for (const lead of leads as any[]) {
          if (!lead.hubspot_company_id) continue;
          const cid   = String(lead.hubspot_company_id);
          const notes = hsNotesMap.get(cid) ?? [];
          if (notes.some((n) => n.date && new Date(n.date).getTime() > cutoff14)) {
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
            contact = await findContactViaApollo(domain, lead.company_name, channel, apolloKey);
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
        const hsNotes      = lead.hubspot_company_id ? (hsNotesMap.get(String(lead.hubspot_company_id)) ?? []) : [];

        let callReason       = generateRuleBasedReason(lead, orderHistory);
        let recommendedPitch = CHANNEL_PITCH[channel];
        let talkingPoints: string[] = [];
        let hookTier         = 3;

        // Generate AI call direction for every lead — this is the core value
        if (useAI && anthropicKey) {
          const ai      = await generateAICallReason(lead, orderHistory, hsNotes, channel, anthropicKey);
          callReason       = ai.call_reason;
          recommendedPitch = ai.recommended_pitch;
          talkingPoints    = ai.talking_points;
          hookTier         = ai.hook_tier;
          await sleep(200); // brief pause between Claude calls
        }

        const contextBrief = buildContextBrief(lead, orderHistory, callReason, recommendedPitch, channel, hookTier, hsNotes);

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
