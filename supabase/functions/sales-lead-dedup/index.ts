import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Channel = "trailbait" | "fleetcraft" | "aga";

// ─── Similarity helpers ───────────────────────────────────────────────────────

function extractDomain(url: string): string | null {
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, "");
  } catch { return null; }
}

function nameSimilarity(a: string, b: string): number {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const na = norm(a);
  const nb = norm(b);
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.9;
  const bigrams = (s: string) => {
    const set = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    return set;
  };
  const bg1 = bigrams(na);
  const bg2 = bigrams(nb);
  let overlap = 0;
  for (const b of bg1) if (bg2.has(b)) overlap++;
  return (2 * overlap) / (bg1.size + bg2.size || 1);
}

// ─── Merge two lead records into the better one ───────────────────────────────
// Returns the fields to PATCH onto the keeper from the duplicate.

function mergeFields(keeper: any, dupe: any): Record<string, any> {
  const patch: Record<string, any> = {};
  const fillIfMissing = (field: string) => {
    if (!keeper[field] && dupe[field]) patch[field] = dupe[field];
  };

  // Scalar fields — fill keeper gaps from dupe
  for (const f of [
    "phone", "email", "website", "address", "state", "postcode",
    "google_rating", "google_review_count", "google_place_id",
    "social_facebook", "social_instagram", "social_linkedin",
    "website_summary", "recommended_contact_name",
    "recommended_contact_position", "recommended_contact_source",
    "hubspot_company_id", "hubspot_deal_id", "hubspot_synced_at",
    "cin7_customer_id", "cin7_customer_tag", "tender_context",
  ]) fillIfMissing(f);

  // Arrays — merge unique values
  if (!keeper.key_products_services?.length && dupe.key_products_services?.length) {
    patch.key_products_services = dupe.key_products_services;
  } else if (keeper.key_products_services?.length && dupe.key_products_services?.length) {
    const merged = [...new Set([...keeper.key_products_services, ...dupe.key_products_services])];
    if (merged.length > keeper.key_products_services.length) patch.key_products_services = merged;
  }

  // Prefer higher score breakdown if keeper has none
  if (!keeper.score_breakdown && dupe.score_breakdown) {
    patch.score_breakdown = dupe.score_breakdown;
  }

  // Prefer "existing customer" if either record knows it
  if (!keeper.is_existing_customer && dupe.is_existing_customer) {
    patch.is_existing_customer = true;
  }

  // Keep the higher lead score
  if ((dupe.lead_score ?? 0) > (keeper.lead_score ?? 0)) {
    patch.lead_score = dupe.lead_score;
  }

  return patch;
}

// ─── Score a lead record for keeper selection (more data = higher score) ──────

function completenessScore(lead: any): number {
  let score = lead.lead_score ?? 0;
  if (lead.phone)                     score += 10;
  if (lead.email)                     score += 8;
  if (lead.website_summary)           score += 6;
  if (lead.recommended_contact_name)  score += 8;
  if (lead.google_rating != null)     score += 5;
  if (lead.hubspot_company_id)        score += 15;
  if (lead.cin7_customer_id)          score += 15;
  if (lead.social_linkedin)           score += 3;
  return score;
}

// ─── Main handler ─────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  let body: { channel?: Channel; dry_run?: boolean } = {};
  try { body = await req.json(); } catch { /* no body */ }

  const channels: Channel[] = body.channel ? [body.channel] : ["trailbait", "fleetcraft", "aga"];
  const dryRun = body.dry_run === true;

  const summary: Record<string, { groups: number; removed: number }> = {};

  for (const channel of channels) {
    const { data: leads, error } = await supabase
      .from("sales_leads")
      .select("*")
      .eq("channel", channel)
      .order("created_at", { ascending: true });

    if (error || !leads?.length) {
      summary[channel] = { groups: 0, removed: 0 };
      continue;
    }

    // Build domain map and find duplicate groups
    const domainMap = new Map<string, any[]>();   // domain → leads
    const noDomain: any[] = [];

    for (const lead of leads) {
      const domain = lead.website ? extractDomain(lead.website) : null;
      if (domain) {
        const bucket = domainMap.get(domain) ?? [];
        bucket.push(lead);
        domainMap.set(domain, bucket);
      } else {
        noDomain.push(lead);
      }
    }

    // Also group by name similarity for leads without a domain match
    const nameGroups: any[][] = [];
    const ungrouped = [...noDomain];

    for (let i = 0; i < ungrouped.length; i++) {
      const a = ungrouped[i];
      if (!a) continue;
      const group = [a];
      for (let j = i + 1; j < ungrouped.length; j++) {
        const b = ungrouped[j];
        if (!b) continue;
        if (nameSimilarity(a.company_name, b.company_name) >= 0.80) {
          group.push(b);
          ungrouped[j] = null as any;
        }
      }
      if (group.length > 1) nameGroups.push(group);
    }

    // Combine domain groups + name groups (only groups with 2+ members)
    const dupGroups: any[][] = [
      ...Array.from(domainMap.values()).filter((g) => g.length > 1),
      ...nameGroups,
    ];

    let groupsFound = 0;
    let removed     = 0;

    for (const group of dupGroups) {
      groupsFound++;

      // Pick keeper = highest completeness score
      const sorted = group.slice().sort((a, b) => completenessScore(b) - completenessScore(a));
      const keeper = sorted[0];
      const dupes  = sorted.slice(1);

      if (!dryRun) {
        // Merge data from dupes into keeper
        let patch: Record<string, any> = {};
        for (const dupe of dupes) {
          patch = { ...patch, ...mergeFields({ ...keeper, ...patch }, dupe) };
        }
        if (Object.keys(patch).length) {
          await supabase.from("sales_leads").update(patch).eq("id", keeper.id);
        }

        // Re-point any call_list rows from dupes to keeper
        const dupeIds = dupes.map((d) => d.id);
        if (dupeIds.length) {
          await supabase
            .from("call_list")
            .update({ lead_id: keeper.id })
            .in("lead_id", dupeIds);
        }

        // Delete dupes
        await supabase.from("sales_leads").delete().in("id", dupeIds);
      }

      removed += dupes.length;
    }

    summary[channel] = { groups: groupsFound, removed };
  }

  return new Response(
    JSON.stringify({ ok: true, dry_run: dryRun, summary }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
