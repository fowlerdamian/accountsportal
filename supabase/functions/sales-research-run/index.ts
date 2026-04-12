import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL      = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function invoke(name: string, body: object = {}): Promise<boolean> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      method:  "POST",
      headers: {
        "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
        "Content-Type":  "application/json",
      },
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch (err) {
    console.error(`[sales-research-run] ${name} failed:`, err);
    return false;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  console.log("[sales-research-run] Starting research chain");

  await invoke("sales-lead-discovery");
  console.log("[sales-research-run] Discovery done");

  // Enrich and score per-channel so each gets its own batch (avoids TrailBait
  // filling the 50-lead limit and starving FleetCraft / AGA)
  for (const channel of ["trailbait", "fleetcraft", "aga"]) {
    await invoke("sales-lead-enrichment", { channel });
    console.log(`[sales-research-run] Enrichment done: ${channel}`);
    await invoke("sales-lead-scoring", { channel });
    console.log(`[sales-research-run] Scoring done: ${channel}`);
  }

  return new Response(
    JSON.stringify({ ok: true, chain: "research", completed_at: new Date().toISOString() }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
