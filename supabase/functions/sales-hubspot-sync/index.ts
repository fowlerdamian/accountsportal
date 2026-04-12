import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const HS_BASE = "https://api.hubapi.com";

type Channel = "trailbait" | "fleetcraft" | "aga";

const CHANNEL_TYPE: Record<Channel, string> = {
  trailbait:  "DISTRIBUTOR",
  fleetcraft: "FLEET___COMMERCIAL",
  aga:        "BESPOKE_MANUFACTURER",
};

const CHANNEL_DEAL_TYPE: Record<Channel, string> = {
  trailbait:  "Distributor",
  fleetcraft: "Fleet & Commercial",
  aga:        "Bespoke Manufacturer",
};

function hsHeaders(token: string) {
  return { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractDomain(url: string): string {
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, "");
  } catch { return url; }
}

function parseAddress(address: string | null) {
  if (!address) return {};
  const stateMatch    = address.match(/\b(NSW|VIC|QLD|SA|WA|TAS|NT|ACT)\b/);
  const postcodeMatch = address.match(/\b(\d{4})\b/);
  // Remove state/postcode from city part
  const city = address.split(",").slice(-3, -1).join(",").trim();
  return {
    address:  address.split(",")[0]?.trim(),
    city:     city || undefined,
    state:    stateMatch?.[1],
    zip:      postcodeMatch?.[1],
    country:  "Australia",
  };
}

// ─── HubSpot API calls ────────────────────────────────────────────────────────

async function findHubSpotCompany(domain: string, token: string): Promise<string | null> {
  const res = await fetch(`${HS_BASE}/crm/v3/objects/companies/search`, {
    method:  "POST",
    headers: hsHeaders(token),
    body: JSON.stringify({
      filterGroups: [{ filters: [{ propertyName: "domain", operator: "EQ", value: domain }] }],
      limit: 1,
    }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.results?.[0]?.id ?? null;
}

async function createHubSpotCompany(lead: any, channel: Channel, token: string): Promise<string | null> {
  const addrParts = parseAddress(lead.address);
  const properties: Record<string, string> = {
    name:        lead.company_name,
    phone:       lead.phone ?? "",
    type:        CHANNEL_TYPE[channel],
    description: lead.website_summary ?? "",
  };
  if (lead.website)    properties.domain = extractDomain(lead.website);
  if (addrParts.address) properties.address = addrParts.address;
  if (addrParts.city)    properties.city    = addrParts.city;
  if (addrParts.state)   properties.state   = addrParts.state;
  if (addrParts.zip)     properties.zip     = addrParts.zip;
  if (addrParts.country) properties.country = addrParts.country;

  const res = await fetch(`${HS_BASE}/crm/v3/objects/companies`, {
    method:  "POST",
    headers: hsHeaders(token),
    body: JSON.stringify({ properties }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.id ?? null;
}

async function createHubSpotContact(lead: any, companyId: string, token: string): Promise<string | null> {
  if (!lead.recommended_contact_name) return null;

  const nameParts = lead.recommended_contact_name.trim().split(" ");
  const firstName = nameParts[0] ?? "";
  const lastName  = nameParts.slice(1).join(" ") || lead.company_name;

  const res = await fetch(`${HS_BASE}/crm/v3/objects/contacts`, {
    method:  "POST",
    headers: hsHeaders(token),
    body: JSON.stringify({
      properties: {
        firstname: firstName,
        lastname:  lastName,
        jobtitle:  lead.recommended_contact_position ?? "",
        phone:     lead.phone ?? "",
        email:     lead.email ?? "",
      },
    }),
  });
  if (!res.ok) return null;
  const data   = await res.json();
  const contId = data.id;
  if (!contId) return null;

  // Associate contact with company
  await fetch(`${HS_BASE}/crm/v3/objects/contacts/${contId}/associations/companies/${companyId}/contact_to_company`, {
    method:  "PUT",
    headers: hsHeaders(token),
  });

  return contId;
}

async function createHubSpotDeal(lead: any, companyId: string, channel: Channel, token: string): Promise<string | null> {
  const dealName = `${lead.company_name} - ${CHANNEL_DEAL_TYPE[channel]} Opportunity`;

  const res = await fetch(`${HS_BASE}/crm/v3/objects/deals`, {
    method:  "POST",
    headers: hsHeaders(token),
    body: JSON.stringify({
      properties: {
        dealname:  dealName,
        dealstage: "appointmentscheduled", // First stage — adjust to match HubSpot pipeline
        dealtype:  CHANNEL_DEAL_TYPE[channel],
      },
    }),
  });
  if (!res.ok) return null;
  const data   = await res.json();
  const dealId = data.id;
  if (!dealId) return null;

  // Associate deal with company
  await fetch(`${HS_BASE}/crm/v3/objects/deals/${dealId}/associations/companies/${companyId}/deal_to_company`, {
    method:  "PUT",
    headers: hsHeaders(token),
  });

  return dealId;
}

// ─── Get HubSpot deals for pipeline view ─────────────────────────────────────

async function getHubSpotDeals(channel: Channel, token: string): Promise<any[]> {
  const res = await fetch(`${HS_BASE}/crm/v3/objects/deals/search`, {
    method:  "POST",
    headers: hsHeaders(token),
    body: JSON.stringify({
      filterGroups: [{
        filters: [{ propertyName: "dealtype", operator: "EQ", value: CHANNEL_DEAL_TYPE[channel] }],
      }],
      properties: ["dealname", "dealstage", "amount", "closedate", "hubspot_owner_id", "createdate", "hs_lastmodifieddate", "dealtype"],
      limit: 100,
    }),
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.results ?? [];
}

// ─── Sync call note to HubSpot ────────────────────────────────────────────────

async function syncCallNote(callEntry: any, lead: any, channel: Channel, token: string): Promise<boolean> {
  if (!lead.hubspot_company_id) return false;

  const noteBody = `[Sales Support App - ${CHANNEL_DEAL_TYPE[channel]}]
Date: ${callEntry.called_at ? new Date(callEntry.called_at).toLocaleDateString("en-AU") : "Unknown"}
Outcome: ${callEntry.call_outcome ?? "Unknown"}
Contact: ${callEntry.context_brief?.recommended_contact ?? "Not specified"}

Notes:
${callEntry.call_notes ?? "(no notes)"}

Lead Score: ${lead.lead_score ?? "?"}/100`;

  const res = await fetch(`${HS_BASE}/crm/v3/objects/notes`, {
    method:  "POST",
    headers: hsHeaders(token),
    body: JSON.stringify({
      properties: {
        hs_note_body:      noteBody,
        hs_timestamp:      callEntry.called_at ?? new Date().toISOString(),
      },
    }),
  });
  if (!res.ok) return false;
  const data   = await res.json();
  const noteId = data.id;
  if (!noteId) return false;

  // Associate with company
  await fetch(`${HS_BASE}/crm/v3/objects/notes/${noteId}/associations/companies/${lead.hubspot_company_id}/note_to_company`, {
    method:  "PUT",
    headers: hsHeaders(token),
  });

  // Associate with deal if available
  if (lead.hubspot_deal_id) {
    await fetch(`${HS_BASE}/crm/v3/objects/notes/${noteId}/associations/deals/${lead.hubspot_deal_id}/note_to_deal`, {
      method:  "PUT",
      headers: hsHeaders(token),
    });
  }

  return true;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Custom HubSpot property definitions ─────────────────────────────────────

const CUSTOM_PROPERTIES = [
  {
    name:        "google_rating",
    label:       "Google Rating",
    type:        "number",
    fieldType:   "number",
    groupName:   "companyinformation",
    description: "Google Places star rating (0–5)",
  },
  {
    name:        "google_review_count",
    label:       "Google Review Count",
    type:        "number",
    fieldType:   "number",
    groupName:   "companyinformation",
    description: "Total number of Google reviews",
  },
  {
    name:        "google_place_id",
    label:       "Google Place ID",
    type:        "string",
    fieldType:   "text",
    groupName:   "companyinformation",
    description: "Google Places ID for this business",
  },
];

async function ensureCompanyProperties(token: string): Promise<void> {
  for (const prop of CUSTOM_PROPERTIES) {
    const res = await fetch(`${HS_BASE}/crm/v3/properties/companies`, {
      method:  "POST",
      headers: hsHeaders(token),
      body:    JSON.stringify(prop),
    });
    // 409 = already exists — that's fine
    if (!res.ok && res.status !== 409) {
      console.warn(`ensureCompanyProperties: failed to create ${prop.name} (${res.status})`);
    }
  }
}

// ─── Update existing HubSpot company with enriched data ───────────────────────

async function updateHubSpotCompany(lead: any, companyId: string, token: string): Promise<boolean> {
  const addrParts = parseAddress(lead.address);
  const properties: Record<string, string> = {};

  if (lead.phone)           properties.phone   = lead.phone;
  if (lead.website)         properties.website = lead.website;
  if (lead.website)         properties.domain  = extractDomain(lead.website);
  if (addrParts.address)    properties.address = addrParts.address;
  if (addrParts.city)       properties.city    = addrParts.city;
  if (addrParts.state)      properties.state   = addrParts.state;
  if (addrParts.zip)        properties.zip     = addrParts.zip;
  if (addrParts.country)    properties.country = addrParts.country;

  // Build description from website summary + Google rating
  const descParts: string[] = [];
  if (lead.website_summary)     descParts.push(lead.website_summary);
  if (lead.google_rating != null) descParts.push(`Google Rating: ${lead.google_rating}/5 (${lead.google_review_count ?? 0} reviews)`);
  if (descParts.length)         properties.description = descParts.join("\n\n");

  // Social links — stored as individual columns
  if (lead.social_linkedin) properties.linkedin_company_page = lead.social_linkedin;
  if (lead.social_facebook) properties.facebook_company_page = lead.social_facebook;

  // Google Places custom properties
  if (lead.google_rating != null)    properties.google_rating       = String(lead.google_rating);
  if (lead.google_review_count != null) properties.google_review_count = String(lead.google_review_count);
  if (lead.google_place_id)          properties.google_place_id     = lead.google_place_id;

  if (Object.keys(properties).length === 0) return false;

  const res = await fetch(`${HS_BASE}/crm/v3/objects/companies/${companyId}`, {
    method:  "PATCH",
    headers: hsHeaders(token),
    body:    JSON.stringify({ properties }),
  });
  return res.ok;
}

// ─── Update first associated contact with fresh data ─────────────────────────

async function updateHubSpotContact(lead: any, companyId: string, token: string): Promise<boolean> {
  if (!lead.recommended_contact_name) return false;

  // Fetch associated contacts
  const assocRes = await fetch(
    `${HS_BASE}/crm/v3/objects/companies/${companyId}/associations/contacts?limit=1`,
    { headers: hsHeaders(token) }
  );
  if (!assocRes.ok) return false;
  const assocData = await assocRes.json();
  const contactId = assocData.results?.[0]?.id ?? null;
  if (!contactId) return false;

  const nameParts = lead.recommended_contact_name.trim().split(" ");
  const firstName = nameParts[0] ?? "";
  const lastName  = nameParts.slice(1).join(" ") || lead.company_name;

  const properties: Record<string, string> = {
    firstname: firstName,
    lastname:  lastName,
  };
  if (lead.recommended_contact_position) properties.jobtitle = lead.recommended_contact_position;
  if (lead.email)                         properties.email    = lead.email;
  if (lead.phone)                         properties.phone    = lead.phone;

  const res = await fetch(`${HS_BASE}/crm/v3/objects/contacts/${contactId}`, {
    method:  "PATCH",
    headers: hsHeaders(token),
    body:    JSON.stringify({ properties }),
  });
  return res.ok;
}

// ─── Main handler ─────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
  const hsToken = Deno.env.get("HUBSPOT_ACCESS_TOKEN") ?? "";
  if (!hsToken) {
    return new Response(JSON.stringify({ error: "HUBSPOT_ACCESS_TOKEN not configured" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  let body: { action?: string; lead_id?: string; call_id?: string; channel?: Channel } = {};
  try { body = await req.json(); } catch { /* GET request */ }

  // ── GET pipeline deals ────────────────────────────────────────────────────
  if (req.method === "GET" || body.action === "get_deals") {
    const params = new URL(req.url).searchParams;
    const ch     = (params.get("channel") ?? body.channel ?? "trailbait") as Channel;
    const deals  = await getHubSpotDeals(ch, hsToken);

    return new Response(
      JSON.stringify({ ok: true, deals }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // ── Back-sync: enrich existing HubSpot records ───────────────────────────
  if (body.action === "back_sync") {
    // Ensure custom Google properties exist in HubSpot
    await ensureCompanyProperties(hsToken);

    // Fetch all leads that are already in HubSpot
    const { data: leads } = await supabase
      .from("sales_leads")
      .select("*")
      .not("hubspot_company_id", "is", null)
      .limit(200);

    let updated = 0;
    for (const lead of leads ?? []) {
      await sleep(150); // stay within HubSpot rate limits
      const ok = await updateHubSpotCompany(lead, lead.hubspot_company_id, hsToken);
      if (ok) {
        await updateHubSpotContact(lead, lead.hubspot_company_id, hsToken);
        updated++;
      }
    }

    return new Response(
      JSON.stringify({ ok: true, updated }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // ── Sync call notes ───────────────────────────────────────────────────────
  if (body.action === "sync_notes") {
    const { data: pendingCalls } = await supabase
      .from("call_list")
      .select("*, sales_leads(*)")
      .eq("hubspot_note_synced", false)
      .not("call_notes", "is", null)
      .not("called_at", "is", null)
      .limit(50);

    let synced = 0;
    for (const call of pendingCalls ?? []) {
      const lead    = (call as any).sales_leads;
      if (!lead) continue;
      const ok = await syncCallNote(call, lead, lead.channel as Channel, hsToken);
      if (ok) {
        await supabase.from("call_list").update({ hubspot_note_synced: true }).eq("id", call.id);
        synced++;
      }
    }

    return new Response(
      JSON.stringify({ ok: true, synced }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // ── Push single lead to HubSpot ───────────────────────────────────────────
  if (!body.lead_id) {
    return new Response(JSON.stringify({ error: "lead_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const { data: lead } = await supabase.from("sales_leads").select("*").eq("id", body.lead_id).single();
  if (!lead) {
    return new Response(JSON.stringify({ error: "Lead not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const channel = lead.channel as Channel;

  // Check for existing company
  let companyId = lead.hubspot_company_id ?? null;
  if (!companyId && lead.website) {
    companyId = await findHubSpotCompany(extractDomain(lead.website), hsToken);
  }

  if (!companyId) {
    companyId = await createHubSpotCompany(lead, channel, hsToken);
  }

  if (!companyId) {
    return new Response(JSON.stringify({ error: "Failed to create/find HubSpot company" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const contactId = await createHubSpotContact(lead, companyId, hsToken);
  const dealId    = await createHubSpotDeal(lead, companyId, channel, hsToken);

  // Update lead record
  await supabase.from("sales_leads").update({
    hubspot_company_id: companyId,
    hubspot_deal_id:    dealId,
    hubspot_synced_at:  new Date().toISOString(),
    status:             "contacted",
  }).eq("id", body.lead_id);

  return new Response(
    JSON.stringify({ ok: true, companyId, contactId, dealId }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
