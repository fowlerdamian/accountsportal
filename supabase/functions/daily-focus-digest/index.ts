/**
 * Daily Focus Digest — personalised "Today's Focus" to each staff member's
 * Google Chat space.
 *
 * For every profile that has a `google_chat_webhook_url`, gathers that person's
 * open staff_tasks, asks Claude to write a short prioritised focus update, and
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

async function generateFocus(profile: Profile, tasks: Task[]): Promise<string> {
  const name = (profile.full_name || profile.email || "there").split(" ")[0];
  const today = todayISO();
  const slot = slotLabel();
  const greeting = slot === "morning" ? "kick off the day" : "afternoon check-in";

  if (tasks.length === 0) {
    return `*Today's Focus — ${name}* _(${slot})_\n\nNo open tasks assigned right now — clear runway. Good time to pick up something new or get ahead. 🚀`;
  }

  if (!ANTHROPIC_KEY) {
    // Fallback without AI: list the top few tasks.
    const lines = tasks.slice(0, 5).map((t) => `- ${t.ai_summary || t.title}${t.due_date ? ` _(due ${t.due_date})_` : ""}`);
    return `*Today's Focus — ${name}*\n\n${lines.join("\n")}`;
  }

  const taskJson = tasks.map((t) => ({
    name: t.ai_summary || t.title,
    status: t.status,
    urgency: t.urgency,
    importance: t.importance,
    due: t.due_date,
  }));

  const prompt =
    `You are a sharp personal assistant writing a brief Google Chat focus update for ${name} to ${greeting}. ` +
    `Today is ${today}.\n\n` +
    `Their open tasks (JSON; urgency/importance are 1-5, higher = more pressing):\n` +
    `${JSON.stringify(taskJson, null, 2)}\n\n` +
    `Write a short, scannable update:\n` +
    `- Start with a one-line greeting headed with "*Today's Focus — ${name}*".\n` +
    `- Then a prioritised shortlist of the 3-5 things to focus on now (most important/urgent first).\n` +
    `- Call out anything overdue or due today up front.\n` +
    `- End with one short encouraging line.\n` +
    `Use Google Chat formatting ONLY: *bold*, _italic_, and "- " bullets. No markdown headings (#), no tables, no code blocks. ` +
    `Keep it under 1200 characters. Output only the message text.`;

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
    const lines = tasks.slice(0, 5).map((t) => `- ${t.ai_summary || t.title}`);
    return `*Today's Focus — ${name}*\n\n${lines.join("\n")}`;
  }
  const data = await res.json();
  return (data.content?.[0]?.text?.trim() as string) || `*Today's Focus — ${name}*`;
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
      const { data: tasks } = await sb
        .from("staff_tasks")
        .select("title, ai_summary, status, urgency, importance, due_date, description")
        .eq("assigned_to", profile.id)
        .neq("status", "done")
        .order("importance", { ascending: false, nullsFirst: false })
        .order("urgency", { ascending: false, nullsFirst: false })
        .order("due_date", { ascending: true, nullsFirst: false });

      const text = await generateFocus(profile, (tasks ?? []) as Task[]);
      let posted = false;
      if (!dryRun) posted = await postToChat(profile.google_chat_webhook_url!, text);

      results.push({
        name: profile.full_name || profile.email || profile.id,
        tasks: tasks?.length ?? 0,
        posted,
        ...(dryRun ? { text } : {}),
      });
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
