import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL      = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Each sub-function gets its own 150s budget — use 145s here so the orchestrator
// never waits past its own timeout on a single stuck call.
async function invoke(name: string, body: object = {}): Promise<boolean> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      method:  "POST",
      headers: {
        "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
        "Content-Type":  "application/json",
      },
      signal: AbortSignal.timeout(145000),
      body:   JSON.stringify(body),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      console.error(`[sales-research-run] ${name} returned ${res.status}: ${txt.slice(0, 200)}`);
    }
    return res.ok;
  } catch (err) {
    console.error(`[sales-research-run] ${name} failed:`, err);
    return false;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  console.log("[sales-research-run] Starting research chain");

  // Discovery runs first (produces the leads everything else depends on)
  await invoke("sales-lead-discovery");
  console.log("[sales-research-run] Discovery done");

  // Dedup immediately after discovery so enrichment never wastes credits on duplicates
  await invoke("sales-lead-dedup");
  console.log("[sales-research-run] Dedup done");

  // Enrich and score all 3 channels in parallel — each gets its own 150s budget.
  // Previously sequential: 3 × 150s would blow the orchestrator's own 150s limit.
  await Promise.all(
    (["trailbait", "fleetcraft", "aga"] as const).map(async (channel) => {
      await invoke("sales-lead-enrichment", { channel });
      console.log(`[sales-research-run] Enrichment done: ${channel}`);
      await invoke("sales-lead-scoring", { channel });
      console.log(`[sales-research-run] Scoring done: ${channel}`);
    })
  );

  return new Response(
    JSON.stringify({ ok: true, chain: "research", completed_at: new Date().toISOString() }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
