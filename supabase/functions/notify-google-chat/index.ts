import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Support notifications fan out to every configured Google Chat space.
    // GCHAT_SUPPORT_WEBHOOK is the original space; GCHAT_SUPPORT_WEBHOOK_2 is
    // the additional one. Either var may also hold a comma-separated list, so
    // more spaces can be added later without another code change.
    const webhookUrls = [
      Deno.env.get("GCHAT_SUPPORT_WEBHOOK"),
      Deno.env.get("GCHAT_SUPPORT_WEBHOOK_2"),
    ]
      .filter((v): v is string => !!v)
      .flatMap((v) => v.split(","))
      .map((v) => v.trim())
      .filter(Boolean);
    // De-dupe so the same space isn't pinged twice.
    const targets = [...new Set(webhookUrls)];

    if (targets.length === 0) {
      console.warn("No GCHAT_SUPPORT_WEBHOOK(_2) configured");
      return new Response(
        JSON.stringify({ ok: false, error: "Webhook not configured" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { text } = await req.json();
    if (!text) {
      return new Response(
        JSON.stringify({ ok: false, error: "No text provided" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Post to all spaces concurrently — one failing space must not stop the rest.
    const results = await Promise.allSettled(
      targets.map(async (url) => {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
        if (!res.ok) {
          const err = await res.text();
          throw new Error(`Webhook returned ${res.status}: ${err}`);
        }
        return true;
      })
    );

    const delivered = results.filter((r) => r.status === "fulfilled").length;
    results.forEach((r, i) => {
      if (r.status === "rejected") {
        console.error(`Google Chat webhook ${i} failed:`, r.reason?.message ?? r.reason);
      }
    });

    return new Response(
      JSON.stringify({ ok: delivered > 0, delivered, total: targets.length }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("notify-google-chat error:", err);
    return new Response(
      JSON.stringify({ ok: false, error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
