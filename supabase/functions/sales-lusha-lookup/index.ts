import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { lead_id } = await req.json();
    if (!lead_id) return json({ error: "lead_id required" }, 400);

    const LUSHA_KEY = Deno.env.get("LUSHA_API_KEY");
    if (!LUSHA_KEY) return json({ error: "LUSHA_API_KEY not configured" }, 500);

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Fetch the lead
    const { data: lead, error: leadErr } = await sb
      .from("sales_leads")
      .select("id, company_name, website, recommended_contact_name, recommended_contact_last_name, recommended_contact_position, lusha_mobile")
      .eq("id", lead_id)
      .single();
    if (leadErr || !lead) return json({ error: "Lead not found" }, 404);

    // Return cached result if already found
    if (lead.lusha_mobile) return json({ mobile: lead.lusha_mobile, cached: true });

    const firstName = lead.recommended_contact_name?.trim() ?? null;
    const lastName  = lead.recommended_contact_last_name?.trim() ?? null;
    if (!firstName) return json({ error: "No contact name on lead" }, 422);

    const domain = lead.website
      ? new URL(lead.website.startsWith("http") ? lead.website : `https://${lead.website}`).hostname.replace(/^www\./, "")
      : null;

    // Build Lusha query params
    const params = new URLSearchParams({ firstName });
    if (lastName)             params.set("lastName",    lastName);
    if (lead.company_name)    params.set("company",     lead.company_name);
    if (domain)               params.set("domain",      domain);

    const lushaRes = await fetch(
      `https://api.lusha.com/v2/person/enrich?${params}`,
      { headers: { "api_key": LUSHA_KEY, "Accept": "application/json" } },
    );

    if (!lushaRes.ok) {
      const body = await lushaRes.text().catch(() => "");
      return json({ error: `Lusha error ${lushaRes.status}`, detail: body }, 502);
    }

    const result = await lushaRes.json();
    const phones: Array<{ localNumber?: string; internationalNumber?: string; type?: string }> =
      result?.data?.phoneNumbers ?? [];

    // Prefer mobile type, fall back to any number
    const mobile =
      phones.find((p) => p.type?.toLowerCase() === "mobile")?.internationalNumber ??
      phones.find((p) => p.type?.toLowerCase() === "mobile")?.localNumber ??
      phones[0]?.internationalNumber ??
      phones[0]?.localNumber ??
      null;

    if (mobile) {
      await sb.from("sales_leads").update({ lusha_mobile: mobile }).eq("id", lead_id);
    }

    return json({ mobile, found: !!mobile });

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
