/**
 * Daily Focus Digest — personalised "Today's Focus" to each staff member's
 * Google Chat space.
 *
 * For every profile that has a `google_chat_webhook_url`, gathers that person's
 * support-hub work — open staff_tasks, support cases they own, and action items
 * assigned to them — asks Claude to write a short prioritised focus update, and
 * posts it to their webhook. Runs twice daily (8am & 3pm AEST) via pg_cron.
 *
 * Body:
 *   { "dry_run": true }            -> generate + return text, don't post
 *   { "only_user_id": "<uuid>" }   -> limit to one profile (testing)
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";

const sb = createClient(SUPABASE_URL, SERVICE_KEY);

interface Profile {
  id: string;
  full_name: string | null;
  email: string | null;
  google_chat_webhook_url: string | null;
}

interface Task {
  title: string;
  ai_summary: string | null;
  status: string;
  urgency: number | null;
  importance: number | null;
  due_date: string | null;
  description: string | null;
}

interface CaseRow {
  title: string | null;
  status: string | null;
  priority: string | null;
}

interface ActionItem {
  description: string | null;
  status: string | null;
  priority: string | null;
  due_date: string | null;
}

interface FocusData {
  tasks: Task[];
  cases: CaseRow[];
  actions: ActionItem[];
}

// Brisbane (AEST, UTC+10, no DST).
function brisbaneNow(): Date {
  return new Date(Date.now() + 10 * 60 * 60 * 1000);
}
function todayISO(): string {
  return brisbaneNow().toISOString().split("T")[0];
}
function slotLabel(): "morning" | "afternoon" {
  return brisbaneNow().getUTCHours() < 12 ? "morning" : "afternoon";
}

async function generateFocus(profile: Profile, data: FocusData): Promise<string> {
  const name = (profile.full_name || profile.email || "there").split(" ")[0];
  const today = todayISO();
  const slot = slotLabel();
  const greeting = slot === "morning" ? "kick off the day" : "afternoon check-in";

  const total = data.tasks.length + data.cases.length + data.actions.length;
  if (total === 0) {
    return `*Today's Focus — ${name}* _(${slot})_\n\nNothing open across your tasks, cases or action items right now — clear runway. Good time to get ahead. 🚀`;
  }

  const tasksJson = data.tasks.map((t) => ({
    item: t.ai_summary || t.title, status: t.status, urgency: t.urgency, importance: t.importance, due: t.due_date,
  }));
  const casesJson = data.cases.map((c) => ({ case: c.title, status: c.status, priority: c.priority }));
  const actionsJson = data.actions.map((a) => ({ action: a.description, status: a.status, priority: a.priority, due: a.due_date }));

  if (!ANTHROPIC_KEY) {
    const lines: string[] = [];
    data.tasks.slice(0, 4).forEach((t) => lines.push(`- ${t.ai_summary || t.title}${t.due_date ? ` _(due ${t.due_date})_` : ""}`));
    data.cases.slice(0, 3).forEach((c) => lines.push(`- *Case:* ${c.title}`));
    data.actions.slice(0, 3).forEach((a) => lines.push(`- *Action:* ${a.description}`));
    return `*Today's Focus — ${name}*\n\n${lines.join("\n")}`;
  }

  const prompt =
    `You are a sharp personal assistant writing a brief Google Chat focus update for ${name} to ${greeting}. ` +
    `Today is ${today}. This is a Support Hub digest spanning their tasks, support cases, and action items.\n\n` +
    `TASKS (urgency/importance 1-5, higher = more pressing):\n${JSON.stringify(tasksJson, null, 2)}\n\n` +
    `OPEN SUPPORT CASES they own:\n${JSON.stringify(casesJson, null, 2)}\n\n` +
    `ACTION ITEMS assigned to them:\n${JSON.stringify(actionsJson, null, 2)}\n\n` +
    `Write a short, scannable update across ALL of the above:\n` +
    `- Start with "*Today's Focus — ${name}*" and a one-line greeting.\n` +
    `- Give a single prioritised shortlist of the 3-6 most important things to focus on now, drawing from tasks, cases AND action items. Label each so it's clear which area it's from (e.g. prefix cases with "Case:" and action items with "Action:").\n` +
    `- Call out anything overdue or due today first.\n` +
    `- End with one short encouraging line.\n` +
    `Use Google Chat formatting ONLY: *bold*, _italic_, and "- " bullets. No markdown headings (#), no tables, no code blocks. ` +
    `Keep it under 1400 characters. Output only the message text.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 600,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const lines = data.tasks.slice(0, 5).map((t) => `- ${t.ai_summary || t.title}`);
    return `*Today's Focus — ${name}*\n\n${lines.join("\n")}`;
  }
  const resp = await res.json();
  return (resp.content?.[0]?.text?.trim() as string) || `*Today's Focus — ${name}*`;
}

async function postToChat(webhook: string, text: string): Promise<boolean> {
  const res = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    console.error(`gchat post failed ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return false;
  }
  return true;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Service-role only: this endpoint posts to staff Google Chat spaces and
  // spends AI tokens — it must not be invocable with the public anon key.
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!SERVICE_KEY || bearer !== SERVICE_KEY) {
    return new Response(JSON.stringify({ ok: false, error: "Forbidden" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const dryRun = body?.dry_run === true;
    const onlyUserId: string | undefined = body?.only_user_id;

    let query = sb
      .from("profiles")
      .select("id, full_name, email, google_chat_webhook_url")
      .not("google_chat_webhook_url", "is", null);
    if (onlyUserId) query = query.eq("id", onlyUserId);

    const { data: profiles, error } = await query;
    if (error) throw error;

    const recipients = (profiles ?? []).filter((p: Profile) => (p.google_chat_webhook_url ?? "").trim().length > 0);

    const results: { name: string; tasks: number; posted: boolean; text?: string }[] = [];

    for (const profile of recipients as Profile[]) {
      // Per-profile isolation: one bad webhook / fetch failure must never stop
      // the remaining staff from getting their digest.
      try {
      const [taskRes, caseRes, actionRes] = await Promise.all([
        sb.from("staff_tasks")
          .select("title, ai_summary, status, urgency, importance, due_date, description")
          .eq("assigned_to", profile.id)
          .neq("status", "done")
          .order("importance", { ascending: false, nullsFirst: false })
          .order("urgency", { ascending: false, nullsFirst: false })
          .order("due_date", { ascending: true, nullsFirst: false }),
        sb.from("cases")
          .select("title, status, priority")
          .eq("user_id", profile.id)
          .neq("status", "closed"),
        sb.from("action_items")
          .select("description, status, priority, due_date")
          .eq("assigned_to_email", profile.email ?? "__none__")
          .neq("status", "done"),
      ]);

      const data: FocusData = {
        tasks: (taskRes.data ?? []) as Task[],
        cases: (caseRes.data ?? []) as CaseRow[],
        actions: (actionRes.data ?? []) as ActionItem[],
      };
      const itemCount = data.tasks.length + data.cases.length + data.actions.length;

      const text = await generateFocus(profile, data);
      let posted = false;
      if (!dryRun) posted = await postToChat(profile.google_chat_webhook_url!, text);

      results.push({
        name: profile.full_name || profile.email || profile.id,
        tasks: itemCount,
        posted,
        ...(dryRun ? { text } : {}),
      });
      } catch (profileErr) {
        console.error(`daily-focus-digest: failed for ${profile.email ?? profile.id}:`, profileErr);
        results.push({ name: profile.full_name || profile.email || profile.id, tasks: 0, posted: false });
      }
    }

    return new Response(
      JSON.stringify({ ok: true, slot: slotLabel(), dry_run: dryRun, recipients: results.length, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("daily-focus-digest error:", err);
    return new Response(
      JSON.stringify({ ok: false, error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
