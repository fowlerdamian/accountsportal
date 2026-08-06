// ─────────────────────────────────────────────────────────────────────────────
// opportunity-sync — HubSpot integration for the Opportunity Pressure module.
// New function: extends the portal's HubSpot footprint by addition only; the
// existing sales-hubspot-sync worker is untouched.
//
// Actions:
//   pull              (default) mirror open deals + their engagements into
//                     public.opportunities / public.opportunity_activities,
//                     and reconcile linked staff_tasks status back to HubSpot.
//   log_activity      write an engagement to HubSpot FIRST, then reflect it
//                     locally. A HubSpot failure returns an error and nothing
//                     is saved — the portal must never grow a second register
//                     that drifts from the CRM.
//   create_task       create a HubSpot task, then the ONE staff_tasks row
//                     (linked via opportunity_id) the tasks app also renders.
//   push_task_status  push a linked task's current status to HubSpot.
//
// Auth: HUBSPOT_ACCESS_TOKEN (same Supabase secret the other HubSpot
// functions use). DB access via service role.
// ─────────────────────────────────────────────────────────────────────────────

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const HUBSPOT_BASE = "https://api.hubapi.com";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function hsFetch(token: string) {
  return async (path: string, init: RequestInit = {}) => {
    const res = await fetch(`${HUBSPOT_BASE}${path}`, {
      ...init,
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`HubSpot ${init.method ?? "GET"} ${path} → ${res.status}: ${text.slice(0, 300)}`);
    }
    return res.status === 204 ? null : await res.json();
  };
}

const chunk = <T>(arr: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

// dealtype → division, consistent with src/lib/channels.ts
const DIVISION_BY_DEALTYPE: Record<string, string> = {
  "Distributor": "TrailBait",
  "Fleet & Commercial": "FleetCraft",
  "Bespoke Manufacturer": "OEM",
};

// HubSpot engagement objects → register activity types
const ENGAGEMENT_OBJECTS: Array<{
  object: string;
  type: "note" | "call" | "email" | "meeting";
  properties: string[];
  body: (p: Record<string, string | null>) => string;
}> = [
  { object: "notes", type: "note", properties: ["hs_note_body", "hs_timestamp", "hubspot_owner_id"], body: (p) => p.hs_note_body ?? "" },
  { object: "calls", type: "call", properties: ["hs_call_body", "hs_call_title", "hs_timestamp", "hubspot_owner_id"], body: (p) => p.hs_call_body ?? p.hs_call_title ?? "" },
  { object: "emails", type: "email", properties: ["hs_email_subject", "hs_email_text", "hs_timestamp", "hubspot_owner_id"], body: (p) => p.hs_email_subject ?? p.hs_email_text ?? "" },
  { object: "meetings", type: "meeting", properties: ["hs_meeting_title", "hs_meeting_body", "hs_timestamp", "hubspot_owner_id"], body: (p) => p.hs_meeting_title ?? p.hs_meeting_body ?? "" },
];

const stripHtml = (s: string) => s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

// ── pull ─────────────────────────────────────────────────────────────────────

async function pullFromHubSpot(hs: ReturnType<typeof hsFetch>, db: ReturnType<typeof createClient>) {
  // 1. All open deals (paginated search).
  const deals: Array<{ id: string; properties: Record<string, string | null> }> = [];
  let after: string | undefined;
  do {
    const page = await hs("/crm/v3/objects/deals/search", {
      method: "POST",
      body: JSON.stringify({
        filterGroups: [{ filters: [{ propertyName: "hs_is_closed", operator: "EQ", value: "false" }] }],
        properties: [
          "dealname", "amount", "dealstage", "pipeline", "closedate",
          "hubspot_owner_id", "dealtype", "hs_deal_stage_probability", "createdate",
        ],
        limit: 100,
        ...(after ? { after } : {}),
      }),
    });
    deals.push(...(page.results ?? []));
    after = page.paging?.next?.after;
  } while (after && deals.length < 1000);

  // 2. Owners id → name/email. Tolerated failure: the token may lack the
  //    owners scope; the field still works with unattributed owners.
  const owners = new Map<string, { name: string; email: string }>();
  try {
    let ownerAfter: string | undefined;
    do {
      const page = await hs(`/crm/v3/owners/?limit=100${ownerAfter ? `&after=${ownerAfter}` : ""}`);
      for (const o of page.results ?? []) {
        owners.set(String(o.id), {
          name: [o.firstName, o.lastName].filter(Boolean).join(" ") || o.email || "Unassigned",
          email: o.email ?? "",
        });
      }
      ownerAfter = page.paging?.next?.after;
    } while (ownerAfter);
  } catch (err) {
    console.warn("[opportunity-sync] owners lookup unavailable:", err instanceof Error ? err.message : err);
  }

  // 3. Associated company name per deal.
  const dealIds = deals.map((d) => d.id);
  const companyIdByDeal = new Map<string, string>();
  for (const ids of chunk(dealIds, 100)) {
    const assoc = await hs("/crm/v4/associations/deals/companies/batch/read", {
      method: "POST",
      body: JSON.stringify({ inputs: ids.map((id) => ({ id })) }),
    });
    for (const r of assoc.results ?? []) {
      const first = r.to?.[0]?.toObjectId;
      if (first) companyIdByDeal.set(String(r.from.id), String(first));
    }
  }
  const companyNames = new Map<string, string>();
  const companyIds = [...new Set(companyIdByDeal.values())];
  for (const ids of chunk(companyIds, 100)) {
    const companies = await hs("/crm/v3/objects/companies/batch/read", {
      method: "POST",
      body: JSON.stringify({ inputs: ids.map((id) => ({ id })), properties: ["name"] }),
    });
    for (const c of companies.results ?? []) companyNames.set(String(c.id), c.properties?.name ?? "");
  }

  // 4. Upsert opportunities. is_parked is deliberately absent — parking is
  //    portal state and survives every sync.
  const nowIso = new Date().toISOString();
  const rows = deals.map((d) => {
    const p = d.properties;
    const owner = p.hubspot_owner_id ? owners.get(String(p.hubspot_owner_id)) : undefined;
    const probability = p.hs_deal_stage_probability != null ? Number(p.hs_deal_stage_probability) : null;
    return {
      hubspot_deal_id: d.id,
      deal_name: p.dealname ?? "(unnamed deal)",
      account_name: companyNames.get(companyIdByDeal.get(d.id) ?? "") || p.dealname || "",
      amount: p.amount != null && p.amount !== "" ? Number(p.amount) : null,
      probability: probability != null && Number.isFinite(probability) ? Math.min(1, Math.max(0, probability)) : null,
      expected_close_date: p.closedate ? p.closedate.slice(0, 10) : null,
      owner_name: owner?.name ?? null,
      owner_email: owner?.email ?? null,
      stage: p.dealstage ?? null,
      division: p.dealtype ? DIVISION_BY_DEALTYPE[p.dealtype] ?? null : null,
      is_open: true,
      hubspot_created_at: p.createdate ?? null,
      last_synced_at: nowIso,
    };
  });
  if (rows.length > 0) {
    const { error } = await db.from("opportunities").upsert(rows, { onConflict: "hubspot_deal_id" });
    if (error) throw new Error(`upsert opportunities: ${error.message}`);
  }

  // 5. Deals that closed since last sync leave the field.
  const { data: localOpen, error: openErr } = await db
    .from("opportunities").select("id, hubspot_deal_id").eq("is_open", true);
  if (openErr) throw new Error(openErr.message);
  const openSet = new Set(dealIds);
  const closedLocal = (localOpen ?? []).filter((r) => !openSet.has(r.hubspot_deal_id));
  if (closedLocal.length > 0) {
    await db.from("opportunities").update({ is_open: false, last_synced_at: nowIso })
      .in("id", closedLocal.map((r) => r.id));
  }

  // Map hubspot deal id → local opportunity id.
  const { data: allOpps } = await db.from("opportunities").select("id, hubspot_deal_id").eq("is_open", true);
  const localIdByDeal = new Map((allOpps ?? []).map((r) => [r.hubspot_deal_id, r.id]));

  // 6. Engagements per open deal — the register is the only source of truth
  //    for bubble size, so an activity logged on a phone in HubSpot lands here
  //    and deflates the bubble with no portal action.
  let activityCount = 0;
  const scopeWarnings: string[] = [];
  for (const spec of ENGAGEMENT_OBJECTS) {
    try {
    const engagementIdsByDeal = new Map<string, string[]>();
    for (const ids of chunk(dealIds, 100)) {
      const assoc = await hs(`/crm/v4/associations/deals/${spec.object}/batch/read`, {
        method: "POST",
        body: JSON.stringify({ inputs: ids.map((id) => ({ id })) }),
      });
      for (const r of assoc.results ?? []) {
        engagementIdsByDeal.set(
          String(r.from.id),
          (r.to ?? []).map((t: { toObjectId: number }) => String(t.toObjectId)),
        );
      }
    }
    const allEngagementIds = [...new Set([...engagementIdsByDeal.values()].flat())];
    const engagementById = new Map<string, Record<string, string | null>>();
    for (const ids of chunk(allEngagementIds, 100)) {
      const objs = await hs(`/crm/v3/objects/${spec.object}/batch/read`, {
        method: "POST",
        body: JSON.stringify({ inputs: ids.map((id) => ({ id })), properties: spec.properties }),
      });
      for (const o of objs.results ?? []) engagementById.set(String(o.id), o.properties ?? {});
    }

    const activityRows = [];
    for (const [dealId, engIds] of engagementIdsByDeal) {
      const oppId = localIdByDeal.get(dealId);
      if (!oppId) continue;
      for (const engId of engIds) {
        const p = engagementById.get(engId);
        if (!p?.hs_timestamp) continue;
        const owner = p.hubspot_owner_id ? owners.get(String(p.hubspot_owner_id)) : undefined;
        activityRows.push({
          opportunity_id: oppId,
          hubspot_engagement_id: `${spec.type}:${engId}`,
          type: spec.type,
          note: stripHtml(spec.body(p)).slice(0, 2000) || null,
          owner_name: owner?.name ?? null,
          occurred_at: p.hs_timestamp,
        });
      }
    }
    for (const batch of chunk(activityRows, 500)) {
      const { error } = await db.from("opportunity_activities")
        .upsert(batch, { onConflict: "hubspot_engagement_id" });
      if (error) throw new Error(`upsert activities (${spec.object}): ${error.message}`);
      activityCount += batch.length;
    }
    } catch (err) {
      // Missing per-object scope must not sink the whole pull — record and move on.
      const msg = err instanceof Error ? err.message : String(err);
      scopeWarnings.push(`${spec.object}: ${msg.slice(0, 160)}`);
      console.warn(`[opportunity-sync] ${spec.object} skipped:`, msg);
    }
  }

  // 7. Reconcile linked task state back to HubSpot (covers completions made in
  //    the tasks app, where no HubSpot push runs).
  const { data: links } = await db
    .from("opportunity_task_sync")
    .select("staff_task_id, hubspot_task_id, last_pushed_status, staff_tasks(status, title, due_date)");
  for (const link of links ?? []) {
    const task = link.staff_tasks as { status: string; title: string; due_date: string | null } | null;
    if (!task || !link.hubspot_task_id || task.status === link.last_pushed_status) continue;
    try {
      await hs(`/crm/v3/objects/tasks/${link.hubspot_task_id}`, {
        method: "PATCH",
        body: JSON.stringify({
          properties: {
            hs_task_status: task.status === "done" ? "COMPLETED" : "NOT_STARTED",
            hs_task_subject: task.title,
            ...(task.due_date ? { hs_timestamp: new Date(`${task.due_date}T09:00:00`).getTime() } : {}),
          },
        }),
      });
      await db.from("opportunity_task_sync")
        .update({ last_pushed_status: task.status, updated_at: nowIso })
        .eq("staff_task_id", link.staff_task_id);
    } catch (err) {
      console.error("[opportunity-sync] task reconcile failed:", err);
    }
  }

  return {
    synced: rows.length,
    closed: closedLocal.length,
    activities: activityCount,
    ...(scopeWarnings.length > 0 ? { warnings: scopeWarnings } : {}),
  };
}

// ── writes ───────────────────────────────────────────────────────────────────

async function associate(hs: ReturnType<typeof hsFetch>, object: string, objectId: string, dealId: string, assocType: string) {
  await hs(`/crm/v3/objects/${object}/${objectId}/associations/deals/${dealId}/${assocType}`, { method: "PUT" });
}

async function logActivity(
  hs: ReturnType<typeof hsFetch>,
  db: ReturnType<typeof createClient>,
  body: { opportunity_id: string; type: string; note: string; owner_name?: string },
) {
  const { data: opp, error } = await db.from("opportunities")
    .select("id, hubspot_deal_id").eq("id", body.opportunity_id).single();
  if (error || !opp) return json({ error: "Opportunity not found" }, 404);

  const nowIso = new Date().toISOString();
  let engagementId: string;
  let engagementRef: string;

  // HubSpot first — the CRM is the system of record.
  if (body.type === "call") {
    const call = await hs("/crm/v3/objects/calls", {
      method: "POST",
      body: JSON.stringify({ properties: { hs_call_body: body.note, hs_timestamp: nowIso } }),
    });
    engagementId = String(call.id);
    engagementRef = `call:${engagementId}`;
    await associate(hs, "calls", engagementId, opp.hubspot_deal_id, "call_to_deal");
  } else {
    // Notes carry note/email/meeting entries — writing real email/meeting
    // engagements needs required fields the panel doesn't collect.
    const prefix = body.type === "note" ? "" : `[${body.type[0].toUpperCase()}${body.type.slice(1)}] `;
    const note = await hs("/crm/v3/objects/notes", {
      method: "POST",
      body: JSON.stringify({ properties: { hs_note_body: `${prefix}${body.note}`, hs_timestamp: nowIso } }),
    });
    engagementId = String(note.id);
    engagementRef = `note:${engagementId}`;
    await associate(hs, "notes", engagementId, opp.hubspot_deal_id, "note_to_deal");
  }

  // Only now reflect locally.
  const { data: activity, error: insErr } = await db.from("opportunity_activities")
    .insert({
      opportunity_id: opp.id,
      hubspot_engagement_id: engagementRef,
      type: body.type,
      note: body.note,
      owner_name: body.owner_name ?? null,
      occurred_at: nowIso,
    })
    .select().single();
  if (insErr) return json({ error: `Saved to HubSpot but local reflect failed: ${insErr.message}` }, 500);
  return json({ activity });
}

async function createTask(
  hs: ReturnType<typeof hsFetch>,
  db: ReturnType<typeof createClient>,
  body: {
    opportunity_id: string; title: string; description?: string | null;
    due_date?: string | null; assigned_to: string; created_by: string;
  },
) {
  const { data: opp, error } = await db.from("opportunities")
    .select("id, hubspot_deal_id, account_name, deal_name").eq("id", body.opportunity_id).single();
  if (error || !opp) return json({ error: "Opportunity not found" }, 404);

  // Title carries the account so the row reads sensibly inside the tasks app.
  const title = opp.account_name && !body.title.includes(opp.account_name)
    ? `${body.title} — ${opp.account_name}`
    : body.title;
  const dueMs = body.due_date
    ? new Date(`${body.due_date}T09:00:00`).getTime()
    : Date.now() + 7 * 86_400_000;

  // HubSpot first.
  const hsTask = await hs("/crm/v3/objects/tasks", {
    method: "POST",
    body: JSON.stringify({
      properties: {
        hs_task_subject: title,
        hs_task_body: body.description || `Opportunity: ${opp.deal_name} (${opp.account_name})`,
        hs_timestamp: dueMs,
        hs_task_status: "NOT_STARTED",
        hs_task_type: "TODO",
      },
    }),
  });
  await associate(hs, "tasks", String(hsTask.id), opp.hubspot_deal_id, "task_to_deal");

  // The ONE task row — same table, same row, the tasks app renders.
  const { data: task, error: taskErr } = await db.from("staff_tasks")
    .insert({
      title,
      description: body.description || `Opportunity: ${opp.deal_name} (${opp.account_name})`,
      status: "not_started",
      assigned_to: body.assigned_to,
      created_by: body.created_by,
      due_date: body.due_date ?? null,
      opportunity_id: opp.id,
    })
    .select().single();
  if (taskErr) return json({ error: `Saved to HubSpot but task insert failed: ${taskErr.message}` }, 500);

  await db.from("opportunity_task_sync").insert({
    staff_task_id: task.id,
    opportunity_id: opp.id,
    hubspot_task_id: String(hsTask.id),
    last_pushed_status: "not_started",
  });

  return json({ task });
}

async function pushTaskStatus(
  hs: ReturnType<typeof hsFetch>,
  db: ReturnType<typeof createClient>,
  body: { staff_task_id: string },
) {
  const { data: link } = await db.from("opportunity_task_sync")
    .select("staff_task_id, hubspot_task_id").eq("staff_task_id", body.staff_task_id).single();
  const { data: task } = await db.from("staff_tasks")
    .select("status").eq("id", body.staff_task_id).single();
  if (!link?.hubspot_task_id || !task) return json({ ok: false });

  await hs(`/crm/v3/objects/tasks/${link.hubspot_task_id}`, {
    method: "PATCH",
    body: JSON.stringify({
      properties: { hs_task_status: task.status === "done" ? "COMPLETED" : "NOT_STARTED" },
    }),
  });
  await db.from("opportunity_task_sync")
    .update({ last_pushed_status: task.status, updated_at: new Date().toISOString() })
    .eq("staff_task_id", body.staff_task_id);
  return json({ ok: true });
}

// ── router ───────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const token = Deno.env.get("HUBSPOT_ACCESS_TOKEN");
  if (!token) {
    return json({ error: "Add HUBSPOT_ACCESS_TOKEN to your Supabase edge function secrets." }, 500);
  }
  const hs = hsFetch(token);
  const db = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  let body: Record<string, unknown> = {};
  try {
    body = req.method === "POST" ? await req.json() : {};
  } catch {
    body = {};
  }
  const action = (body.action as string) ?? "pull";

  try {
    switch (action) {
      case "pull":
        return json(await pullFromHubSpot(hs, db));
      case "log_activity":
        return await logActivity(hs, db, body as Parameters<typeof logActivity>[2]);
      case "create_task":
        return await createTask(hs, db, body as Parameters<typeof createTask>[2]);
      case "push_task_status":
        return await pushTaskStatus(hs, db, body as Parameters<typeof pushTaskStatus>[2]);
      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (err) {
    console.error("[opportunity-sync]", err);
    return json({ error: err instanceof Error ? err.message : "Sync failed" }, 502);
  }
});
