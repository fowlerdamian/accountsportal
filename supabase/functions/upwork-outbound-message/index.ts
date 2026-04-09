/**
 * upwork-outbound-message
 *
 * Sends a message to a contractor via Upwork Messages API.
 * Triggered from the UI when "Send to Upwork" is checked on a note.
 *
 * STUB — see upwork-sync-inbound for setup instructions.
 *
 * POST body:
 *   { contractor_id: string, content: string, activity_log_id: string }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const anonClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: { user }, error: authError } = await anonClient.auth.getUser();
  if (authError || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const serviceClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const { contractor_id, content, activity_log_id } = await req.json();

    // Look up contractor's Upwork contract ID
    const { data: contractor, error: cErr } = await serviceClient
      .from("contractors")
      .select("upwork_contract_id, name")
      .eq("id", contractor_id)
      .single();

    if (cErr || !contractor?.upwork_contract_id) {
      throw new Error("Contractor not found or has no Upwork contract ID");
    }

    const clientId     = Deno.env.get("UPWORK_CLIENT_ID");
    const accessToken  = Deno.env.get("UPWORK_ACCESS_TOKEN");

    if (!clientId || !accessToken) {
      throw new Error("Upwork OAuth credentials not configured — see function header for setup instructions");
    }

    // Send via Upwork Messages API
    // POST /api/messages/v3/rooms/{contract_id}/messages
    const res = await fetch(
      `https://api.upwork.com/api/messages/v3/rooms/${contractor.upwork_contract_id}/messages`,
      {
        method:  "POST",
        headers: {
          Authorization:  `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message: content }),
      },
    );

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Upwork API error: ${res.status} ${errText}`);
    }

    // Log success
    await serviceClient.from("upwork_sync_log").insert({
      direction:     "outbound",
      entity_type:   "message",
      entity_id:     activity_log_id ?? null,
      status:        "success",
      metadata:      { contractor_id, contractor_name: contractor.name },
    });

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[upwork-outbound-message]", err);

    await serviceClient.from("upwork_sync_log").insert({
      direction:     "outbound",
      entity_type:   "message",
      status:        "error",
      error_message: (err as Error).message,
    });

    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
