import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PLACES_BASE = "https://maps.googleapis.com/maps/api/place";
const CIN7_BASE   = "https://inventory.dearsystems.com/ExternalApi/v2";

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

// ─── Google Places enrichment ─────────────────────────────────────────────────

async function enrichFromPlaces(placeId: string | null, companyName: string, placesKey: string) {
  let pid = placeId;

  // Find place if we don't have a place_id
  if (!pid) {
    const searchUrl = `${PLACES_BASE}/findplacefromtext/json?input=${encodeURIComponent(companyName)}&inputtype=textquery&fields=place_id&key=${placesKey}`;
    const res = await fetch(searchUrl);
    if (res.ok) {
      const data = await res.json();
      pid = data.candidates?.[0]?.place_id ?? null;
    }
  }

  if (!pid) return null;

  // Request extra Details fields that are cheap to fetch and valuable for scoring:
  //   business_status     — auto-disqualify CLOSED_PERMANENTLY
  //   types               — validates category match (car_dealer, car_repair, etc.)
  //   editorial_summary   — Google's own short description of the business
  //   price_level         — rough scale signal (0-4)
  //   geometry            — for future geo-analysis and state inference
  //   url                 — canonical Google Maps URL (useful for sales ops)
  const fields = [
    "name", "rating", "user_ratings_total", "formatted_phone_number",
    "website", "formatted_address", "opening_hours", "reviews",
    "business_status", "types", "editorial_summary", "price_level",
    "geometry", "url",
  ].join(",");
  const detailUrl = `${PLACES_BASE}/details/json?place_id=${pid}&fields=${fields}&key=${placesKey}`;
  const res = await fetch(detailUrl);
  if (!res.ok) return null;
  const data = await res.json();
  const r    = data.result;
  if (!r) return null;

  const recentReviews = (r.reviews ?? [])
    .slice(0, 5)
    .map((rv: any) => ({ text: rv.text, rating: rv.rating, time: rv.relative_time_description }));

  return {
    google_place_id:     pid,
    google_rating:       r.rating ?? null,
    google_review_count: r.user_ratings_total ?? null,
    phone:               r.formatted_phone_number ?? null,
    website:             r.website ?? null,
    address:             r.formatted_address ?? null,
    recent_reviews:      recentReviews,
    business_status:     r.business_status ?? null,
    types:               Array.isArray(r.types) ? r.types : [],
    editorial_summary:   r.editorial_summary?.overview ?? null,
    price_level:         typeof r.price_level === "number" ? r.price_level : null,
    location:            r.geometry?.location ?? null,
    maps_url:            r.url ?? null,
  };
}

// ─── Website scraping ─────────────────────────────────────────────────────────

/** Extract meaningful text from raw HTML. Pulls meta descriptions first (always
 *  server-rendered), then falls back to stripped body text. This handles JS-heavy
 *  sites (Shopify, React) where the body is mostly script tags. */
function extractText(html: string): string {
  // Pull meta description + og:description before stripping — these are always
  // present in the <head> even on Shopify/React sites.
  const metaMatches = [
    html.match(/<meta\s[^>]*name=["']description["'][^>]*content=["']([^"']{10,})["']/i),
    html.match(/<meta\s[^>]*content=["']([^"']{10,})["'][^>]*name=["']description["']/i),
    html.match(/<meta\s[^>]*property=["']og:description["'][^>]*content=["']([^"']{10,})["']/i),
    html.match(/<meta\s[^>]*content=["']([^"']{10,})["'][^>]*property=["']og:description["']/i),
    html.match(/<meta\s[^>]*name=["']twitter:description["'][^>]*content=["']([^"']{10,})["']/i),
    html.match(/<meta\s[^>]*content=["']([^"']{10,})["'][^>]*name=["']twitter:description["']/i),
  ].filter(Boolean).map((m) => m![1].trim());

  // Also extract <title>
  const titleMatch = html.match(/<title[^>]*>([^<]{3,})<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : "";

  const metaText = [...new Set([title, ...metaMatches])].filter(Boolean).join(" — ");

  // Strip scripts/styles/tags for body text
  const bodyText = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 5000);

  // Combine: meta descriptions first (most reliable), then body text
  const combined = `${metaText} ${bodyText}`.trim().slice(0, 6000);
  return combined;
}

async function fetchPage(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; AGAResearchBot/1.0)" },
    signal:  AbortSignal.timeout(8000),
  });
  if (!res.ok) return "";
  return res.text();
}

async function scrapeWebsite(url: string): Promise<{ text: string; emails: string[]; phones: string[] }> {
  try {
    const base = url.startsWith("http") ? url : `https://${url}`;
    const origin = new URL(base).origin;

    // Homepage plus a handful of high-value pages — /about, /contact and /team
    // are where most small-business sites put the owner name + direct phone/email.
    const paths = [
      "",                 // homepage
      "/about", "/about-us", "/pages/about", "/pages/about-us", "/our-story",
      "/contact", "/contact-us", "/pages/contact",
      "/team", "/our-team", "/people", "/staff",
    ];

    const texts: string[] = [];
    let primaryText = "";
    for (const path of paths) {
      try {
        const html = await fetchPage(path ? `${origin}${path}` : base);
        if (!html) continue;
        const t = extractText(html);
        if (!t) continue;
        texts.push(t);
        if (path === "" || !primaryText) primaryText = t;
        // Stop once we've accumulated enough signal — keeps total runtime bounded
        if (texts.join(" ").length >= 8000) break;
      } catch { /* skip this path */ }
    }

    // Combine all pages for contact extraction; keep the homepage/about text as
    // the "primary" body so AI summarisation stays on-topic.
    const combinedForExtraction = texts.join(" ");
    const text = primaryText || texts[0] || "";

    const emails = [...new Set((combinedForExtraction.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) ?? []))].slice(0, 5);
    const phones = [...new Set((combinedForExtraction.match(/(?:\+61|0)[2-9]\d{8}|\b1[38]\d{2}\b/g) ?? []))].slice(0, 5);

    return { text, emails, phones };
  } catch {
    return { text: "", emails: [], phones: [] };
  }
}

// ─── Wayback Machine: first-seen date ─────────────────────────────────────────
// Public CDX API, no auth. Returns the earliest archived snapshot for a domain
// so we can tell how long the company has been online — a strong credibility
// signal (established 2018 ≠ opened last month).

async function enrichFromWayback(domain: string | null): Promise<{
  first_seen: string | null;
  age_years:  number | null;
} | null> {
  if (!domain) return null;
  try {
    const url = `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(domain)}&output=json&limit=1&from=19960101&fl=timestamp&filter=statuscode:200`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = await res.json();
    // Response: [["timestamp"], ["20180315123456"]]
    const ts = Array.isArray(data) && data.length >= 2 ? data[1]?.[0] : null;
    if (!ts || typeof ts !== "string" || ts.length < 8) return null;
    const firstSeen = `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}`;
    const firstYear = Number(ts.slice(0, 4));
    const currentYear = new Date().getUTCFullYear();
    const ageYears = Number.isFinite(firstYear) ? currentYear - firstYear : null;
    return { first_seen: firstSeen, age_years: ageYears };
  } catch {
    return null;
  }
}

// ─── Google PageSpeed Insights: site health ──────────────────────────────────
// Free API — reuses the existing GOOGLE_PLACES_API_KEY (same GCP project key).
// A modern, fast, mobile-friendly site is a signal of an active business.

async function enrichFromPageSpeed(url: string | null, apiKey: string): Promise<{
  performance_score: number | null;
  seo_score:         number | null;
  mobile_friendly:   boolean | null;
} | null> {
  if (!url) return null;
  try {
    const base = url.startsWith("http") ? url : `https://${url}`;
    const params = new URLSearchParams({
      url:      base,
      strategy: "mobile",
      category: "performance",
    });
    params.append("category", "seo");
    if (apiKey) params.set("key", apiKey);
    const res = await fetch(
      `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${params}`,
      { signal: AbortSignal.timeout(20000) },
    );
    if (!res.ok) return null;
    const data = await res.json();
    const cats = data?.lighthouseResult?.categories ?? {};
    const toPct = (v: unknown) => (typeof v === "number" ? Math.round(v * 100) : null);
    return {
      performance_score: toPct(cats.performance?.score),
      seo_score:         toPct(cats.seo?.score),
      mobile_friendly:   typeof cats.performance?.score === "number" ? cats.performance.score >= 0.5 : null,
    };
  } catch {
    return null;
  }
}

// ─── Social media discovery ───────────────────────────────────────────────────

async function findSocials(companyName: string, cseKey: string, cseCx: string) {
  // Search each social platform separately so the CSE site restriction doesn't block them
  const platforms = [
    { site: "facebook.com",         key: "facebook"  },
    { site: "linkedin.com/company", key: "linkedin"  },
    { site: "instagram.com",        key: "instagram" },
  ];

  const result: Record<string, string | null> = { facebook: null, instagram: null, linkedin: null };

  for (const { site, key } of platforms) {
    const url = new URL("https://www.googleapis.com/customsearch/v1");
    url.searchParams.set("q", `"${companyName}"`);
    url.searchParams.set("key", cseKey);
    url.searchParams.set("cx", cseCx);
    url.searchParams.set("siteSearch", site);
    url.searchParams.set("siteSearchFilter", "i");
    url.searchParams.set("num", "3");
    url.searchParams.set("gl", "au");

    try {
      const res = await fetch(url.toString());
      if (!res.ok) continue;
      const data = await res.json();
      const first = data.items?.[0]?.link ?? null;
      if (first) result[key] = first;
    } catch { /* skip */ }
  }

  return result;
}

// ─── Claude Haiku: company summary & qualification signals ───────────────────

interface AIResult {
  summary: string;
  contact_name: string | null;
  contact_position: string | null;
  key_products: string[];
  website_quality: string | undefined;
  company_size: string | undefined;
  has_own_brand: boolean | undefined;
  currently_imports: boolean | undefined;
}

async function generateSummary(
  companyName: string,
  websiteUrl: string | null,
  websiteText: string,
  reviewsText: string,
  existingKeyProducts: string[],
  channel: string,
  anthropicKey: string,
): Promise<AIResult> {
  const empty: AIResult = {
    summary: "", contact_name: null, contact_position: null, key_products: [],
    website_quality: undefined, company_size: undefined, has_own_brand: undefined, currently_imports: undefined,
  };
  if (!anthropicKey) return empty;

  const channelContext: Record<string, string> = {
    trailbait:  "4x4/4WD accessories retail",
    fleetcraft: "fleet vehicle fitout and upfitting",
    aga:        "automotive brand/OEM manufacturing",
  };

  // Build context from whatever signals we have
  const contextParts: string[] = [];
  if (websiteUrl) contextParts.push(`Website: ${websiteUrl}`);
  if (websiteText.length > 20) contextParts.push(`Website content (truncated):\n${websiteText.slice(0, 2500)}`);
  if (reviewsText) contextParts.push(`Google Reviews:\n${reviewsText}`);
  if (existingKeyProducts.length) contextParts.push(`Known products/services: ${existingKeyProducts.join(", ")}`);
  // Always have at least the company name — Claude can infer industry from name + URL
  const contextBlock = contextParts.length ? contextParts.join("\n\n") : "(No additional data available — infer from company name and website URL only)";

  const prompt = `You are analysing a company for sales lead qualification in ${channelContext[channel] ?? "automotive"}.

Company: ${companyName}

${contextBlock}

Return a JSON object with these exact fields (use null/false/unknown when genuinely uncertain — do not hallucinate):
- "summary": 1-2 sentence description of what the business does and who they serve. If data is very limited, base it on the company name and website URL only.
- "contact_name": Most senior person's full name found in the text, or null
- "contact_position": Their job title, or null
- "key_products": Array of up to 5 key products or services (empty array if unknown)
- "website_quality": "products" (has product listings/store), "basic" (informational only), or "none" (no site or error page)
- "company_size": "large" (50+ employees or multiple locations), "medium" (10-50 employees), "small" (<10 employees), or "unknown"
- "has_own_brand": true if they sell under their own brand name, false if they only resell others, null if truly unclear
- "currently_imports": true if evidence of importing from overseas, false if purely local, null if unclear

Respond with ONLY a valid JSON object. No markdown, no code fences, no explanation.`;

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
        model:      "claude-haiku-4-5-20251001",
        max_tokens: 600,
        messages:   [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) {
      console.warn(`[ai] generateSummary failed: HTTP ${res.status}`);
      return empty;
    }

    const data = await res.json();
    // Strip markdown code fences Claude sometimes adds despite instructions
    const rawText = (data.content?.[0]?.text ?? "").trim();
    const jsonText = rawText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
    const parsed = JSON.parse(jsonText || "{}");
    return {
      summary:           parsed.summary ?? "",
      contact_name:      parsed.contact_name ?? null,
      contact_position:  parsed.contact_position ?? null,
      key_products:      Array.isArray(parsed.key_products) ? parsed.key_products : [],
      website_quality:   typeof parsed.website_quality === "string" ? parsed.website_quality : undefined,
      company_size:      typeof parsed.company_size === "string" ? parsed.company_size : undefined,
      has_own_brand:     typeof parsed.has_own_brand === "boolean" ? parsed.has_own_brand : undefined,
      currently_imports: typeof parsed.currently_imports === "boolean" ? parsed.currently_imports : undefined,
    };
  } catch (err) {
    console.warn("[ai] generateSummary parse error:", err);
    return empty;
  }
}

// ─── Lusha contact enrichment ────────────────────────────────────────────────
// Docs: https://docs.lusha.com
// Auth: api_key header (not Bearer)
// Person lookup:  GET  /v2/person?firstName=...&lastName=...&companyName=...
// Contact search: POST /prospecting/contact/search → POST /prospecting/contact/enrich

const LUSHA_BASE = "https://api.lusha.com";

function lushaHeaders(key: string): Record<string, string> {
  return { "api_key": key, "Content-Type": "application/json" };
}

function parsePhone(phones: any[]): string | null {
  if (!phones?.length) return null;
  // phoneType values from Lusha: "Mobile", "Direct", "Phone" (capitalized)
  const mobile = phones.find((p: any) => p.phoneType?.toLowerCase() === "mobile" || p.type?.toLowerCase() === "mobile");
  const direct = phones.find((p: any) => p.phoneType?.toLowerCase() === "direct" || p.type?.toLowerCase() === "direct");
  const first  = phones[0];
  const raw = (mobile ?? direct ?? first)?.number ?? (mobile ?? direct ?? first)?.sanitizedNumber ?? null;
  return raw ?? null;
}

function parseEmail(emails: any[]): string | null {
  if (!emails?.length) return null;
  // Prefer work email
  const work = emails.find((e: any) => e.emailType === "work" || e.type === "work");
  return work?.email ?? emails[0]?.email ?? (typeof emails[0] === "string" ? emails[0] : null);
}

async function enrichFromLusha(
  domain: string | null,
  companyName: string,
  contactName: string | null,
  lushaKey: string,
): Promise<{ contact_name: string | null; contact_position: string | null; phone: string | null; email: string | null; linkedin: string | null } | null> {
  if (!lushaKey) return null;

  const hdrs = lushaHeaders(lushaKey);

  // ── Path A: we have a name → GET /v2/person ──────────────────────────────
  if (contactName && (domain || companyName)) {
    const parts     = contactName.trim().split(/\s+/);
    const firstName = parts[0] ?? "";
    const lastName  = parts.slice(1).join(" ");

    const params = new URLSearchParams();
    if (firstName)   params.set("firstName",     firstName);
    if (lastName)    params.set("lastName",      lastName);
    if (companyName) params.set("companyName",   companyName);
    if (domain)      params.set("companyDomain", domain);    // confirmed Lusha param name

    try {
      const res = await fetch(`${LUSHA_BASE}/v2/person?${params}`, {
        headers: hdrs,
        signal:  AbortSignal.timeout(8000),
      });

      if (res.ok) {
        const data   = await res.json();
        // GET /v2/person response: { contact: { data: { fullName, firstName, ... } } }
        const person = data?.contact?.data;
        if (person?.fullName || person?.firstName) {
          return {
            contact_name:     (person.fullName ?? `${person.firstName ?? ""} ${person.lastName ?? ""}`.trim()) || null,
            contact_position: person.jobTitle?.title ?? person.jobTitle ?? null,
            phone:            parsePhone(person.phoneNumbers ?? person.phones ?? []),
            email:            parseEmail(person.emailAddresses ?? person.emails ?? []),
            linkedin:         person.linkedinUrl ?? null,
          };
        }
      } else {
        console.warn(`[lusha] GET /v2/person → ${res.status} for ${companyName}`);
      }
    } catch (err) {
      console.warn("[lusha] person lookup error:", err);
    }
  }

  // ── Path B: no name → POST /prospecting/contact/search then /enrich ──────
  if (!domain) return null;

  try {
    const searchRes = await fetch(`${LUSHA_BASE}/prospecting/contact/search`, {
      method:  "POST",
      headers: hdrs,
      signal:  AbortSignal.timeout(10000),
      body: JSON.stringify({
        pages: { page: 0, size: 5 },
        includePartialContact: true,
        excludeDnc: true,
        filters: {
          contacts: {
            include: {
              seniority: [1, 2, 3, 4],          // senior levels — exact IDs from /prospecting/filters/contacts/seniority
              existing_data_points: ["phone"],   // only contacts Lusha has phone data for
            },
          },
          companies: {
            include: {
              domains: [domain],                 // confirmed field name from Lusha docs
            },
          },
        },
      }),
    });

    if (!searchRes.ok) {
      console.warn(`[lusha] POST /prospecting/contact/search → ${searchRes.status} for ${domain}`);
      return null;
    }

    const searchData = await searchRes.json();
    const requestId  = searchData?.requestId;
    const contacts: any[] = searchData?.contacts ?? [];

    if (!contacts.length) return null;
    const first = contacts[0];

    // Always enrich to get phone/email — search only returns metadata
    // Search response uses `contactId` (string UUID), not `id`
    if (!requestId || !first?.contactId) return null;

    await sleep(200);
    const enrichRes = await fetch(`${LUSHA_BASE}/prospecting/contact/enrich`, {
      method:  "POST",
      headers: hdrs,
      signal:  AbortSignal.timeout(10000),
      body: JSON.stringify({
        requestId,
        contactIds:   [first.contactId],
        revealPhones: true,
        revealEmails: true,
      }),
    });

    if (!enrichRes.ok) {
      console.warn(`[lusha] POST /prospecting/contact/enrich → ${enrichRes.status}`);
      return null;
    }

    const enrichData = await enrichRes.json();
    const enriched   = (enrichData?.contacts ?? [])[0];
    if (!enriched) return null;

    return {
      contact_name:     enriched.name ?? first.name ?? null,
      contact_position: enriched.jobTitle ?? first.jobTitle ?? null,
      phone:            parsePhone(enriched.phoneNumbers ?? enriched.phones ?? []),
      email:            parseEmail(enriched.emailAddresses ?? enriched.emails ?? []),
      linkedin:         enriched.linkedinUrl ?? first.linkedinUrl ?? null,
    };
  } catch (err) {
    console.warn("[lusha] prospecting search error:", err);
  }

  return null;
}

// ─── Cin7 customer cross-reference ───────────────────────────────────────────

async function findCin7Customer(
  companyName: string,
  cin7AccountId: string,
  cin7ApiKey: string
): Promise<{ id: string; tag: string } | null> {
  const headers = {
    "api-auth-accountid":      cin7AccountId,
    "api-auth-applicationkey": cin7ApiKey,
    "Content-Type":            "application/json",
  };

  const res = await fetch(
    `${CIN7_BASE}/customer?Name=${encodeURIComponent(companyName)}&Limit=5`,
    { headers }
  );
  if (!res.ok) return null;

  const data        = await res.json();
  const customers   = data?.CustomerList ?? [];
  if (!customers.length) return null;

  // Match on name similarity
  const target = companyName.toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const c of customers) {
    const name = (c.Name ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
    if (name === target || name.includes(target) || target.includes(name)) {
      // Tags: D = TrailBait, F = FleetCraft, A = AGA
      const tags  = (c.Tags ?? "").split(",").map((t: string) => t.trim());
      const tag   = tags.find((t: string) => ["D","F","A"].includes(t)) ?? tags[0] ?? "";
      return { id: c.ID ?? c.CustomerID, tag };
    }
  }
  return null;
}

// ─── Main handler ─────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
  const placesKey = Deno.env.get("GOOGLE_PLACES_API_KEY") ?? "";
  const cseKey    = Deno.env.get("GOOGLE_PLACES_API_KEY") ?? "";  // same GCP project key
  const cseCx     = Deno.env.get("GOOGLE_CSE_CX") ?? "";
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
  const apolloKey    = Deno.env.get("APOLLO_API_KEY") ?? "";
  const lushaKey     = Deno.env.get("LUSHA_API_KEY") ?? "";
  const cin7Account  = Deno.env.get("CIN7_ACCOUNT_ID") ?? "";
  const cin7Key      = Deno.env.get("CIN7_API_KEY") ?? "";

  let body: { action?: string; lead_id?: string; channel?: string } = {};
  try { body = await req.json(); } catch { /* no body */ }

  // ── On-demand phone reveal (Lusha primary, Apollo fallback) ──────────────
  if (body.action === "reveal_phone" && body.lead_id) {
    const { data: lead } = await supabase.from("sales_leads").select("*").eq("id", body.lead_id).single();
    if (!lead) {
      return new Response(JSON.stringify({ error: "Lead not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let domain: string | null = null;
    try {
      if (lead.website) domain = new URL(lead.website.startsWith("http") ? lead.website : `https://${lead.website}`).hostname.replace(/^www\./, "");
    } catch { /* ignore */ }

    // 1. Try Lusha first
    if (lushaKey) {
      try {
        const lusha = await enrichFromLusha(domain, lead.company_name, lead.recommended_contact_name, lushaKey);
        if (lusha?.phone) {
          await supabase.from("sales_leads").update({ phone: lusha.phone }).eq("id", body.lead_id);
          return new Response(JSON.stringify({ ok: true, phone: lusha.phone, source: "lusha" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
      } catch { /* fall through to Apollo */ }
    }

    // 2. Apollo fallback
    if (!apolloKey) {
      return new Response(JSON.stringify({ ok: true, phone: null, source: "none" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const nameParts = (lead.recommended_contact_name ?? "").trim().split(" ");
    const matchPayload: Record<string, any> = { organization_name: lead.company_name, reveal_phone_number: true };
    if (nameParts[0]) matchPayload.first_name = nameParts[0];
    if (nameParts[1]) matchPayload.last_name  = nameParts.slice(1).join(" ");
    if (domain)        matchPayload.domain    = domain;

    try {
      const res = await fetch("https://api.apollo.io/v1/people/match", {
        method:  "POST",
        headers: { "Content-Type": "application/json", "X-Api-Key": apolloKey },
        body:    JSON.stringify(matchPayload),
      });
      const data   = res.ok ? await res.json() : {};
      const person = data.person;
      const phones: any[] = person?.phone_numbers ?? [];
      const phone =
        phones.find((p: any) => p.type === "mobile")?.sanitized_number ??
        phones.find((p: any) => p.type === "direct_phone")?.sanitized_number ??
        phones[0]?.sanitized_number ?? null;
      if (phone) await supabase.from("sales_leads").update({ phone }).eq("id", body.lead_id);
      return new Response(JSON.stringify({ ok: true, phone, source: "apollo", found: !!person }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    } catch (err) {
      return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
  }

  // Build query for leads to enrich — prioritise unprocessed (new/queued) over retries (researched)
  let query = supabase
    .from("sales_leads")
    .select("*")
    .in("status", ["new", "queued"])
    .order("created_at", { ascending: true })
    .limit(50);

  if (body.lead_id) query = supabase.from("sales_leads").select("*").eq("id", body.lead_id);
  else if (body.channel) query = query.eq("channel", body.channel);

  const { data: leads, error } = await query;
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const channelJobMap: Record<string, string> = {};

  // Create job records per channel
  const channelSet = new Set((leads ?? []).map((l: any) => l.channel));
  for (const ch of channelSet) {
    const { data: job } = await supabase
      .from("research_jobs")
      .insert({ channel: ch, job_type: "enrichment", status: "running", started_at: new Date().toISOString() })
      .select("id").single();
    channelJobMap[ch as string] = job?.id;
  }

  let enrichedCount = 0;

  for (const lead of leads ?? []) {
    await sleep(300); // reduced from 800ms — external API rate limits are per-key, not per-lead

    try {
      const updates: Record<string, any> = {};

      // 1. Google Places
      const places = await enrichFromPlaces(lead.google_place_id, lead.company_name, placesKey);
      let recentReviewsText = "";
      if (places) {
        // Auto-disqualify permanently-closed businesses — no point enriching further
        if (places.business_status === "CLOSED_PERMANENTLY") {
          await supabase.from("sales_leads").update({
            status:                  "disqualified",
            disqualification_reason: "permanently closed (Google)",
            google_place_id:         places.google_place_id,
          }).eq("id", lead.id);
          enrichedCount++;
          continue;
        }

        if (places.google_rating)       updates.google_rating       = places.google_rating;
        if (places.google_review_count) updates.google_review_count = places.google_review_count;
        if (places.phone && !lead.phone) updates.phone = places.phone;
        if (places.website && !lead.website) updates.website = places.website;
        if (places.address && !lead.address) updates.address = places.address;
        if (places.google_place_id)     updates.google_place_id     = places.google_place_id;

        // Stash the new signals into score_breakdown so scoring can use them
        const sbPlaces: Record<string, any> = { ...(lead.score_breakdown ?? {}) };
        if (places.business_status)     sbPlaces.places_business_status = places.business_status;
        if (places.types?.length)       sbPlaces.places_types           = places.types;
        if (places.editorial_summary)   sbPlaces.places_summary         = places.editorial_summary;
        if (places.price_level !== null) sbPlaces.places_price_level    = places.price_level;
        if (places.location)            sbPlaces.places_location        = places.location;
        if (places.maps_url)            sbPlaces.places_maps_url        = places.maps_url;
        updates.score_breakdown = sbPlaces;
        // Compile review text for AI context
        if (places.recent_reviews?.length) {
          recentReviewsText = (places.recent_reviews as any[])
            .filter((r: any) => r.text?.length > 10)
            .map((r: any) => r.text)
            .join(" | ")
            .slice(0, 800);
        }
      }

      // 2. Website scrape (now includes /contact and /team pages)
      const websiteUrl = updates.website ?? lead.website;
      let websiteText  = "";
      let websiteDomain: string | null = null;
      if (websiteUrl) {
        try {
          websiteDomain = new URL(
            websiteUrl.startsWith("http") ? websiteUrl : `https://${websiteUrl}`,
          ).hostname.replace(/^www\./, "");
        } catch { /* ignore */ }

        const scraped = await scrapeWebsite(websiteUrl);
        websiteText   = scraped.text;
        if (scraped.emails.length && !lead.email) updates.email = scraped.emails[0];
        if (scraped.phones.length && !lead.phone) updates.phone = scraped.phones[0];
      }

      // 2a. Wayback Machine + PageSpeed Insights — run in parallel, both cheap
      // and both stash results into score_breakdown (no schema changes needed).
      if (websiteUrl) {
        const [wayback, pagespeed] = await Promise.all([
          enrichFromWayback(websiteDomain),
          enrichFromPageSpeed(websiteUrl, placesKey),
        ]);
        const sbEnrich: Record<string, any> = { ...(updates.score_breakdown ?? lead.score_breakdown ?? {}) };
        if (wayback?.first_seen) sbEnrich.website_first_seen = wayback.first_seen;
        if (wayback?.age_years !== null && wayback?.age_years !== undefined) sbEnrich.website_age_years = wayback.age_years;
        if (pagespeed?.performance_score !== null && pagespeed?.performance_score !== undefined) sbEnrich.website_performance = pagespeed.performance_score;
        if (pagespeed?.seo_score !== null && pagespeed?.seo_score !== undefined) sbEnrich.website_seo = pagespeed.seo_score;
        if (pagespeed?.mobile_friendly !== null && pagespeed?.mobile_friendly !== undefined) sbEnrich.website_mobile_friendly = pagespeed.mobile_friendly;
        updates.score_breakdown = sbEnrich;
      }

      // 3. AI summary — always run if we have an API key; pass all available context.
      // Even when website scraping fails, company name + URL + reviews give Claude enough signal.
      if (anthropicKey) {
        const existingProducts = lead.key_products_services ?? [];
        const ai = await generateSummary(
          lead.company_name,
          websiteUrl ?? null,
          websiteText,
          recentReviewsText,
          existingProducts,
          lead.channel,
          anthropicKey,
        );
        if (ai.summary) updates.website_summary = ai.summary;
        if (ai.key_products?.length) updates.key_products_services = ai.key_products;

        // Merge AI signals into score_breakdown — start from whatever step 2a
        // (Wayback / PageSpeed) already put into updates, falling back to the
        // DB row if this is the first write this enrichment pass.
        const sbUpdate: Record<string, any> = { ...(updates.score_breakdown ?? lead.score_breakdown ?? {}) };
        if (ai.website_quality !== undefined) sbUpdate.website_quality   = ai.website_quality;
        if (ai.company_size    !== undefined) sbUpdate.company_size      = ai.company_size;
        if (ai.has_own_brand   !== undefined) sbUpdate.has_own_brand     = ai.has_own_brand;
        if (ai.currently_imports !== undefined) sbUpdate.currently_imports = ai.currently_imports;
        updates.score_breakdown = sbUpdate;

        // ── AGA hard gate: must have own brand ──────────────────────────────
        if (lead.channel === "aga" && ai.has_own_brand === false) {
          await supabase.from("sales_leads").update({
            status:                  "disqualified",
            disqualification_reason: "no own brand",
            score_breakdown:         sbUpdate,
          }).eq("id", lead.id);
          enrichedCount++;
          continue;
        }

        // Store homepage contact as fallback — only used if Lusha/Apollo (step 4) finds nothing
        if (ai.contact_name) {
          updates._homepage_contact_name     = ai.contact_name;
          updates._homepage_contact_position = ai.contact_position ?? null;
        }
      }

      // 4. Contact enrichment — Lusha primary, Apollo fallback, website homepage last resort
      {
        const websiteUrl = updates.website ?? lead.website ?? "";
        let domain: string | null = null;
        try {
          domain = new URL(websiteUrl.startsWith("http") ? websiteUrl : `https://${websiteUrl}`)
            .hostname.replace(/^www\./, "");
        } catch { /* skip */ }

        let contactFound = false;

        // 4a. Lusha (primary)
        if (lushaKey && domain) {
          try {
            await sleep(200);
            const lusha = await enrichFromLusha(domain, lead.company_name, updates._homepage_contact_name ?? lead.recommended_contact_name ?? null, lushaKey);
            if (lusha) {
              if (lusha.contact_name) {
                updates.recommended_contact_name     = lusha.contact_name;
                updates.recommended_contact_position = lusha.contact_position ?? null;
                updates.recommended_contact_source   = "lusha";
                contactFound = true;
              }
              if (lusha.phone && !lead.phone) updates.phone = lusha.phone;
              if (lusha.email && !lead.email) updates.email = lusha.email;
              if (lusha.linkedin && !lead.social_linkedin) updates.social_linkedin = lusha.linkedin;
            }
          } catch (err) {
            console.warn("Lusha search failed for", lead.company_name, err);
          }
        }

        // 4b. Apollo fallback
        if (!contactFound && apolloKey && domain) {
          try {
            await sleep(200);
            const apolloRes = await fetch("https://api.apollo.io/v1/people/search", {
              method:  "POST",
              headers: { "Content-Type": "application/json", "X-Api-Key": apolloKey },
              signal:  AbortSignal.timeout(8000),
              body:    JSON.stringify({
                organization_domains: [domain],
                person_seniorities:   ["owner", "founder", "c_suite", "vp", "director", "manager"],
                per_page: 5,
              }),
            });
            if (apolloRes.ok) {
              const apolloData = await apolloRes.json();
              const person     = apolloData.people?.[0];
              if (person) {
                const fullName = `${person.first_name ?? ""} ${person.last_name ?? ""}`.trim();
                if (fullName) {
                  updates.recommended_contact_name     = fullName;
                  updates.recommended_contact_position = person.title ?? null;
                  updates.recommended_contact_source   = "apollo";
                  contactFound = true;
                }
                if (person.linkedin_url && !lead.social_linkedin) updates.social_linkedin = person.linkedin_url;
              } else {
                // Apollo fallback by company name
                await sleep(200);
                const nameRes = await fetch("https://api.apollo.io/v1/people/search", {
                  method:  "POST",
                  headers: { "Content-Type": "application/json", "X-Api-Key": apolloKey },
                  signal:  AbortSignal.timeout(8000),
                  body:    JSON.stringify({
                    q_organization_name: lead.company_name,
                    person_seniorities:  ["owner", "founder", "c_suite", "vp", "director", "manager"],
                    per_page: 3,
                  }),
                });
                if (nameRes.ok) {
                  const nameData = await nameRes.json();
                  const p        = nameData.people?.[0];
                  if (p) {
                    const fullName = `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim();
                    if (fullName) {
                      updates.recommended_contact_name     = fullName;
                      updates.recommended_contact_position = p.title ?? null;
                      updates.recommended_contact_source   = "apollo";
                      contactFound = true;
                    }
                  }
                }
              }
            }
          } catch (err) {
            console.warn("Apollo search failed for", lead.company_name, err);
          }
        }

        // 4c. Website homepage last resort
        if (!contactFound && !lead.recommended_contact_name && updates._homepage_contact_name) {
          updates.recommended_contact_name     = updates._homepage_contact_name;
          updates.recommended_contact_position = updates._homepage_contact_position ?? null;
          updates.recommended_contact_source   = "website";
        }
        delete updates._homepage_contact_name;
        delete updates._homepage_contact_position;
      }

      // 5. Social media
      if (cseKey && cseCx) {
        await sleep(200);
        const socials = await findSocials(lead.company_name, cseKey, cseCx);
        if (socials.facebook)  updates.social_facebook  = socials.facebook;
        if (socials.instagram) updates.social_instagram = socials.instagram;
        if (socials.linkedin && !updates.social_linkedin) updates.social_linkedin = socials.linkedin;
      }

      // 6. Cin7 cross-reference
      if (cin7Account && cin7Key) {
        const cin7 = await findCin7Customer(lead.company_name, cin7Account, cin7Key);
        if (cin7) {
          updates.cin7_customer_id   = cin7.id;
          updates.cin7_customer_tag  = cin7.tag;
          updates.is_existing_customer = true;
        }
      }

      updates.status = "enriched";

      await supabase.from("sales_leads").update(updates).eq("id", lead.id);
      enrichedCount++;
    } catch (err) {
      console.error(`Enrichment error for lead ${lead.id}:`, err);
      // Don't fail the whole job — skip and continue
    }
  }

  // Update job records
  for (const [ch, jobId] of Object.entries(channelJobMap)) {
    await supabase.from("research_jobs").update({
      status: "completed",
      leads_enriched: enrichedCount,
      completed_at: new Date().toISOString(),
    }).eq("id", jobId);
  }

  return new Response(
    JSON.stringify({ ok: true, enriched: enrichedCount }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
