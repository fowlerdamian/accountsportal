import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function truncate(text: string | undefined | null, max: number): string {
  if (!text) return "";
  return text.length > max ? text.slice(0, max) + "…" : text;
}

async function sendToChat(text: string): Promise<void> {
  const webhookUrl = Deno.env.get("CONTRACTOR_HUB_GCHAT_WEBHOOK");
  if (!webhookUrl) {
    console.warn("[hub-notifications] CONTRACTOR_HUB_GCHAT_WEBHOOK not set");
    return;
  }
  await fetch(webhookUrl, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ text }),
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const payload = await req.json();
    const { type } = payload;

    // ── Overdue tasks cron ───────────────────────────────────────────────────
    if (type === "overdue_check") {
      const serviceClient = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      );
      const today = new Date().toISOString().split("T")[0];
      const { data: tasks } = await serviceClient
        .from("tasks")
        .select("title, due_date, projects(name), contractors(name)")
        .lt("due_date", today)
        .neq("status", "done")
        .order("due_date")
        .limit(10);

      if (!tasks || tasks.length === 0) {
        return new Response(JSON.stringify({ ok: true, skipped: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const list = tasks
        .slice(0, 5)
        .map((t: any) => {
          const project = (t.projects as any)?.name ?? "Unknown project";
          const name    = (t.contractors as any)?.name ?? "Unassigned";
          const days    = Math.round(
            (new Date(today).getTime() - new Date(t.due_date).getTime()) / 86400000,
          );
          return `  • ${t.title} (${name}, ${project}, ${days}d late)`;
        })
        .join("\n");

      const more = tasks.length > 5 ? `\n  +${tasks.length - 5} more` : "";
      await sendToChat(`⚠️ *${tasks.length} overdue task${tasks.length === 1 ? "" : "s"}*\n${list}${more}`);

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Task status changed ──────────────────────────────────────────────────
    if (type === "task_status_changed") {
      const { task_title, status, author, project_name, project_id } = payload;
      const projectUrl = `https://app.automotivegroup.com.au/hub/projects/${project_id}`;
      await sendToChat(
        `📋 *${task_title}* moved to *${status}* by ${author} on <${projectUrl}|${project_name}>`,
      );
    }

    // ── Activity posted ──────────────────────────────────────────────────────
    else if (type === "activity_posted") {
      const { author, project_name, project_id, content } = payload;
      const projectUrl = `https://app.automotivegroup.com.au/hub/projects/${project_id}`;
      await sendToChat(
        `💬 *${author}* posted on <${projectUrl}|${project_name}>: ${truncate(content, 100)}`,
      );
    }

    // ── Budget threshold ─────────────────────────────────────────────────────
    else if (type === "budget_threshold") {
      const { project_name, project_id, pct } = payload;
      const projectUrl = `https://app.automotivegroup.com.au/hub/projects/${project_id}`;
      await sendToChat(
        `💰 <${projectUrl}|${project_name}> has reached *${pct}% budget utilisation*`,
      );
    }

    // ── Upwork message received ──────────────────────────────────────────────
    else if (type === "upwork_message") {
      const { contractor_name, project_name, project_id, content } = payload;
      const projectUrl = `https://app.automotivegroup.com.au/hub/projects/${project_id}`;
      await sendToChat(
        `📨 *Upwork message from ${contractor_name}* on <${projectUrl}|${project_name}>: ${truncate(content, 100)}`,
      );
    }

    // ── AI assistant action (from AiAssistantPanel) ──────────────────────────
    else if (type === "task_status") {
      const { tr } = payload as { tr: { tool: string; input: Record<string, unknown>; result: Record<string, unknown> } };
      if (tr?.result && !(tr.result as any).error) {
        const task = (tr.result as any).task ?? {};
        if (task.title && task.status) {
          const projectId = task.project_id ?? "";
          const projectUrl = `https://app.automotivegroup.com.au/hub/projects/${projectId}`;
          const verb = tr.tool === "create_task" ? "created" : "updated";
          await sendToChat(
            `📋 Task *${task.title}* ${verb} → *${task.status}* (<${projectUrl}|view project>)`,
          );
        }
      }
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[hub-notifications]", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
