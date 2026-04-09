/**
 * upwork-sync-inbound
 *
 * Cron: every 15 minutes for messages, hourly for timesheets.
 * Authenticates with stored OAuth tokens, pulls Upwork work diary and messages,
 * and syncs them into time_entries and activity_log.
 *
 * STUB — structure and API patterns are correct but Upwork OAuth credentials
 * must be registered at https://www.upwork.com/developer/keys/apply before
 * this function will make live API calls.
 *
 * Required secrets (supabase secrets set):
 *   UPWORK_CLIENT_ID
 *   UPWORK_CLIENT_SECRET
 *   UPWORK_ACCESS_TOKEN      (set via upwork-oauth-callback after auth)
 *   UPWORK_REFRESH_TOKEN     (set via upwork-oauth-callback after auth)
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const UPWORK_API_BASE = "https://api.upwork.com/api";

// ─────────────────────────────────────────────────────────────────────────────
// OAuth token refresh
// ─────────────────────────────────────────────────────────────────────────────

async function getValidAccessToken(): Promise<string> {
  const accessToken  = Deno.env.get("UPWORK_ACCESS_TOKEN");
  const refreshToken = Deno.env.get("UPWORK_REFRESH_TOKEN");
  const clientId     = Deno.env.get("UPWORK_CLIENT_ID");
  const clientSecret = Deno.env.get("UPWORK_CLIENT_SECRET");

  if (!refreshToken || !clientId || !clientSecret) {
    throw new Error("Upwork OAuth credentials not configured — see function header for setup instructions");
  }

  // Try existing access token with a lightweight check
  if (accessToken) {
    const check = await fetch(`${UPWORK_API_BASE}/auth/v1/info.json`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (check.ok) return accessToken;
  }

  // Refresh
  const params = new URLSearchParams({
    grant_type:    "refresh_token",
    refresh_token: refreshToken,
    client_id:     clientId,
    client_secret: clientSecret,
  });

  const res = await fetch("https://www.upwork.com/api/v3/oauth2/token", {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:    params.toString(),
  });

  if (!res.ok) throw new Error(`Token refresh failed: ${res.status} ${await res.text()}`);

  const tokens = await res.json();
  // NOTE: In production, update the stored tokens via Supabase Vault or secrets API
  return tokens.access_token as string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pull work diary (timesheets) for an Upwork contract
// ─────────────────────────────────────────────────────────────────────────────

async function syncWorkDiary(
  token: string,
  contractorId: string,
  upworkContractId: string,
  projectId: string,
  serviceClient: ReturnType<typeof createClient>,
  today: string,
): Promise<number> {
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0];

  const res = await fetch(
    `${UPWORK_API_BASE}/team/v3/workdiaries/contracts/${upworkContractId}.json?` +
      new URLSearchParams({ date_from: weekAgo, date_to: today }),
    { headers: { Authorization: `Bearer ${token}` } },
  );

  if (!res.ok) {
    console.error(`Work diary fetch failed for contract ${upworkContractId}: ${res.status}`);
    return 0;
  }

  const data     = await res.json();
  const snapshots = data?.diary?.blocks ?? [];
  let synced = 0;

  for (const block of snapshots) {
    const date  = block.worked_on ?? today;
    const hours = (block.duration_in_seconds ?? 0) / 3600;
    if (hours < 0.01) continue;

    // Upsert based on date + contractor to avoid duplicates
    const { error } = await serviceClient.from("time_entries").upsert(
      {
        contractor_id: contractorId,
        project_id:    projectId,
        hours:         Math.round(hours * 100) / 100,
        date,
        description:   block.memo ?? null,
        source:        "upwork",
      },
      { onConflict: "contractor_id,project_id,date,source", ignoreDuplicates: true },
    );

    if (!error) synced++;
  }

  return synced;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pull messages from Upwork Messages API
// ─────────────────────────────────────────────────────────────────────────────

async function syncMessages(
  token: string,
  contractorId: string,
  upworkContractId: string,
  projectId: string,
  contractorName: string,
  serviceClient: ReturnType<typeof createClient>,
): Promise<number> {
  const res = await fetch(
    `${UPWORK_API_BASE}/messages/v3/rooms.json?` +
      new URLSearchParams({ contract_id: upworkContractId, paging: "0;10" }),
    { headers: { Authorization: `Bearer ${token}` } },
  );

  if (!res.ok) {
    console.error(`Messages fetch failed: ${res.status}`);
    return 0;
  }

  const data     = await res.json();
  const messages = data?.rooms?.[0]?.messages ?? [];
  let synced = 0;

  for (const msg of messages) {
    const content = msg.message ?? "";
    if (!content) continue;

    // Log as activity — use content hash to detect duplicates via metadata
    const msgId = msg.id ?? `${Date.now()}`;
    const { data: existing } = await serviceClient
      .from("activity_log")
      .select("id")
      .eq("project_id", projectId)
      .eq("type", "upwork_message")
      .contains("metadata", { upwork_message_id: msgId })
      .maybeSingle();

    if (existing) continue;

    await serviceClient.from("activity_log").insert({
      contractor_id: contractorId,
      project_id:    projectId,
      type:          "upwork_message",
      content,
      author_id:     contractorId, // Upwork message — contractor is author
      author_name:   contractorName,
      metadata:      { upwork_message_id: msgId, send_to_upwork: false },
    });

    synced++;
  }

  return synced;
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const serviceClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  const startedAt = new Date().toISOString();
  const today     = new Date().toISOString().split("T")[0];
  const results: Record<string, unknown>[] = [];

  try {
    const token = await getValidAccessToken();

    // Get all active Upwork contractors with contract IDs
    const { data: upworkContractors, error } = await serviceClient
      .from("contractors")
      .select("id, name, upwork_contract_id")
      .eq("source", "upwork")
      .eq("status", "active")
      .not("upwork_contract_id", "is", null);

    if (error) throw error;

    for (const contractor of upworkContractors ?? []) {
      // Find any project assigned to this contractor (via tasks)
      const { data: taskRow } = await serviceClient
        .from("tasks")
        .select("project_id")
        .eq("assigned_to", contractor.id)
        .not("project_id", "is", null)
        .limit(1)
        .maybeSingle();

      if (!taskRow?.project_id) continue;

      const [hoursSynced, msgsSynced] = await Promise.all([
        syncWorkDiary(token, contractor.id, contractor.upwork_contract_id, taskRow.project_id, serviceClient, today),
        syncMessages(token, contractor.id, contractor.upwork_contract_id, taskRow.project_id, contractor.name, serviceClient),
      ]);

      results.push({ contractor: contractor.name, hours_synced: hoursSynced, messages_synced: msgsSynced });
    }

    // Log to upwork_sync_log (table created separately if needed)
    await serviceClient.from("upwork_sync_log").insert({
      direction:   "inbound",
      entity_type: "batch",
      status:      "success",
      metadata:    { results, started_at: startedAt },
    }).then(() => {}); // fire-and-forget, table may not exist yet

    return new Response(JSON.stringify({ ok: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[upwork-sync-inbound]", err);

    await serviceClient.from("upwork_sync_log").insert({
      direction:   "inbound",
      entity_type: "batch",
      status:      "error",
      error_message: (err as Error).message,
      metadata:    { started_at: startedAt },
    }).then(() => {});

    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
