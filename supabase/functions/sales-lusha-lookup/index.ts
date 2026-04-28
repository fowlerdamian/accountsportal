import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ─── Result shapes ────────────────────────────────────────────────────────────

interface ContactResult {
  phone:       string | null;
  email:       string | null;
  linkedinUrl: string | null;
  source:      string;
}

interface CompanyResult {
  industry:      string | null;
  employeeCount: number | null;
  foundedYear:   number | null;
  description:   string | null;
  techStack:     string[] | null;
  annualRevenue: string | null;
  source:        string;
}

interface HunterResult {
  email:    string | null;
  pattern:  string | null;
  contacts: Array<{ name: string; email: string; position: string | null; confidence: number }>;
}

interface ScrapeResult {
  emails: string[];
  phones: string[];
  abn:    string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getDomain(website: string | null): string | null {
  if (!website) return null;
  try {
    return new URL(website.startsWith("http") ? website : `https://${website}`)
      .hostname.replace(/^www\./, "");
  } catch { return null; }
}

function isPersonalLinkedIn(url: string | null): boolean {
  return !!url && /linkedin\.com\/in\//i.test(url);
}

function dedup(arr: string[]): string[] {
  return [...new Set(arr.map(s => s.toLowerCase().trim()))];
}

// ─── 1a. Lusha locate — finds the person, returns contactId (no credit spent) ─

async function tryLushaLocate(
  firstName: string,
  lastName: string | null,
  companyName: string,
  domain: string | null,
  apiKey: string,
): Promise<{ contactId: string; email: string | null } | null> {
  const params = new URLSearchParams({ firstName });
  if (lastName)    params.set("lastName",      lastName);
  if (companyName) params.set("companyName",   companyName);
  if (domain)      params.set("companyDomain", domain);

  try {
    const res = await fetch(`https://api.lusha.com/v2/person?${params}`, {
      headers: { "api_key": apiKey, "Accept": "application/json" },
      signal:  AbortSignal.timeout(8000),
    });
    if (!res.ok) { console.warn("[lusha] locate error:", res.status); return null; }

    const result = await res.json();
    // contactId is returned in the locate response before reveal
    const contactId: string | null =
      result?.contactId ??
      result?.contact?.id ??
      result?.data?.id ??
      null;

    if (!contactId) return null;

    // Email may be returned without a credit; phone is not extracted here
    const emails: any[] = result?.contact?.data?.emailAddresses ?? result?.data?.emailAddresses ?? [];
    const email = emails[0]?.emailAddress ?? null;

    return { contactId, email };
  } catch (e) {
    console.error("[lusha] locate failed:", e);
    return null;
  }
}

// ─── 1b. Lusha reveal — spends a credit, returns phone number ────────────────

async function tryLushaReveal(
  contactId: string,
  apiKey: string,
): Promise<string | null> {
  try {
    const res = await fetch(`https://api.lusha.com/v2/person/reveal`, {
      method:  "POST",
      headers: { "api_key": apiKey, "Content-Type": "application/json", "Accept": "application/json" },
      signal:  AbortSignal.timeout(8000),
      body:    JSON.stringify({ contactId }),
    });
    if (!res.ok) { console.warn("[lusha] reveal error:", res.status); return null; }

    const result = await res.json();
    const person = result?.contact?.data ?? result?.data ?? {};
    const phones: any[] = person?.phoneNumbers ?? [];

    const isMobile = (p: any) => (p.phoneType ?? p.type)?.toLowerCase() === "mobile";
    const isDirect = (p: any) => (p.phoneType ?? p.type)?.toLowerCase() === "direct";

    return (
      phones.find(isMobile)?.internationalNumber ??
      phones.find(isMobile)?.localNumber ??
      phones.find(isDirect)?.internationalNumber ??
      phones.find(isDirect)?.localNumber ??
      phones[0]?.internationalNumber ??
      phones[0]?.localNumber ??
      null
    );
  } catch (e) {
    console.error("[lusha] reveal failed:", e);
    return null;
  }
}

// ─── 2. Apollo /v1/people/match ──────────────────────────────────────────────

async function tryApollo(
  firstName: string,
  lastName: string | null,
  companyName: string,
  domain: string | null,
  apiKey: string,
): Promise<ContactResult | null> {
  const payload: Record<string, any> = {
    organization_name:   companyName,
    reveal_phone_number: true,
    first_name:          firstName,
  };
  if (lastName) payload.last_name = lastName;
  if (domain)   payload.domain    = domain;

  const res = await fetch("https://api.apollo.io/v1/people/match", {
    method:  "POST",
    headers: { "Content-Type": "application/json", "X-Api-Key": apiKey },
    signal:  AbortSignal.timeout(8000),
    body:    JSON.stringify(payload),
  });
  if (!res.ok) { console.warn("[apollo] error:", res.status); return null; }

  const data   = await res.json();
  const person = data?.person ?? {};
  const phones: any[] = person?.phone_numbers ?? [];

  const phone =
    phones.find((p: any) => p.type === "mobile")?.sanitized_number ??
    phones.find((p: any) => p.type === "direct_phone")?.sanitized_number ??
    phones[0]?.sanitized_number ??
    null;

  const email      = person?.email ?? null;
  const linkedinUrl = isPersonalLinkedIn(person?.linkedin_url) ? person.linkedin_url : null;
  return (phone || email) ? { phone, email, linkedinUrl, source: "apollo" } : null;
}

// ─── 3. PDL /v5/person/enrich ────────────────────────────────────────────────

async function tryPDL(
  firstName: string,
  lastName: string | null,
  companyName: string,
  domain: string | null,
  existingLinkedIn: string | null,
  apiKey: string,
): Promise<ContactResult | null> {
  const params = new URLSearchParams({ min_likelihood: "3" });
  params.set("name", [firstName, lastName].filter(Boolean).join(" "));
  if (companyName) params.set("company", companyName);
  if (domain)      params.set("location", domain);
  if (isPersonalLinkedIn(existingLinkedIn)) params.set("profile", existingLinkedIn!);

  const res = await fetch(`https://api.peopledatalabs.com/v5/person/enrich?${params}`, {
    headers: { "X-Api-Key": apiKey, "Accept": "application/json" },
    signal:  AbortSignal.timeout(10000),
  });
  if (res.status === 404) return null;
  if (!res.ok) { console.warn("[pdl] error:", res.status); return null; }

  const data   = await res.json();
  const person = data?.data ?? {};
  const phone  = person.mobile_phone ?? person.phone_numbers?.[0] ?? null;
  const email  = person.personal_emails?.[0] ?? person.work_emails?.[0] ?? person.emails?.[0]?.address ?? null;
  const linkedinUrl = isPersonalLinkedIn(person.linkedin_url) ? person.linkedin_url : null;
  return (phone || email || linkedinUrl) ? { phone, email, linkedinUrl, source: "pdl" } : null;
}

// ─── 4. Hunter.io /v2/domain-search ──────────────────────────────────────────

async function tryHunter(domain: string, apiKey: string): Promise<HunterResult | null> {
  const params = new URLSearchParams({ domain, api_key: apiKey, limit: "10" });
  const res = await fetch(`https://api.hunter.io/v2/domain-search?${params}`, {
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) { console.warn("[hunter] error:", res.status); return null; }

  const data    = await res.json();
  const d       = data?.data ?? {};
  const emails: any[] = d.emails ?? [];

  const generic = /^(info|contact|sales|admin|support|hello|team|office|accounts|hr|enquir|noreply|no-reply)@/i;
  const personal = emails.find(e => e.confidence >= 70 && !generic.test(e.value));
  const best     = personal ?? emails.find(e => !generic.test(e.value)) ?? emails[0];

  const contacts = emails
    .filter(e => (e.first_name || e.last_name) && e.confidence >= 50)
    .slice(0, 6)
    .map(e => ({
      name:       [e.first_name, e.last_name].filter(Boolean).join(" "),
      email:      e.value,
      position:   e.position ?? null,
      confidence: e.confidence ?? 0,
    }));

  return { email: best?.value ?? null, pattern: d.pattern ?? null, contacts };
}

// ─── 5. Apollo /v1/organizations/enrich ──────────────────────────────────────

async function tryApolloCompany(domain: string, apiKey: string): Promise<CompanyResult | null> {
  const res = await fetch(`https://api.apollo.io/v1/organizations/enrich?domain=${domain}`, {
    headers: { "Content-Type": "application/json", "X-Api-Key": apiKey },
    signal:  AbortSignal.timeout(8000),
  });
  if (!res.ok) { console.warn("[apollo-company] error:", res.status); return null; }

  const data = await res.json();
  const org  = data?.organization ?? {};

  const techStack = Array.isArray(org.technologies)
    ? org.technologies.map((t: any) => (typeof t === "string" ? t : t.name ?? t.uid)).filter(Boolean).slice(0, 20)
    : null;

  return {
    industry:      org.industry ?? null,
    employeeCount: org.estimated_num_employees ?? org.employee_count ?? null,
    foundedYear:   org.founded_year ?? null,
    description:   org.short_description ?? null,
    techStack,
    annualRevenue: org.annual_revenue_printed ?? null,
    source:        "apollo",
  };
}

// ─── 6. PDL /v5/company/enrich ───────────────────────────────────────────────

async function tryPDLCompany(domain: string, name: string, apiKey: string): Promise<CompanyResult | null> {
  const params = new URLSearchParams({ website: `https://${domain}`, name });
  const res = await fetch(`https://api.peopledatalabs.com/v5/company/enrich?${params}`, {
    headers: { "X-Api-Key": apiKey, "Accept": "application/json" },
    signal:  AbortSignal.timeout(8000),
  });
  if (res.status === 404) return null;
  if (!res.ok) { console.warn("[pdl-company] error:", res.status); return null; }

  const data = await res.json();
  const co   = data?.data ?? {};

  const techStack = Array.isArray(co.tech) ? co.tech.slice(0, 20) : null;

  return {
    industry:      co.industry ?? null,
    employeeCount: co.employee_count ?? null,
    foundedYear:   co.founded ?? null,
    description:   co.summary ?? null,
    techStack,
    annualRevenue: null,
    source:        "pdl",
  };
}

// ─── 7. Website contact scraper ───────────────────────────────────────────────

async function tryScrapeWebsite(websiteUrl: string): Promise<ScrapeResult | null> {
  const base     = websiteUrl.startsWith("http") ? websiteUrl : `https://${websiteUrl}`;
  const pagesToTry = [base, `${base}/contact`, `${base}/contact-us`, `${base}/about`];

  const allEmails: string[] = [];
  const allPhones: string[] = [];
  let abn: string | null = null;

  // AU phone patterns: mobile 04xx, landline (0x) xxxx xxxx, 1300/1800
  const phoneRe = /(?:\+61\s*)?(?:0[2-578]|\(0[2-578]\))\s*\d{4}\s*\d{4}|0[45]\d{2}[\s\-]?\d{3}[\s\-]?\d{3}|1[38]00[\s\-]?\d{3}[\s\-]?\d{3}/g;
  const emailRe = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
  const abnRe   = /ABN[:\s]*(\d{2}\s?\d{3}\s?\d{3}\s?\d{3})/gi;

  for (const url of pagesToTry.slice(0, 3)) {
    try {
      const res = await fetch(url, {
        signal:  AbortSignal.timeout(5000),
        headers: { "User-Agent": "Mozilla/5.0 (compatible; SalesBot/1.0)" },
      });
      if (!res.ok) continue;
      const html = await res.text();
      const text = html
        .replace(/&#64;/g, "@").replace(/&#46;/g, ".").replace(/&amp;/g, "&")
        .replace(/<[^>]+>/g, " "); // strip tags for cleaner matching

      allEmails.push(...(text.match(emailRe) ?? []));
      allPhones.push(...(text.match(phoneRe) ?? []).map(p => p.replace(/\s/g, "")));

      if (!abn) {
        const m = text.match(abnRe);
        if (m) abn = m[0].replace(/ABN[:\s]*/i, "").replace(/\s/g, "");
      }
    } catch { /* timeout / fetch errors expected */ }
  }

  const badEmail = /\.(png|jpg|gif|svg|css|js|woff|ico)$/i;
  const emails = dedup(allEmails).filter(e => e.includes("@") && !badEmail.test(e)).slice(0, 10);
  const phones = dedup(allPhones).slice(0, 6);

  return (emails.length || phones.length || abn) ? { emails, phones, abn } : null;
}

// ─── Merge helpers (fallback) ─────────────────────────────────────────────────

function mergeContacts(results: (ContactResult | null)[]): {
  phone: string | null; email: string | null; linkedinUrl: string | null; sources: string[];
} {
  const hits = results.filter((r): r is ContactResult => r !== null);
  return {
    phone:       hits.map(r => r.phone).find(Boolean) ?? null,
    email:       hits.map(r => r.email).find(Boolean) ?? null,
    linkedinUrl: hits.map(r => r.linkedinUrl).find(Boolean) ?? null,
    sources:     hits.map(r => r.source),
  };
}

function mergeCompany(results: (CompanyResult | null)[]): Partial<CompanyResult> {
  const hits = results.filter((r): r is CompanyResult => r !== null);
  return {
    industry:      hits.map(r => r.industry).find(Boolean) ?? undefined,
    employeeCount: hits.map(r => r.employeeCount).find(v => v != null) ?? undefined,
    foundedYear:   hits.map(r => r.foundedYear).find(v => v != null) ?? undefined,
    description:   hits.map(r => r.description).find(Boolean) ?? undefined,
    techStack:     hits.map(r => r.techStack).find(v => v?.length) ?? undefined,
    annualRevenue: hits.map(r => r.annualRevenue).find(Boolean) ?? undefined,
  };
}

// ─── AI reconciliation pass ───────────────────────────────────────────────────

interface ReconciledResult {
  phone:           string | null;
  email:           string | null;
  linkedinUrl:     string | null;
  industry:        string | null;
  employeeCount:   number | null;
  foundedYear:     number | null;
  techStack:       string[] | null;
  annualRevenue:   string | null;
  scrapedEmails:   string[];
  scrapedPhones:   string[];
  abn:             string | null;
}

async function reconcileWithAI(
  lead: { company_name: string; recommended_contact_name: string | null; website: string | null },
  contactResults: (ContactResult | null)[],
  companyResults: (CompanyResult | null)[],
  hunterResult:   HunterResult | null,
  scrapeResult:   ScrapeResult | null,
  anthropicKey:   string,
): Promise<ReconciledResult | null> {
  if (!anthropicKey) return null;

  const raw = {
    contact_sources: contactResults.filter(Boolean).map(r => ({
      source: r!.source,
      phone:  r!.phone,
      email:  r!.email,
    })),
    company_sources: companyResults.filter(Boolean).map(r => ({
      source:        r!.source,
      industry:      r!.industry,
      employeeCount: r!.employeeCount,
      foundedYear:   r!.foundedYear,
      techStack:     r!.techStack,
      annualRevenue: r!.annualRevenue,
    })),
    hunter: hunterResult ? {
      email:    hunterResult.email,
      contacts: hunterResult.contacts.slice(0, 5),
    } : null,
    scraped: scrapeResult,
  };

  const prompt = `You are reconciling enrichment data gathered from multiple sources for a B2B sales lead.

Company: ${lead.company_name}
Contact name: ${lead.recommended_contact_name ?? "unknown"}
Website: ${lead.website ?? "unknown"}

Raw provider data:
${JSON.stringify(raw, null, 2)}

Your job:
1. PHONE — Pick the best direct number for the named contact. Prefer mobile (04xx) over landline. Normalise to Australian format: +61 4xx xxx xxx for mobiles, (0x) xxxx xxxx for landlines. Return null if none found.
2. EMAIL — Pick the most likely direct email for the named contact. Prefer named addresses (firstname@, firstname.lastname@) over generic (info@, contact@, admin@). Return null if only generic addresses exist.
3. LINKEDIN — Best LinkedIn /company/ or /in/ URL. Return null if none.
4. INDUSTRY — Pick the most specific descriptor (e.g. "4WD Accessories Retail" beats "Retail"). Normalise capitalisation. Return null if absent.
5. EMPLOYEE COUNT — Most plausible integer. If sources disagree, prefer the more recent or more specific source. Return null if absent.
6. FOUNDED YEAR — 4-digit integer. Return null if absent.
7. TECH STACK — Deduplicate and union all tech stack arrays. Remove duplicates case-insensitively.
8. ANNUAL REVENUE — Most specific string. Keep the original format (e.g. "$1M-$5M"). Return null if absent.
9. SCRAPED EMAILS — From the scraped array, remove: image extensions, noreply@, donotreply@, obvious spam patterns, and any email that doesn't match the company domain or is clearly a third-party service. Normalise to lowercase. Return up to 8.
10. SCRAPED PHONES — Normalise all to consistent AU format. Remove duplicates. Return up to 5.
11. ABN — Must be exactly 11 digits (spaces removed). Return null if invalid.

Return ONLY valid JSON with this exact shape, no markdown:
{
  "phone": string | null,
  "email": string | null,
  "linkedinUrl": string | null,
  "industry": string | null,
  "employeeCount": number | null,
  "foundedYear": number | null,
  "techStack": string[] | null,
  "annualRevenue": string | null,
  "scrapedEmails": string[],
  "scrapedPhones": string[],
  "abn": string | null
}`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method:  "POST",
      headers: {
        "Content-Type":      "application/json",
        "x-api-key":         anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({
        model:      "claude-haiku-4-5-20251001",
        max_tokens: 800,
        messages:   [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}`);
    const data  = await res.json();
    const raw   = (data.content?.[0]?.text ?? "").trim();
    const clean = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
    return JSON.parse(clean) as ReconciledResult;
  } catch (err) {
    console.error("[lusha] reconcileWithAI failed:", err);
    return null;
  }
}

// ─── Main handler ─────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { lead_id, action } = await req.json();
    if (!lead_id) return json({ error: "lead_id required" }, 400);

    const LUSHA_KEY     = Deno.env.get("LUSHA_API_KEY")     ?? "";
    const APOLLO_KEY    = Deno.env.get("APOLLO_API_KEY")    ?? "";
    const PDL_KEY       = Deno.env.get("PDL_API_KEY")       ?? "";
    const HUNTER_KEY    = Deno.env.get("HUNTER_API_KEY")    ?? "";
    const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: lead, error: leadErr } = await sb
      .from("sales_leads")
      .select("id, company_name, website, recommended_contact_name, recommended_contact_last_name, social_linkedin, lusha_mobile, email, state, industry")
      .eq("id", lead_id)
      .single();
    if (leadErr || !lead) return json({ error: "Lead not found" }, 404);

    // ── action=reveal: spend Lusha credit, return the phone number ───────────
    if (action === "reveal") {
      if (lead.lusha_mobile) return json({ mobile: lead.lusha_mobile, cached: true });
      if (!LUSHA_KEY) return json({ error: "Lusha not configured" }, 503);

      const { data: fullLead } = await sb
        .from("sales_leads")
        .select("lusha_contact_id, recommended_contact_name, recommended_contact_last_name")
        .eq("id", lead_id).single();

      let contactId: string | null = fullLead?.lusha_contact_id ?? null;

      // If we never located, do it now before revealing
      if (!contactId && fullLead?.recommended_contact_name?.trim()) {
        const nameParts = fullLead.recommended_contact_name.trim().split(/\s+/);
        const located = await tryLushaLocate(nameParts[0], nameParts.slice(1).join(" ") || fullLead.recommended_contact_last_name || null, lead.company_name, getDomain(lead.website), LUSHA_KEY);
        contactId = located?.contactId ?? null;
        if (contactId) await sb.from("sales_leads").update({ lusha_contact_id: contactId }).eq("id", lead_id);
      }

      if (!contactId) return json({ mobile: null, found: false });

      const phone = await tryLushaReveal(contactId, LUSHA_KEY);
      if (phone) {
        await sb.from("sales_leads").update({ lusha_mobile: phone }).eq("id", lead_id);
        return json({ mobile: phone, found: true });
      }
      return json({ mobile: null, found: false });
    }

    // ── action=enrich (default): all sources except Lusha ────────────────────
    if (!lead.recommended_contact_name?.trim()) {
      return json({ error: "No contact name on lead" }, 422);
    }

    const nameParts = lead.recommended_contact_name.trim().split(/\s+/);
    const firstName = nameParts[0];
    const lastName  = nameParts.slice(1).join(" ") || lead.recommended_contact_last_name?.trim() || null;
    const domain    = getDomain(lead.website);

    const [
      lushaLocated, apolloResult, pdlResult,
      hunterResult,
      apolloCompany, pdlCompany,
      scrapeResult,
    ] = await Promise.all([
      LUSHA_KEY  ? tryLushaLocate(firstName, lastName, lead.company_name, domain, LUSHA_KEY)                    : Promise.resolve(null),
      APOLLO_KEY ? tryApollo(firstName, lastName, lead.company_name, domain, APOLLO_KEY)                        : Promise.resolve(null),
      PDL_KEY    ? tryPDL(firstName, lastName, lead.company_name, domain, lead.social_linkedin ?? null, PDL_KEY) : Promise.resolve(null),
      HUNTER_KEY && domain ? tryHunter(domain, HUNTER_KEY)                                                      : Promise.resolve(null),
      APOLLO_KEY && domain ? tryApolloCompany(domain, APOLLO_KEY)                                               : Promise.resolve(null),
      PDL_KEY    && domain ? tryPDLCompany(domain, lead.company_name, PDL_KEY)                                  : Promise.resolve(null),
      lead.website         ? tryScrapeWebsite(lead.website)                                                     : Promise.resolve(null),
    ]);

    const reconciled      = await reconcileWithAI(lead, [apolloResult, pdlResult], [apolloCompany, pdlCompany], hunterResult, scrapeResult, ANTHROPIC_KEY);
    const fallbackContact = mergeContacts([apolloResult, pdlResult]);
    const fallbackCompany = mergeCompany([apolloCompany, pdlCompany]);

    const phone       = reconciled?.phone       ?? fallbackContact.phone;
    const email       = reconciled?.email       ?? fallbackContact.email;
    const linkedinUrl = reconciled?.linkedinUrl ?? fallbackContact.linkedinUrl;
    const sources     = fallbackContact.sources;

    const updates: Record<string, any> = {};

    // Store Lusha contactId so reveal can use it without re-locating
    if (lushaLocated?.contactId)                         updates.lusha_contact_id       = lushaLocated.contactId;
    // Apollo/PDL phone as best available until Lusha is revealed
    if (phone && !lead.lusha_mobile)                     updates.lusha_mobile           = phone;
    if (email && !lead.email)                            updates.email                  = email;
    if (linkedinUrl && !isPersonalLinkedIn(lead.social_linkedin)) updates.social_linkedin = linkedinUrl;

    const industry      = reconciled?.industry      ?? fallbackCompany.industry;
    const employeeCount = reconciled?.employeeCount ?? fallbackCompany.employeeCount;
    const foundedYear   = reconciled?.foundedYear   ?? fallbackCompany.foundedYear;
    const techStack     = reconciled?.techStack     ?? fallbackCompany.techStack;
    const annualRevenue = reconciled?.annualRevenue ?? fallbackCompany.annualRevenue;
    const description   = fallbackCompany.description;

    if (industry      && !lead.industry)               updates.industry                = industry;
    if (employeeCount != null)                         updates.employee_count          = employeeCount;
    if (foundedYear   != null)                         updates.founded_year            = foundedYear;
    if (description)                                   updates.company_description     = description;
    if (techStack?.length)                             updates.tech_stack              = techStack;
    if (annualRevenue)                                 updates.annual_revenue_estimate = annualRevenue;
    if (hunterResult?.pattern)                         updates.hunter_email_pattern    = hunterResult.pattern;
    if (hunterResult?.contacts?.length)                updates.hunter_contacts         = hunterResult.contacts;

    const scrapedEmails = reconciled?.scrapedEmails ?? scrapeResult?.emails ?? [];
    const scrapedPhones = reconciled?.scrapedPhones ?? scrapeResult?.phones ?? [];
    const abn           = reconciled?.abn           ?? scrapeResult?.abn   ?? null;

    if (scrapedEmails.length)                          updates.scraped_emails          = scrapedEmails;
    if (scrapedPhones.length)                          updates.scraped_phones          = scrapedPhones;
    if (abn)                                           updates.abn                     = abn;

    if (Object.keys(updates).length) {
      await sb.from("sales_leads").update(updates).eq("id", lead_id);
    }

    return json({
      email,
      found:          !!phone,
      lusha_located:  !!lushaLocated?.contactId,
      sources,
      reconciled:     !!reconciled,
      company:    industry ? { industry, employees: employeeCount } : null,
      hunter:     hunterResult ? { pattern: hunterResult.pattern, contacts: hunterResult.contacts.length } : null,
      scraped:    scrapedEmails.length || scrapedPhones.length || abn
                  ? { emails: scrapedEmails.length, phones: scrapedPhones.length, abn } : null,
    });

  } catch (err: any) {
    return json({ error: err.message ?? "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
