// @mention → staff task.
//
// Called fire-and-forget from src/utils/mentionTasks.ts whenever a comment,
// chat message, or note is submitted anywhere in the portal. Resolves @Name
// mentions against profiles, composes a task title + description from the
// submitted text and the user's current screen content (Claude Haiku, with a
// deterministic fallback), inserts a staff_tasks row per mentioned person,
// and pings them via the portal's /api/notify-task-assignee endpoint.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PORTAL_URL = Deno.env.get("PORTAL_URL") ?? "https://app.automotivegroup.com.au";

interface Profile {
  id: string;
  full_name: string | null;
  email: string | null;
}

interface ComposedTask {
  title: string;
  description: string | null;
  urgency: number | null;
  importance: number | null;
}

// ── Mention parsing ───────────────────────────────────────────────────────────
// Accepts "@john", "@John", "@John Smith". Tries the full two-word token
// against full names first, then falls back to first-name / email-prefix.
// Ambiguous first names are skipped (reported in `notes`) rather than guessed.

function parseMentions(text: string, profiles: Profile[], authorId: string | null) {
  const re = /@([A-Za-z][A-Za-z'’-]*(?:[ ][A-Za-z][A-Za-z'’-]*)?)/g;
  const found = new Map<string, Profile>();
  const notes: string[] = [];

  for (const match of text.matchAll(re)) {
    const raw = match[1];
    const full = raw.toLowerCase().trim();
    const first = full.split(" ")[0];

    let matches = profiles.filter((p) => (p.full_name ?? "").toLowerCase() === full);
    if (matches.length === 0) {
      matches = profiles.filter((p) => (p.full_name ?? "").toLowerCase().startsWith(full));
    }
    if (matches.length === 0) {
      matches = profiles.filter((p) =>
        (p.full_name ?? "").toLowerCase().split(" ")[0] === first ||
        (p.email ?? "").toLowerCase().split("@")[0] === first
      );
    }

    if (matches.length === 1) {
      if (matches[0].id !== authorId) found.set(matches[0].id, matches[0]);
    } else if (matches.length > 1) {
      notes.push(`"@${raw}" is ambiguous (${matches.map((p) => p.full_name).join(", ")}) — no task created`);
    }
  }
  return { recipients: [...found.values()], notes };
}

// ── Task composition ──────────────────────────────────────────────────────────

function fallbackTask(text: string, source: { label?: string; url?: string }): ComposedTask {
  const firstLine = text.replace(/\s+/g, " ").trim();
  return {
    title:       firstLine.length > 70 ? `${firstLine.slice(0, 67)}…` : firstLine,
    description: [source.label, source.url, "", text].filter((s) => s !== undefined).join("\n"),
    urgency:     null,
    importance:  null,
  };
}

async function composeTask(
  anthropicKey: string,
  args: { text: string; authorName: string; assigneeName: string; source: { label?: string; url?: string }; screen?: { path?: string; title?: string; text?: string } },
): Promise<ComposedTask> {
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 500,
        system: `You turn an @mention into a staff task. ${args.authorName} mentioned ${args.assigneeName} in: ${args.source.label ?? "the staff portal"}. Write the task FOR ${args.assigneeName} — a short specific title (max 70 chars, no @names) and a description that captures what they need to do plus the concrete context (IDs, customers, products, amounts) from the message and the screen content. Also rate urgency and importance 1-5. Respond ONLY with JSON: {"title": "...", "description": "...", "urgency": n, "importance": n}`,
        messages: [{
          role: "user",
          content: `Message containing the mention:\n${args.text}\n\nScreen the author was looking at (path ${args.screen?.path ?? "unknown"}, page "${args.screen?.title ?? "unknown"}"):\n${String(args.screen?.text ?? "").slice(0, 6000) || "(not captured)"}`,
        }],
      }),
    });
    if (!response.ok) throw new Error(await response.text());
    const result = await response.json();
    const raw = result.content?.find((b: { type: string }) => b.type === "text")?.text ?? "";
    const json = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
    if (!json.title) throw new Error("no title");
    return {
      title:       String(json.title).slice(0, 120),
      description: json.description ? `${json.description}\n\n— From ${args.authorName} via ${args.source.label ?? "the portal"}${args.source.url ? ` (${args.source.url})` : ""}` : null,
      urgency:     Number.isInteger(json.urgency) ? json.urgency : null,
      importance:  Number.isInteger(json.importance) ? json.importance : null,
    };
  } catch (err) {
    console.warn("[mention-to-task] compose fallback:", err);
    return fallbackTask(args.text, args.source);
  }
}

// Tasks created server-side bypass the client's regenerateSummary() hook, so
// the dock pill would show "…" forever — queue the summary ourselves.
function queueTaskSummary(taskId: string): void {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return;
  const work = fetch(`${url}/functions/v1/generate-task-summary`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${key}` },
    body: JSON.stringify({ task_id: taskId }),
  }).catch((err) => console.warn("[mention-to-task] summary failed:", err));
  (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime?.waitUntil?.(work);
}

// ── Handler ───────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { text, source = {}, screen, userEmail } = await req.json() as {
      text: string;
      source?: { label?: string; url?: string };
      screen?: { path?: string; title?: string; text?: string };
      userEmail?: string;
    };

    if (!text || !userEmail) {
      return new Response(
        JSON.stringify({ created: [], notes: ["text and userEmail are required"] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: profileRows } = await sb.from("profiles").select("id, full_name, email");
    const profiles = (profileRows ?? []) as Profile[];
    const author = profiles.find((p) => (p.email ?? "").toLowerCase() === userEmail.toLowerCase()) ?? null;
    const authorName = author?.full_name ?? userEmail;

    const { recipients, notes } = parseMentions(text, profiles, author?.id ?? null);
    if (recipients.length === 0) {
      return new Response(
        JSON.stringify({ created: [], notes }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (!author) {
      return new Response(
        JSON.stringify({ created: [], notes: [`No staff profile for ${userEmail} — cannot create tasks`] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
    const userJwt = req.headers.get("Authorization");
    const created: { task_id: string; title: string; assignee: string }[] = [];

    for (const recipient of recipients) {
      const composed = anthropicKey
        ? await composeTask(anthropicKey, { text, authorName, assigneeName: recipient.full_name ?? "them", source, screen })
        : fallbackTask(text, source);

      const { data: task, error } = await sb.from("staff_tasks").insert({
        title:       composed.title,
        description: composed.description ?? null,
        assigned_to: recipient.id,
        created_by:  author.id,
        due_date:    null,
        urgency:     composed.urgency,
        importance:  composed.importance,
        status:      "not_started",
      }).select("id, title").single();

      if (error) {
        notes.push(`Task for ${recipient.full_name} failed: ${error.message}`);
        continue;
      }

      created.push({ task_id: task.id, title: task.title, assignee: recipient.full_name ?? recipient.email ?? "staff" });
      queueTaskSummary(task.id);

      if (userJwt) {
        fetch(`${PORTAL_URL}/api/notify-task-assignee`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: userJwt },
          body: JSON.stringify({
            task_id:      task.id,
            recipient_id: recipient.id,
            event:        "assigned",
            task_title:   task.title,
            actor_name:   authorName,
          }),
        }).catch((err) => console.warn("[mention-to-task] notify failed:", err));
      }
    }

    return new Response(
      JSON.stringify({ created, notes }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[mention-to-task]", err);
    return new Response(
      JSON.stringify({ created: [], notes: [String(err)] }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
