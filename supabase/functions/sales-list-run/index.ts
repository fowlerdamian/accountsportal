import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL     = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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
      console.error(`[sales-list-run] ${name} returned ${res.status}: ${txt.slice(0, 200)}`);
    }
    return res.ok;
  } catch (err) {
    console.error(`[sales-list-run] ${name} failed:`, err);
    return false;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  console.log("[sales-list-run] Starting list chain");

  await invoke("sales-lead-dedup");
  console.log("[sales-list-run] Dedup done");

  for (const channel of ["trailbait", "fleetcraft", "aga"]) {
    await invoke("sales-lead-scoring", { channel });
    console.log(`[sales-list-run] Scoring done: ${channel}`);
  }

  await invoke("sales-hubspot-sync", { action: "back_sync" });
  console.log("[sales-list-run] HubSpot sync done");

  await invoke("sales-calllist-generate");
  console.log("[sales-list-run] Call list generated");

  return new Response(
    JSON.stringify({ ok: true, chain: "list", completed_at: new Date().toISOString() }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
