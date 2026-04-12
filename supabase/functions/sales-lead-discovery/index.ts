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

// ─── Supabase helpers ─────────────────────────────────────────────────────────

async function isDuplicate(
  supabase: ReturnType<typeof createClient>,
  companyName: string,
  website: string | null,
  channel: Channel
): Promise<boolean> {
  // Check existing leads — fuzzy match on name
  const { data: leads } = await supabase
    .from("sales_leads")
    .select("id, company_name, website")
    .eq("channel", channel)
    .ilike("company_name", `%${companyName.split(" ")[0]}%`)
    .limit(5);

  if (leads?.length) {
    for (const lead of leads) {
      const nameSim = nameSimilarity(lead.company_name, companyName);
      if (nameSim > 0.75) return true;
      if (website && lead.website && extractDomain(lead.website) === extractDomain(website)) return true;
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
  const url = `${PLACES_BASE}/textsearch/json?query=${encodeURIComponent(query)}&region=au&key=${placesKey}`;
  const res = await fetch(url);
  if (!res.ok) return { results: [], diagnostic: `HTTP ${res.status}` };
  const data = await res.json();
  const diagnostic = data.status !== "OK" ? `Places API: ${data.status} — ${data.error_message ?? ""}` : undefined;
  return { results: data.results ?? [], diagnostic };
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

          for (const place of rawResults.slice(0, 15)) {
            const companyName = place.name ?? "";
            if (!companyName || companyName.length < 3) continue;

            // Skip the known chain HQs (TrailBait targets independents)
            if (channel === "trailbait") {
              const chains = ["ARB", "TJM", "Ironman", "Opposite Lock", "Repco", "AutoBarn", "SuperCheap", "Bapcor"];
              if (chains.some((c) => companyName.toLowerCase().includes(c.toLowerCase()))) continue;
            }

            const website = place.website ?? null;
            const isDup   = await isDuplicate(supabase, companyName, website, channel);
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
