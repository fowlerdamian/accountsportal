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

  const detailUrl = `${PLACES_BASE}/details/json?place_id=${pid}&fields=name,rating,user_ratings_total,formatted_phone_number,website,formatted_address,opening_hours,reviews&key=${placesKey}`;
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
  };
}

// ─── Website scraping ─────────────────────────────────────────────────────────

async function scrapeWebsite(url: string): Promise<{ text: string; emails: string[]; phones: string[] }> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; AGAResearchBot/1.0)" },
      signal:  AbortSignal.timeout(8000),
    });
    if (!res.ok) return { text: "", emails: [], phones: [] };

    const html  = await res.text();
    // Strip tags
    const text  = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
                      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
                      .replace(/<[^>]+>/g, " ")
                      .replace(/\s+/g, " ")
                      .trim()
                      .slice(0, 6000);

    const emails = [...new Set((text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) ?? []))].slice(0, 3);
    const phones = [...new Set((text.match(/(?:\+61|0)[2-9]\d{8}|\b1[38]\d{2}\b/g) ?? []))].slice(0, 3);

    return { text, emails, phones };
  } catch {
    return { text: "", emails: [], phones: [] };
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

// ─── Claude Sonnet: company summary & contact extraction ─────────────────────

async function generateSummary(
  companyName: string,
  websiteText: string,
  channel: string,
  anthropicKey: string
): Promise<{ summary: string; contact_name: string | null; contact_position: string | null; key_products: string[] }> {
  const channelContext: Record<string, string> = {
    trailbait:  "4x4/4WD accessories retail",
    fleetcraft: "fleet vehicle fitout and upfitting",
    aga:        "automotive brand/OEM manufacturing",
  };

  const prompt = `You are analysing a company for sales lead qualification in ${channelContext[channel] ?? "automotive"}.

Company: ${companyName}
Website content (truncated): ${websiteText.slice(0, 3000)}

Return a JSON object with these exact fields:
- "summary": 2-3 sentence description of the business (what they do, who they serve, notable products/services)
- "contact_name": The most senior person's full name found in the text, or null if not found
- "contact_position": Their job title or position, or null if not found
- "key_products": Array of up to 5 key products or services they offer
- "website_quality": One of "products" (has product listings), "basic" (informational site), or "none" (no meaningful site)
- "company_size": One of "large" (50+ employees or multiple locations), "medium" (10-50 employees), "small" (<10 employees), or "unknown"
- "has_own_brand": true if they sell products under their own brand name, false otherwise
- "currently_imports": true if there's evidence they import products from overseas, false otherwise

Respond with only valid JSON, no markdown.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method:  "POST",
    headers: {
      "Content-Type":      "application/json",
      "x-api-key":         anthropicKey,
      "anthropic-version": "2023-06-01",
    },
    signal: AbortSignal.timeout(20000),
    body: JSON.stringify({
      model:      "claude-haiku-4-5-20251001",
      max_tokens: 512,
      messages:   [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    return { summary: "", contact_name: null, contact_position: null, key_products: [] };
  }

  const data = await res.json();
  try {
    const parsed = JSON.parse(data.content?.[0]?.text ?? "{}");
    return {
      summary:          parsed.summary ?? "",
      contact_name:     parsed.contact_name ?? null,
      contact_position: parsed.contact_position ?? null,
      key_products:     parsed.key_products ?? [],
      website_quality:  parsed.website_quality,
      company_size:     parsed.company_size,
      has_own_brand:    parsed.has_own_brand,
      currently_imports: parsed.currently_imports,
    } as any;
  } catch {
    return { summary: "", contact_name: null, contact_position: null, key_products: [] };
  }
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
  const cin7Account  = Deno.env.get("CIN7_ACCOUNT_ID") ?? "";
  const cin7Key      = Deno.env.get("CIN7_API_KEY") ?? "";

  let body: { action?: string; lead_id?: string; channel?: string } = {};
  try { body = await req.json(); } catch { /* no body */ }

  // ── On-demand Apollo phone reveal ─────────────────────────────────────────
  if (body.action === "reveal_phone" && body.lead_id) {
    const apolloKey = Deno.env.get("APOLLO_API_KEY") ?? "";
    if (!apolloKey) {
      return new Response(JSON.stringify({ error: "APOLLO_API_KEY not configured" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: lead } = await supabase.from("sales_leads").select("*").eq("id", body.lead_id).single();
    if (!lead) {
      return new Response(JSON.stringify({ error: "Lead not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Use Apollo people/match to find + reveal phone for the specific contact
    const nameParts = (lead.recommended_contact_name ?? "").trim().split(" ");
    const matchPayload: Record<string, any> = {
      organization_name:     lead.company_name,
      reveal_phone_number:   true,
    };
    if (nameParts[0]) matchPayload.first_name = nameParts[0];
    if (nameParts[1]) matchPayload.last_name  = nameParts.slice(1).join(" ");
    if (lead.website)  matchPayload.domain    = new URL(lead.website.startsWith("http") ? lead.website : `https://${lead.website}`).hostname.replace(/^www\./, "");

    try {
      const res = await fetch("https://api.apollo.io/v1/people/match", {
        method:  "POST",
        headers: { "Content-Type": "application/json", "X-Api-Key": apolloKey },
        body:    JSON.stringify(matchPayload),
      });

      if (!res.ok) {
        return new Response(JSON.stringify({ error: "Apollo API error", status: res.status }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const data   = await res.json();
      const person = data.person;

      const phones: any[] = person?.phone_numbers ?? [];
      const phone =
        phones.find((p: any) => p.type === "mobile")?.sanitized_number ??
        phones.find((p: any) => p.type === "direct_phone")?.sanitized_number ??
        phones[0]?.sanitized_number ?? null;

      if (phone) {
        await supabase.from("sales_leads").update({ phone }).eq("id", body.lead_id);
      }

      return new Response(
        JSON.stringify({ ok: true, phone, found: !!person }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } catch (err) {
      return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
  }

  // Build query for leads to enrich
  let query = supabase
    .from("sales_leads")
    .select("*")
    .in("status", ["new", "researched"])
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
    await sleep(800); // respect rate limits

    try {
      const updates: Record<string, any> = {};

      // 1. Google Places
      const places = await enrichFromPlaces(lead.google_place_id, lead.company_name, placesKey);
      if (places) {
        if (places.google_rating)       updates.google_rating       = places.google_rating;
        if (places.google_review_count) updates.google_review_count = places.google_review_count;
        if (places.phone && !lead.phone) updates.phone = places.phone;
        if (places.website && !lead.website) updates.website = places.website;
        if (places.address && !lead.address) updates.address = places.address;
        if (places.google_place_id)     updates.google_place_id     = places.google_place_id;
      }

      // 2. Website scrape
      const websiteUrl = updates.website ?? lead.website;
      let websiteText  = "";
      if (websiteUrl) {
        const scraped = await scrapeWebsite(websiteUrl);
        websiteText   = scraped.text;
        if (scraped.emails.length && !lead.email) updates.email = scraped.emails[0];
        if (scraped.phones.length && !lead.phone) updates.phone = scraped.phones[0];
      }

      // 3. AI summary & contact extraction (homepage scan for summary + key products only)
      if (websiteText.length > 100) {
        const ai = await generateSummary(lead.company_name, websiteText, lead.channel, anthropicKey);
        if (ai.summary) updates.website_summary = ai.summary;
        // Don't set contact from homepage here — Apollo in step 4 is more reliable.
        // Homepage contact stored as low-priority fallback only if Apollo finds nothing.
        if (ai.key_products?.length) updates.key_products_services = ai.key_products;
        if ((ai as any).website_quality) updates.score_breakdown = {
          ...(lead.score_breakdown ?? {}),
          website_quality:   (ai as any).website_quality,
          company_size:      (ai as any).company_size,
          has_own_brand:     (ai as any).has_own_brand,
          currently_imports: (ai as any).currently_imports,
        };
        // Store homepage contact as fallback — only used if Apollo (step 4) finds nothing
        if (ai.contact_name) {
          updates._homepage_contact_name     = ai.contact_name;
          updates._homepage_contact_position = ai.contact_position ?? null;
        }
      }

      // 4. Apollo people search — ALWAYS run, regardless of homepage contact found
      // Apollo is authoritative; homepage scrape is unreliable (finds testimonials, footers, etc.)
      if (apolloKey) {
        const websiteForApollo = updates.website ?? lead.website ?? "";
        let domain: string | null = null;
        try {
          domain = new URL(websiteForApollo.startsWith("http") ? websiteForApollo : `https://${websiteForApollo}`)
            .hostname.replace(/^www\./, "");
        } catch { /* skip */ }

        if (domain) {
          try {
            await sleep(300);
            // Use /people/search with organization_domains array (correct endpoint + param)
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
                }
                if (person.linkedin_url && !lead.social_linkedin) {
                  updates.social_linkedin = person.linkedin_url;
                }
              } else {
                // Fallback: search by company name
                await sleep(300);
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
                    }
                  }
                }
              }
            } else {
              const errTxt = await apolloRes.text().catch(() => "");
              console.warn(`Apollo ${apolloRes.status} for ${lead.company_name}: ${errTxt.slice(0, 200)}`);
            }
          } catch (err) {
            console.warn("Apollo search failed for", lead.company_name, err);
          }
        }
      }

      // If Apollo found nothing, fall back to the homepage contact as last resort
      if (!updates.recommended_contact_name && !lead.recommended_contact_name) {
        if (updates._homepage_contact_name) {
          updates.recommended_contact_name     = updates._homepage_contact_name;
          updates.recommended_contact_position = updates._homepage_contact_position ?? null;
          updates.recommended_contact_source   = "website";
        }
      }
      delete updates._homepage_contact_name;
      delete updates._homepage_contact_position;

      // 5. Social media
      if (cseKey && cseCx) {
        await sleep(400);
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
