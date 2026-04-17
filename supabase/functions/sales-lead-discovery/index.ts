import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CSE_BASE    = "https://www.googleapis.com/customsearch/v1";
const PLACES_BASE = "https://maps.googleapis.com/maps/api/place";

type Channel = "trailbait" | "fleetcraft" | "aga";

// ─── Search query sets per channel ───────────────────────────────────────────

const DISCOVERY_QUERIES: Record<Channel, string[]> = {
  trailbait: [
    "4x4 accessories shop Australia",
    "4wd accessories retailer Australia",
    "bull bar fitting shop Australia",
    "4x4 suspension shop Australia",
    "automotive accessories retailer Australia",
    "4wd parts shop independent Australia",
    "off road accessories shop Australia",
  ],
  fleetcraft: [
    "fleet fitout company Australia",
    "vehicle upfitter Australia",
    "fleet modification specialist Australia",
    "commercial vehicle accessories installer Australia",
    "emergency vehicle upfit Australia",
    "fleet accessories installer Australia",
    "awarded contract fleet fitout Australia",
    "vehicle upfit contract awarded Australia",
    "emergency vehicle contract awarded Australia",
    "fleet modification tender awarded Australia",
    "police vehicle contract Australia",
    "ambulance build awarded Australia",
  ],
  aga: [
    "automotive accessories brand Australia",
    "4x4 brand Australia manufacturer",
    "automotive lighting brand Australia",
    "OEM automotive components manufacturer Australia",
    "vehicle accessories brand own label Australia",
    "4x4 accessories importer Australia brand",
  ],
};

// ─── Market research query sets (5 new sources per channel) ──────────────────

type MarketQuery = { query: string; source: string };

// Australian automotive trade-press domains — grouped so one CSE query covers all.
const TRADE_PRESS_SITES =
  "site:autotalk.com.au OR site:tradetruck.com.au OR site:fleetnews.com.au OR site:motormag.com.au OR site:4wdaction.com.au";

const MARKET_QUERIES: Record<Channel, MarketQuery[]> = {
  trailbait: [
    // LinkedIn — company pages for 4wd retailers
    { query: 'site:linkedin.com/company "4wd accessories" OR "4x4 accessories" australia',  source: "linkedin" },
    // Seek — companies hiring = active 4x4 shops
    { query: "site:seek.com.au \"4x4 accessories\" OR \"4wd accessories\" australia",        source: "seek_jobs" },
    // Yellow Pages — business directory
    { query: "site:yellowpages.com.au \"4wd accessories\" OR \"4x4 accessories\"",           source: "yellow_pages" },
    // Market news — new stores, expansions, acquisitions
    { query: "4x4 accessories store opening expansion new location australia 2024 2025",     source: "market_news" },
    // AAAA trade directory — Australian Automotive Aftermarket Association members
    { query: "site:aaaa.com.au 4wd accessories retail member",                               source: "trade_directory" },
    // Facebook business pages — small independent 4x4 shops
    { query: 'site:facebook.com "4wd accessories" OR "4x4 accessories" australia',           source: "facebook" },
    // Instagram business — modern 4x4 shops with active social
    { query: 'site:instagram.com "4wd accessories" OR "4x4 shop" australia',                 source: "instagram" },
    // Australian automotive trade press — dealer news, new ranges, store openings
    { query: `${TRADE_PRESS_SITES} 4x4 accessories retailer`,                                source: "trade_press" },
  ],
  fleetcraft: [
    // LinkedIn — fleet upfit / fitout companies
    { query: 'site:linkedin.com/company "fleet fitout" OR "vehicle upfit" australia',        source: "linkedin" },
    // Seek — companies hiring fleet tech roles
    { query: "site:seek.com.au \"fleet vehicle\" fitout upfitter technician australia",      source: "seek_jobs" },
    // Yellow Pages — fleet modification shops
    { query: "site:yellowpages.com.au \"fleet fitout\" OR \"vehicle upfit\" australia",      source: "yellow_pages" },
    // Market news — contract wins, expansions
    { query: "fleet fitout company contract win new facility expansion australia 2024 2025", source: "market_news" },
    // AusTender is handled separately via the OCDS API (not a CSE query)
    // Facebook business pages — fleet upfitters
    { query: 'site:facebook.com "fleet fitout" OR "vehicle upfit" australia',                source: "facebook" },
    // Instagram business — upfitters with social presence
    { query: 'site:instagram.com "fleet fitout" OR "vehicle upfit" australia',               source: "instagram" },
    // Australian automotive trade press — contract wins, fleet news
    { query: `${TRADE_PRESS_SITES} fleet fitout OR vehicle upfit`,                           source: "trade_press" },
  ],
  aga: [
    // LinkedIn — automotive accessories brands
    { query: 'site:linkedin.com/company "automotive accessories" brand manufacturer australia', source: "linkedin" },
    // Seek — brand/product manager roles at accessories companies
    { query: "site:seek.com.au \"automotive accessories\" brand manager australia",             source: "seek_jobs" },
    // Yellow Pages — accessories manufacturers and importers
    { query: "site:yellowpages.com.au \"automotive accessories\" manufacturer importer",        source: "yellow_pages" },
    // Market news — new brands, product launches, distribution deals
    { query: "automotive accessories brand launch distribution deal australia 2024 2025",       source: "market_news" },
    // AAAA trade directory — accessories brand members
    { query: "site:aaaa.com.au automotive accessories brand manufacturer member",               source: "trade_directory" },
    // Facebook business pages — accessories brands
    { query: 'site:facebook.com "automotive accessories" brand manufacturer australia',         source: "facebook" },
    // Instagram business — accessories brands
    { query: 'site:instagram.com "automotive accessories" brand australia',                     source: "instagram" },
    // Australian automotive trade press — brand launches, distribution deals
    { query: `${TRADE_PRESS_SITES} automotive accessories brand OR manufacturer`,               source: "trade_press" },
  ],
};

// ─── Extract company name from a web result based on source ──────────────────

function extractCompanyFromMarketResult(
  item: { title: string; link: string; snippet: string },
  source: string,
): { name: string; website: string | null } {
  const title   = item.title   ?? "";
  const link    = item.link    ?? "";
  const snippet = item.snippet ?? "";
  const domain  = extractDomain(link);

  switch (source) {
    case "linkedin": {
      // "Company Name | LinkedIn" or "Company Name: Overview | LinkedIn"
      const name = title.split("|")[0].split(":")[0].trim();
      return { name: name || domain, website: null }; // don't store a linkedin URL as the company website
    }
    case "seek_jobs": {
      // "Job Title at Company Name | SEEK" or "Job Title - Company Name"
      const atMatch   = title.match(/\bat\s+([^|–\-]+)/i);
      const dashMatch = title.match(/–\s*([^|]+)/);
      const name = atMatch?.[1]?.trim() ?? dashMatch?.[1]?.trim() ?? domain;
      return { name, website: null };
    }
    case "yellow_pages": {
      // "Company Name - Yellow Pages Australia"
      const name = title.split(" - ")[0].split(" | ")[0].trim();
      return { name: name || domain, website: link };
    }
    case "trade_directory": {
      const name = title.split("|")[0].split(" - ")[0].trim();
      return { name: name || domain, website: link };
    }
    case "facebook": {
      // Facebook titles: "Company Name - Home | Facebook" or "Company Name | Facebook"
      // or "Company Name - About | Facebook"
      const name = title
        .split(/\s[|\-–]\s/)[0]
        .replace(/\s*-\s*(Home|About|Posts|Reviews|Photos|Videos)\s*$/i, "")
        .trim();
      return { name: name || domain, website: null };
    }
    case "instagram": {
      // Instagram titles: "Name (@handle) • Instagram photos and videos"
      const parenMatch = title.match(/^([^(]+?)\s*\(@/);
      const name = parenMatch?.[1]?.trim()
        ?? title.split("•")[0].split("|")[0].split("-")[0].trim();
      return { name: name || domain, website: null };
    }
    case "trade_press": {
      // News article — the title is a headline, not a company name. Try to pull
      // a company from the snippet (look for a capitalised name before a verb
      // like "announced", "launches", "wins"); otherwise fall back to headline lead.
      const verbMatch = snippet.match(/([A-Z][A-Za-z0-9&'\.\-]*(?:\s+[A-Z][A-Za-z0-9&'\.\-]*){0,4})\s+(?:announced|announces|launches?|launched|wins?|won|secured|unveiled|opened|opens|named)/);
      const name = verbMatch?.[1]?.trim()
        ?? title.split(/\s[|\-–]\s/)[0].trim();
      return { name: name || domain, website: null };
    }
    default: {
      // market_news: extract first meaningful entity
      const name = title.split(" - ")[0].split("|")[0].trim();
      return { name: name || domain, website: null };
    }
  }
}

// ─── AusTender OCDS API ───────────────────────────────────────────────────────
// Base: https://api.tenders.gov.au/ocds/
// No auth required — public API, OCDS-compliant JSON

const AUSTENDER_BASE = "https://api.tenders.gov.au/ocds";

// ─── FleetCraft product relevance — what we actually sell ────────────────────
// A contract is relevant if it involves work where our products would be used.
// Grouped by product category so we can also surface WHICH products are relevant.

const FLEETCRAFT_PRODUCT_KEYWORDS: Record<string, string[]> = {
  "emergency vehicle fitout": [
    "ambulance", "emergency vehicle", "rescue vehicle", "fire appliance",
    "fire truck", "police vehicle", "police car", "highway patrol",
    "paramedic vehicle", "first responder", "incident response vehicle",
  ],
  "fleet vehicle accessories": [
    "fleet fitout", "fleet fit-out", "vehicle fitout", "vehicle fit-out",
    "fleet upfit", "vehicle upfit", "fleet modification", "fleet conversion",
    "vehicle conversion", "fleet build", "fleet services",
    "commercial vehicle fitout", "work vehicle fitout",
  ],
  "canopy & tray systems": [
    "canopy", "tray body", "ute tray", "service body", "utility body",
    "alloy tray", "steel tray", "tray fitout",
  ],
  "storage & toolbox": [
    "toolbox", "tool storage", "underbody storage", "drawer system",
    "cargo management", "equipment storage",
  ],
  "bull bars & protection": [
    "bull bar", "nudge bar", "protection bar", "roo bar", "winch bar",
    "underbody protection", "side steps", "running boards",
  ],
  "lighting & electrical": [
    "lightbar", "light bar", "emergency lighting", "vehicle lighting",
    "wiring loom", "electrical fitout", "beacon", "strobe",
    "led bar", "warning lights",
  ],
  "towing & recovery": [
    "tow bar", "towbar", "towing equipment", "recovery equipment",
    "winch", "snatch block", "recovery gear",
  ],
  "government fleet": [
    "government fleet", "council fleet", "defence fleet", "state fleet",
    "federal fleet", "municipal fleet", "public sector fleet",
  ],
};

function getRelevantProductCategories(text: string): string[] {
  const lower = text.toLowerCase();
  return Object.entries(FLEETCRAFT_PRODUCT_KEYWORDS)
    .filter(([, keywords]) => keywords.some((kw) => lower.includes(kw)))
    .map(([category]) => category);
}

// What the supplier will need from us, per product category
const CATEGORY_SALES_ANGLE: Record<string, string> = {
  "emergency vehicle fitout":  "will need lightbars, beacons, wiring looms, and emergency vehicle accessories for each build",
  "fleet vehicle accessories": "will need bull bars, underbody protection, tow bars, and fleet fitout components across the contract",
  "canopy & tray systems":     "will need canopy and tray fitout components for utility vehicles in the contract",
  "storage & toolbox":         "will need toolboxes, drawer systems, and cargo storage solutions",
  "bull bars & protection":    "will need bull bars and vehicle protection equipment fitted to contract vehicles",
  "lighting & electrical":     "will need lightbars, beacons, wiring looms, and vehicle electrical fitout",
  "towing & recovery":         "will need tow bars and recovery equipment across the fleet",
  "government fleet":          "as a government fleet supplier will need accessories and fitout components across multiple vehicle types",
};

// Returns true if the string looks like a bare contract reference number, not a title
function isContractNumber(s: string): boolean {
  return /^(CN|ATM|SON|RFT|RFQ|EOI|PANEL)[\s\-]?\d+/i.test(s.trim()) || /^\d{4,}$/.test(s.trim());
}

interface AusTenderSupplier {
  name:           string;
  abn:            string | null;
  address:        string | null;
  state:          string | null;
  tender_context: string;
}

async function fetchAusTenderSuppliers(daysBack = 30): Promise<AusTenderSupplier[]> {
  const now  = new Date();
  const from = new Date(now);
  from.setDate(now.getDate() - daysBack);

  const startTs = from.toISOString().split(".")[0] + "Z";
  const endTs   = now.toISOString().split(".")[0]  + "Z";

  const url = `${AUSTENDER_BASE}/findByDates/contractPublished/${startTs}/${endTs}`;

  let data: any;
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal:  AbortSignal.timeout(30000),
    });
    if (!res.ok) {
      console.error(`[austender] HTTP ${res.status}`);
      return [];
    }
    data = await res.json();
  } catch (err) {
    console.error("[austender] fetch failed:", err);
    return [];
  }

  const releases: any[] = data.releases ?? [];
  console.log(`[austender] ${releases.length} releases in window`);

  const seen = new Set<string>();
  const suppliers: AusTenderSupplier[] = [];

  for (const release of releases) {
    // ── Extract the best available descriptive title ─────────────────────────
    // AusTender sometimes puts the CN number in tender.title — fall through to
    // better fields in that case.
    const rawTitle = [
      release.tender?.title,
      release.tender?.description,
      release.awards?.[0]?.title,
      release.awards?.[0]?.description,
      release.contracts?.[0]?.description,
      release.tender?.items?.[0]?.classification?.description,
    ]
      .map((v) => (typeof v === "string" ? v.trim() : ""))
      .find((v) => v.length > 4 && !isContractNumber(v)) ?? "";

    // ── Build full text for relevance check (all available fields) ───────────
    const allText = [
      release.tender?.title        ?? "",
      release.tender?.description  ?? "",
      ...(release.tender?.items ?? []).map((i: any) => i.classification?.description ?? ""),
      release.awards?.[0]?.title       ?? "",
      release.awards?.[0]?.description ?? "",
      release.contracts?.[0]?.description ?? "",
    ].join(" ");

    // ── Product relevance gate ───────────────────────────────────────────────
    const relevantCategories = getRelevantProductCategories(allText);
    if (relevantCategories.length === 0) continue;

    // ── Procuring entity ─────────────────────────────────────────────────────
    const parties: any[] = release.parties ?? [];
    const procuringEntity = parties.find(
      (p: any) => Array.isArray(p.roles) && p.roles.includes("procuringEntity")
    );
    const agencyName = procuringEntity?.name ?? null;

    // ── Contract value ───────────────────────────────────────────────────────
    const contractValue =
      release.awards?.[0]?.value?.amount ??
      release.contracts?.[0]?.value?.amount ??
      null;

    // ── Contract period — check awards.contractPeriod and contracts.period ───
    const period =
      release.awards?.[0]?.contractPeriod ??
      release.contracts?.[0]?.period ??
      null;
    const periodStart = period?.startDate?.split("T")[0] ?? null;
    const periodEnd   = period?.endDate?.split("T")[0]   ?? null;

    // ── Build a readable sales-context sentence ──────────────────────────────
    // Format: "Awarded [title] by [Agency] ($X, YYYY-YYYY) — as fitout contractor
    //          they [will need our products]."
    const titlePart  = rawTitle ? `"${rawTitle}"` : "a fleet/vehicle contract";
    const agencyPart = agencyName ? ` by ${agencyName}` : "";
    const valuePart  = contractValue
      ? ` ($${Number(contractValue).toLocaleString()})`
      : "";
    const periodPart =
      periodStart && periodEnd
        ? `, ${periodStart.slice(0, 7)} – ${periodEnd.slice(0, 7)}`
        : "";

    // Use the primary matched category's sales angle
    const primaryAngle = CATEGORY_SALES_ANGLE[relevantCategories[0]] ?? "will need fleet accessories";
    const extraCategories =
      relevantCategories.length > 1
        ? ` Also relevant: ${relevantCategories.slice(1).join(", ")}.`
        : "";

    const tenderContext =
      `Awarded ${titlePart}${agencyPart}${valuePart}${periodPart}. ` +
      `As the awarded contractor they ${primaryAngle}.${extraCategories}`;

    // ── Extract suppliers ────────────────────────────────────────────────────
    for (const party of parties) {
      if (!Array.isArray(party.roles) || !party.roles.includes("supplier")) continue;

      const name = (party.name ?? "").trim();
      if (!name || name.length < 3) continue;
      if (agencyName && nameSimilarity(name, agencyName) > 0.8) continue;
      if (seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());

      const abn = party.additionalIdentifiers?.find(
        (id: any) => id.scheme === "AU-ABN"
      )?.id ?? null;

      const addr    = party.address;
      const address = addr
        ? [addr.streetAddress, addr.locality, addr.region, addr.postalCode]
            .filter(Boolean).join(", ")
        : null;
      const state = addr?.region ?? null;

      suppliers.push({ name, abn, address, state, tender_context: tenderContext });
    }
  }

  console.log(`[austender] ${suppliers.length} relevant suppliers extracted`);
  return suppliers;
}

// ─── Supabase helpers ─────────────────────────────────────────────────────────

async function isDuplicate(
  supabase: ReturnType<typeof createClient>,
  companyName: string,
  website: string | null,
  channel: Channel,
  phone?: string | null,
  placeId?: string | null,
): Promise<boolean> {
  // Hard match: Google Place ID (same physical location = same business)
  if (placeId) {
    const { data } = await supabase
      .from("sales_leads")
      .select("id")
      .eq("channel", channel)
      .eq("google_place_id", placeId)
      .limit(1);
    if (data?.length) return true;
  }

  // Hard match: website domain
  const domain = website ? extractDomain(website) : null;
  if (domain) {
    const { data } = await supabase
      .from("sales_leads")
      .select("id, company_name, website")
      .eq("channel", channel)
      .ilike("website", `%${domain}%`)
      .limit(5);
    if (data?.length) {
      for (const lead of data) {
        if (lead.website && extractDomain(lead.website) === domain) return true;
      }
    }
  }

  // Hard match: phone number (normalised digits)
  if (phone) {
    const normPhone = phone.replace(/\D/g, "");
    if (normPhone.length >= 8) {
      const { data } = await supabase
        .from("sales_leads")
        .select("id")
        .eq("channel", channel)
        .ilike("phone", `%${normPhone.slice(-8)}%`)
        .limit(1);
      if (data?.length) return true;
    }
  }

  // Fuzzy match: name similarity (first word lookup to narrow DB scan)
  const firstWord = companyName.split(" ")[0];
  if (firstWord.length >= 3) {
    const { data: leads } = await supabase
      .from("sales_leads")
      .select("id, company_name")
      .eq("channel", channel)
      .ilike("company_name", `%${firstWord}%`)
      .limit(10);

    if (leads?.length) {
      for (const lead of leads) {
        if (nameSimilarity(lead.company_name, companyName) >= 0.80) return true;
      }
    }
  }

  return false;
}

function nameSimilarity(a: string, b: string): number {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const na = norm(a);
  const nb = norm(b);
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.9;
  // Simple bigram overlap
  const bigrams = (s: string) => {
    const set = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    return set;
  };
  const bg1 = bigrams(na);
  const bg2 = bigrams(nb);
  let overlap = 0;
  for (const b of bg1) if (bg2.has(b)) overlap++;
  return (2 * overlap) / (bg1.size + bg2.size);
}

function extractDomain(url: string): string {
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

// ─── Google Custom Search API ─────────────────────────────────────────────────

async function googleSearch(query: string, cseKey: string, cseCx: string, num = 10): Promise<any[]> {
  const url = new URL(CSE_BASE);
  url.searchParams.set("q", query);
  url.searchParams.set("key", cseKey);
  url.searchParams.set("cx", cseCx);
  url.searchParams.set("num", String(Math.min(num, 10)));
  url.searchParams.set("gl", "au");
  url.searchParams.set("hl", "en");

  const res = await fetch(url.toString());
  if (!res.ok) return [];
  const data = await res.json();
  return (data.items ?? []).map((item: any) => ({
    title:          item.title,
    link:           item.link,
    snippet:        item.snippet,
    displayed_link: item.displayLink,
  }));
}

async function googleNewsSearch(query: string, cseKey: string, cseCx: string): Promise<any[]> {
  const url = new URL(CSE_BASE);
  url.searchParams.set("q", query);
  url.searchParams.set("key", cseKey);
  url.searchParams.set("cx", cseCx);
  url.searchParams.set("num", "10");
  url.searchParams.set("gl", "au");
  url.searchParams.set("sort", "date");
  url.searchParams.set("dateRestrict", "m6");

  const res = await fetch(url.toString());
  if (!res.ok) return [];
  const data = await res.json();
  // Map to match the news_results shape the rest of the function expects
  return (data.items ?? []).map((item: any) => ({
    title:   item.title,
    link:    item.link,
    snippet: item.snippet,
    source:  { name: item.displayLink },
  }));
}

async function googleMapsSearch(query: string, placesKey: string): Promise<{ results: any[]; diagnostic?: string }> {
  // Text Search returns up to 20 per page, 60 total via next_page_token.
  // Google requires a short delay (~2s) before a next_page_token becomes
  // servable, otherwise you get INVALID_REQUEST.
  const accumulated: any[] = [];
  let diagnostic: string | undefined;
  let pageToken: string | null = null;

  for (let page = 0; page < 3; page++) {
    const url = pageToken
      ? `${PLACES_BASE}/textsearch/json?pagetoken=${encodeURIComponent(pageToken)}&key=${placesKey}`
      : `${PLACES_BASE}/textsearch/json?query=${encodeURIComponent(query)}&region=au&key=${placesKey}`;

    const res = await fetch(url);
    if (!res.ok) {
      if (page === 0) diagnostic = `HTTP ${res.status}`;
      break;
    }
    const data = await res.json();

    if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
      if (page === 0) diagnostic = `Places API: ${data.status} — ${data.error_message ?? ""}`;
      break;
    }

    // Skip permanently-closed businesses up front — saves downstream work
    const liveResults = (data.results ?? []).filter(
      (p: any) => p.business_status !== "CLOSED_PERMANENTLY",
    );
    accumulated.push(...liveResults);

    pageToken = data.next_page_token ?? null;
    if (!pageToken) break;
    // Google requires a short wait before the next_page_token becomes valid
    await new Promise((r) => setTimeout(r, 2100));
  }

  return { results: accumulated, diagnostic };
}

// ─── Extract tender winner from search result snippet ────────────────────────

function extractTenderContext(snippet: string, title: string): string | null {
  const combined = `${title} ${snippet}`;
  // Look for patterns like "X awarded contract" or "X wins Y contract"
  const patterns = [
    /([A-Z][A-Za-z\s&]+(?:Pty|Ltd|Services|Solutions|Group)?)\s+(?:awarded|wins?|secures?|wins)\s+(?:a\s+)?(?:\$[\d.]+[Mm]?\s+)?(?:contract|tender)/i,
    /(?:contract|tender)\s+awarded\s+to\s+([A-Z][A-Za-z\s&]+(?:Pty|Ltd|Services|Solutions|Group)?)/i,
  ];
  for (const pat of patterns) {
    const m = combined.match(pat);
    if (m) return combined.slice(0, 300);
  }
  return null;
}

// ─── Rate limiting delay ──────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Main handler ─────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
  const cseKey    = Deno.env.get("GOOGLE_PLACES_API_KEY") ?? "";  // same GCP project key
  const cseCx     = Deno.env.get("GOOGLE_CSE_CX") ?? "";
  const placesKey = Deno.env.get("GOOGLE_PLACES_API_KEY") ?? "";

  let body: { channel?: Channel } = {};
  try { body = await req.json(); } catch { /* no body */ }

  const channels: Channel[] = body.channel ? [body.channel] : ["trailbait", "fleetcraft", "aga"];
  const results: Record<string, number> = {};

  for (const channel of channels) {
    // Create job record
    const { data: job } = await supabase
      .from("research_jobs")
      .insert({ channel, job_type: "discovery", status: "running", started_at: new Date().toISOString() })
      .select("id")
      .single();

    const jobId = job?.id;
    let found = 0;
    const errors: string[] = [];

    try {
      const queries = DISCOVERY_QUERIES[channel];

      for (const query of queries) {
        await sleep(500); // rate limit between queries

        try {
          let rawResults: any[] = [];

          // FleetCraft tender queries go through news search
          const isTenderQuery = query.includes("awarded") || query.includes("contract") || query.includes("tender");

          if (isTenderQuery && channel === "fleetcraft") {
            const newsResults = await googleNewsSearch(query, cseKey, cseCx);
            // Extract company names from news results
            for (const item of newsResults.slice(0, 8)) {
              const snippet   = item.snippet ?? "";
              const title     = item.title ?? "";
              const context   = extractTenderContext(snippet, title);
              if (!context) continue;

              // Try to extract company name — use link domain as fallback identifier
              const companyName = item.source?.name ?? extractDomain(item.link ?? "") ?? "Unknown";
              if (companyName === "Unknown" || companyName.length < 3) continue;

              const isDup = await isDuplicate(supabase, companyName, item.link ?? null, channel);
              if (isDup) continue;

              await supabase.from("sales_leads").insert({
                channel,
                company_name:     companyName,
                website:          item.link ?? null,
                discovery_source: "news_tender",
                discovery_query:  query,
                tender_context:   context,
                status:           "new",
              });
              found++;
            }
            continue;
          }

          // Maps search for most queries
          if (!isTenderQuery) {
            const { results, diagnostic } = await googleMapsSearch(query, placesKey);
            rawResults = results;
            if (diagnostic) errors.push(`[Maps] ${query}: ${diagnostic}`);
          } else {
            const webResults = await googleSearch(query, cseKey, cseCx, 10);
            rawResults = webResults.map((r: any) => ({
              name:              r.title,
              formatted_address: r.displayed_link ?? "",
              website:           r.link,
              place_id:          null,
              _from_web:         true,
            }));
          }

          // Text Search now returns up to 60 via pagination — raise the cap.
          for (const place of rawResults.slice(0, 60)) {
            const companyName = place.name ?? "";
            if (!companyName || companyName.length < 3) continue;

            // Skip the known chain HQs (TrailBait targets independents)
            if (channel === "trailbait") {
              const chains = ["ARB", "TJM", "Ironman", "Opposite Lock", "Repco", "AutoBarn", "SuperCheap", "Bapcor"];
              if (chains.some((c) => companyName.toLowerCase().includes(c.toLowerCase()))) continue;
            }

            const website = place.website ?? null;
            const isDup   = await isDuplicate(supabase, companyName, website, channel, place.formatted_phone_number ?? null, place.place_id ?? null);
            if (isDup) continue;

            const address      = place.formatted_address ?? place.vicinity ?? null;
            const stateMatch   = address?.match(/\b(NSW|VIC|QLD|SA|WA|TAS|NT|ACT)\b/)?.[1] ?? null;
            const postcodeMatch = address?.match(/\b(\d{4})\b/)?.[1] ?? null;

            await supabase.from("sales_leads").insert({
              channel,
              company_name:     companyName,
              website,
              address,
              state:            stateMatch,
              postcode:         postcodeMatch,
              google_place_id:  place.place_id ?? null,
              google_rating:    place.rating ?? null,
              google_review_count: place.user_ratings_total ?? null,
              discovery_source: place._from_web ? "web_scrape" : "google_maps",
              discovery_query:  query,
              status:           "new",
            });
            found++;
          }
        } catch (queryErr) {
          errors.push(`Query "${query}": ${queryErr}`);
        }
      }

      // ── AusTender OCDS API (fleetcraft only) ─────────────────────────────────
      if (channel === "fleetcraft") {
        try {
          const atSuppliers = await fetchAusTenderSuppliers(6);
          console.log(`[austender] ${atSuppliers.length} relevant suppliers found`);
          for (const supplier of atSuppliers) {
            const isDup = await isDuplicate(supabase, supplier.name, null, channel);
            if (isDup) continue;
            await supabase.from("sales_leads").insert({
              channel,
              company_name:     supplier.name,
              website:          null,
              address:          supplier.address,
              state:            supplier.state,
              discovery_source: "austender",
              discovery_query:  "ocds_api_contract_published",
              tender_context:   supplier.tender_context,
              status:           "new",
            });
            found++;
          }
        } catch (atErr) {
          errors.push(`[austender] ${atErr}`);
        }
      }

      // ── Market research sources (LinkedIn, Seek, Yellow Pages, news, trade dir) ──
      for (const { query, source } of MARKET_QUERIES[channel]) {
        await sleep(600);
        try {
          const webResults = await googleSearch(query, cseKey, cseCx, 10);
          for (const item of webResults.slice(0, 10)) {
            const { name: companyName, website } = extractCompanyFromMarketResult(
              { title: item.title ?? "", link: item.link ?? "", snippet: item.snippet ?? "" },
              source,
            );
            if (!companyName || companyName.length < 3) continue;
            // Skip generic / noise titles — platform names, publication mastheads
            const noiseWords = [
              "linkedin", "seek", "yellow pages", "aaaa", "tenders.gov",
              "indeed", "glassdoor", "facebook", "instagram",
              "autotalk", "tradetruck", "fleetnews", "motormag", "4wdaction",
            ];
            if (noiseWords.some((w) => companyName.toLowerCase().includes(w))) continue;

            if (channel === "trailbait") {
              const chains = ["ARB", "TJM", "Ironman", "Opposite Lock", "Repco", "AutoBarn", "SuperCheap", "Bapcor"];
              if (chains.some((c) => companyName.toLowerCase().includes(c.toLowerCase()))) continue;
            }

            const isDup = await isDuplicate(supabase, companyName, website, channel);
            if (isDup) continue;

            await supabase.from("sales_leads").insert({
              channel,
              company_name:     companyName,
              website:          website ?? null,
              discovery_source: source,
              discovery_query:  query,
              status:           "new",
            });
            found++;
          }
        } catch (queryErr) {
          errors.push(`[market:${source}] "${query}": ${queryErr}`);
        }
      }

      await supabase
        .from("research_jobs")
        .update({ status: "completed", leads_found: found, completed_at: new Date().toISOString(), error_log: errors.length ? errors.join("\n") : null })
        .eq("id", jobId);

      results[channel] = found;
    } catch (err) {
      await supabase
        .from("research_jobs")
        .update({ status: "failed", error_log: String(err), completed_at: new Date().toISOString() })
        .eq("id", jobId);
    }
  }

  return new Response(
    JSON.stringify({ ok: true, results }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
