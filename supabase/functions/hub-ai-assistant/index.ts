import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ─────────────────────────────────────────────────────────────────────────────
// Tool definitions
// ─────────────────────────────────────────────────────────────────────────────

const tools = [
  {
    name: "query_data",
    description:
      "Read contractors, projects, tasks, time entries, activity log, or budget summaries. " +
      "Use this to look up IDs, check current status, or gather context before acting.",
    input_schema: {
      type: "object",
      properties: {
        entity: {
          type: "string",
          enum: ["tasks", "projects", "contractors", "time_entries", "activity_log", "budget_summary"],
        },
        filters: {
          type: "object",
          description: 'Key-value filters e.g. {"project_id":"uuid","status":"in_progress"}',
        },
        overdue_only: {
          type: "boolean",
          description: "Return only tasks where due_date < today and status != done",
        },
        search: {
          type: "string",
          description: "Case-insensitive text search on name or title",
        },
        limit: { type: "number", description: "Max records (default 20)" },
      },
      required: ["entity"],
    },
  },
  {
    name: "create_task",
    description: "Create a new task or subtask on a project.",
    input_schema: {
      type: "object",
      properties: {
        project_id:     { type: "string" },
        title:          { type: "string" },
        description:    { type: "string" },
        assigned_to:    { type: "string", description: "Contractor UUID" },
        status:         { type: "string", enum: ["backlog", "in_progress", "review", "done"] },
        priority:       { type: "string", enum: ["low", "medium", "high", "urgent"] },
        due_date:       { type: "string", description: "YYYY-MM-DD" },
        parent_task_id: { type: "string", description: "UUID of parent task for subtasks" },
      },
      required: ["project_id", "title"],
    },
  },
  {
    name: "update_task",
    description: "Update a task — status, priority, due date, assignment, title, or description.",
    input_schema: {
      type: "object",
      properties: {
        task_id:     { type: "string" },
        title:       { type: "string" },
        description: { type: "string" },
        assigned_to: { type: "string", description: "Contractor UUID, or null to unassign" },
        status:      { type: "string", enum: ["backlog", "in_progress", "review", "done"] },
        priority:    { type: "string", enum: ["low", "medium", "high", "urgent"] },
        due_date:    { type: "string", description: "YYYY-MM-DD" },
      },
      required: ["task_id"],
    },
  },
  {
    name: "create_project",
    description: "Create a new project.",
    input_schema: {
      type: "object",
      properties: {
        name:             { type: "string" },
        description:      { type: "string" },
        type:             { type: "string", enum: ["product", "website", "other"] },
        status:           { type: "string", enum: ["planning", "active", "on_hold", "complete"] },
        budget_allocated: { type: "number" },
        start_date:       { type: "string" },
        due_date:         { type: "string" },
      },
      required: ["name"],
    },
  },
  {
    name: "update_project",
    description: "Update project fields — status, name, budget, dates, or description.",
    input_schema: {
      type: "object",
      properties: {
        project_id:       { type: "string" },
        name:             { type: "string" },
        description:      { type: "string" },
        type:             { type: "string", enum: ["product", "website", "other"] },
        status:           { type: "string", enum: ["planning", "active", "on_hold", "complete"] },
        budget_allocated: { type: "number" },
        start_date:       { type: "string" },
        due_date:         { type: "string" },
      },
      required: ["project_id"],
    },
  },
  {
    name: "log_time",
    description: "Log hours for a contractor on a project or task.",
    input_schema: {
      type: "object",
      properties: {
        contractor_id: { type: "string" },
        project_id:    { type: "string" },
        task_id:       { type: "string" },
        hours:         { type: "number" },
        date:          { type: "string", description: "YYYY-MM-DD, defaults to today" },
        description:   { type: "string" },
      },
      required: ["contractor_id", "project_id", "hours"],
    },
  },
  {
    name: "post_activity",
    description: "Post a note or update to a project's activity feed.",
    input_schema: {
      type: "object",
      properties: {
        project_id:    { type: "string" },
        contractor_id: { type: "string" },
        task_id:       { type: "string" },
        type:          { type: "string", enum: ["note", "update", "status_change"] },
        content:       { type: "string" },
      },
      required: ["project_id", "content"],
    },
  },
  {
    name: "update_contractor",
    description: "Update a contractor's status, hourly rate, role, or notes.",
    input_schema: {
      type: "object",
      properties: {
        contractor_id: { type: "string" },
        status:        { type: "string", enum: ["active", "paused", "ended"] },
        hourly_rate:   { type: "number" },
        notes:         { type: "string" },
        role:          { type: "string" },
      },
      required: ["contractor_id"],
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Tool execution
// ─────────────────────────────────────────────────────────────────────────────

async function executeTool(
  name: string,
  input: Record<string, unknown>,
  serviceClient: ReturnType<typeof createClient>,
  authorId: string,
  authorName: string,
  today: string,
): Promise<Record<string, unknown>> {
  try {
    switch (name) {
      case "query_data": {
        const { entity, filters = {}, overdue_only, search, limit = 20 } = input as any;
        const f = filters as Record<string, string>;

        if (entity === "budget_summary") {
          let q = serviceClient.from("project_budget_summary").select("*");
          if (f.project_id) q = q.eq("project_id", f.project_id);
          const { data, error } = await q;
          if (error) return { error: error.message };
          return { data };
        }

        if (entity === "tasks") {
          let q = serviceClient
            .from("tasks")
            .select("*, contractors(id, name), projects(id, name)")
            .order("due_date", { ascending: true, nullsFirst: false })
            .limit(limit);
          if (f.project_id)    q = q.eq("project_id", f.project_id);
          if (f.status)        q = q.eq("status", f.status);
          if (f.assigned_to)   q = q.eq("assigned_to", f.assigned_to);
          if (f.priority)      q = q.eq("priority", f.priority);
          if (f.id)            q = q.eq("id", f.id);
          if (overdue_only)    q = q.lt("due_date", today).neq("status", "done");
          if (search)          q = q.ilike("title", `%${search}%`);
          const { data, error } = await q;
          if (error) return { error: error.message };
          return { data };
        }

        if (entity === "projects") {
          let q = serviceClient.from("projects").select("*").order("created_at", { ascending: false }).limit(limit);
          if (f.status) q = q.eq("status", f.status);
          if (f.id)     q = q.eq("id", f.id);
          if (search)   q = q.ilike("name", `%${search}%`);
          const { data, error } = await q;
          if (error) return { error: error.message };
          return { data };
        }

        if (entity === "contractors") {
          let q = serviceClient.from("contractors").select("*").order("name").limit(limit);
          if (f.status) q = q.eq("status", f.status);
          if (f.source) q = q.eq("source", f.source);
          if (f.id)     q = q.eq("id", f.id);
          if (search)   q = q.ilike("name", `%${search}%`);
          const { data, error } = await q;
          if (error) return { error: error.message };
          return { data };
        }

        if (entity === "time_entries") {
          let q = serviceClient
            .from("time_entries_with_cost")
            .select("*, contractors(id, name), projects(id, name)")
            .order("date", { ascending: false })
            .limit(limit);
          if (f.project_id)    q = q.eq("project_id", f.project_id);
          if (f.contractor_id) q = q.eq("contractor_id", f.contractor_id);
          if (f.task_id)       q = q.eq("task_id", f.task_id);
          const { data, error } = await q;
          if (error) return { error: error.message };
          return { data };
        }

        if (entity === "activity_log") {
          let q = serviceClient
            .from("activity_log")
            .select("*, contractors(id, name), projects(id, name)")
            .order("created_at", { ascending: false })
            .limit(limit);
          if (f.project_id)    q = q.eq("project_id", f.project_id);
          if (f.contractor_id) q = q.eq("contractor_id", f.contractor_id);
          const { data, error } = await q;
          if (error) return { error: error.message };
          return { data };
        }

        return { error: `Unknown entity: ${entity}` };
      }

      case "create_task": {
        const { task_id: _ignored, ...payload } = input as any;
        const { data, error } = await serviceClient
          .from("tasks")
          .insert({ status: "backlog", priority: "medium", position: 999, ...payload })
          .select("*, contractors(id, name)")
          .single();
        if (error) return { error: error.message };
        return { task: data };
      }

      case "update_task": {
        const { task_id, ...updates } = input as any;
        const { data, error } = await serviceClient
          .from("tasks")
          .update(updates)
          .eq("id", task_id)
          .select("*, contractors(id, name)")
          .single();
        if (error) return { error: error.message };
        return { task: data };
      }

      case "create_project": {
        const { data, error } = await serviceClient
          .from("projects")
          .insert({ status: "planning", type: "other", ...input })
          .select()
          .single();
        if (error) return { error: error.message };
        return { project: data };
      }

      case "update_project": {
        const { project_id, ...updates } = input as any;
        const { data, error } = await serviceClient
          .from("projects")
          .update(updates)
          .eq("id", project_id)
          .select()
          .single();
        if (error) return { error: error.message };
        return { project: data };
      }

      case "log_time": {
        const payload = {
          source: "manual",
          date:   today,
          ...input,
        };
        const { data, error } = await serviceClient
          .from("time_entries")
          .insert(payload)
          .select()
          .single();
        if (error) return { error: error.message };

        // Fetch cost from the view
        const { data: withCost } = await serviceClient
          .from("time_entries_with_cost")
          .select("cost, hourly_rate")
          .eq("id", data.id)
          .single();

        return { entry: data, cost: withCost?.cost ?? null };
      }

      case "post_activity": {
        const payload = {
          type:         "note",
          author_id:    authorId,
          author_name:  authorName,
          ...input,
        };
        const { data, error } = await serviceClient
          .from("activity_log")
          .insert(payload)
          .select()
          .single();
        if (error) return { error: error.message };
        return { activity: data };
      }

      case "update_contractor": {
        const { contractor_id, ...updates } = input as any;
        const { data, error } = await serviceClient
          .from("contractors")
          .update(updates)
          .eq("id", contractor_id)
          .select()
          .single();
        if (error) return { error: error.message };
        return { contractor: data };
      }

      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (err) {
    return { error: (err as Error).message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Agentic loop — calls Claude, executes tool calls, loops until end_turn
// ─────────────────────────────────────────────────────────────────────────────

interface ToolResult {
  tool:   string;
  input:  Record<string, unknown>;
  result: Record<string, unknown>;
}

async function runAgentLoop(params: {
  messages:      { role: string; content: unknown }[];
  systemPrompt:  string;
  apiKey:        string;
  serviceClient: ReturnType<typeof createClient>;
  authorId:      string;
  authorName:    string;
  today:         string;
}): Promise<{ text: string; toolResults: ToolResult[] }> {
  const { messages, systemPrompt, apiKey, serviceClient, authorId, authorName, today } = params;
  const allToolResults: ToolResult[] = [];
  const loopMessages = [...messages];
  const MAX_ITERATIONS = 6;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type":    "application/json",
        "x-api-key":       apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model:      "claude-sonnet-4-20250514",
        max_tokens: 2048,
        system:     systemPrompt,
        tools,
        messages:   loopMessages,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Anthropic API error: ${response.status} ${errText}`);
    }

    const result = await response.json();
    const content = result.content ?? [];

    // Add assistant turn to messages
    loopMessages.push({ role: "assistant", content });

    if (result.stop_reason !== "tool_use") {
      // Done — extract text
      const text = content
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text)
        .join("\n")
        .trim();
      return { text: text || "Done.", toolResults: allToolResults };
    }

    // Execute all tool_use blocks in this turn
    const toolUseBlocks = content.filter((b: any) => b.type === "tool_use");
    const toolResultContents: unknown[] = [];

    for (const block of toolUseBlocks) {
      const toolResult = await executeTool(
        block.name,
        block.input,
        serviceClient,
        authorId,
        authorName,
        today,
      );

      // Only record non-query tools as visible action cards
      if (block.name !== "query_data") {
        allToolResults.push({
          tool:   block.name,
          input:  block.input,
          result: toolResult,
        });
      }

      toolResultContents.push({
        type:        "tool_result",
        tool_use_id: block.id,
        content:     JSON.stringify(toolResult),
      });
    }

    // Add tool results as a user turn and continue loop
    loopMessages.push({ role: "user", content: toolResultContents });
  }

  return { text: "I ran into an issue completing that — please try again.", toolResults: allToolResults };
}

// ─────────────────────────────────────────────────────────────────────────────
// __init__ health check — generated from live data, not stored as user message
// ─────────────────────────────────────────────────────────────────────────────

async function generateInitSummary(
  serviceClient: ReturnType<typeof createClient>,
  today: string,
): Promise<string> {
  const [projectsRes, overdueRes, budgetRes] = await Promise.all([
    serviceClient.from("projects").select("id, name, status").eq("status", "active"),
    serviceClient
      .from("tasks")
      .select("title, due_date, contractors(name)")
      .lt("due_date", today)
      .neq("status", "done")
      .order("due_date")
      .limit(5),
    serviceClient.from("project_budget_summary").select("name, budget_allocated, budget_spent"),
  ]);

  const activeCount  = projectsRes.data?.length ?? 0;
  const overdueTasks = overdueRes.data ?? [];
  const budgets      = budgetRes.data ?? [];

  const parts: string[] = [];

  parts.push(`${activeCount} active project${activeCount === 1 ? "" : "s"}.`);

  if (overdueTasks.length === 0) {
    parts.push("No overdue tasks.");
  } else {
    const taskList = overdueTasks
      .slice(0, 3)
      .map((t: any) => {
        const name = t.contractors?.name?.split(" ")[0] ?? "Unassigned";
        const daysLate = Math.round(
          (new Date(today).getTime() - new Date(t.due_date).getTime()) / 86400000,
        );
        return `${t.title} (${name}, ${daysLate} day${daysLate === 1 ? "" : "s"} late)`;
      })
      .join(" and ");
    const more = overdueTasks.length > 3 ? ` and ${overdueTasks.length - 3} more` : "";
    parts.push(
      `${overdueTasks.length} task${overdueTasks.length === 1 ? "" : "s"} overdue — ${taskList}${more}.`,
    );
  }

  // Find highest budget burn
  const withBurn = budgets
    .filter((b: any) => b.budget_allocated > 0)
    .map((b: any) => ({
      name: b.name,
      pct:  Math.round((b.budget_spent / b.budget_allocated) * 100),
    }))
    .sort((a: any, b: any) => b.pct - a.pct);

  if (withBurn.length > 0) {
    const top = withBurn[0];
    parts.push(`${top.name} at ${top.pct}% budget burn.`);
  }

  parts.push("Anything you need?");

  return parts.join(" ");
}

// ─────────────────────────────────────────────────────────────────────────────
// System prompt builder
// ─────────────────────────────────────────────────────────────────────────────

function buildSystemPrompt(today: string, initialContext?: Record<string, unknown>): string {
  let prompt = `You are an AI assistant for a contractor management hub. You help manage projects, tasks, contractors, and time tracking.

Today's date: ${today}.

Guidelines:
- Be concise and conversational. Use first names.
- After completing write actions, suggest a relevant follow-up naturally (1 sentence max).
- Never delete anything — only create and update.
- When asked to create multiple items, do them all without asking for confirmation.
- Format dates as "Apr 18" style, not ISO.
- Format costs as "$440" (no decimals unless cents matter).
- Keep prose responses to 2–4 sentences. Use bullet points only for listing 3+ items.
- If you need a contractor or project ID to act, use query_data first to find it.
- The AI never performs destructive operations.`;

  if (initialContext) {
    const ctx = initialContext as any;
    if (ctx.contractors?.length) {
      prompt += `\n\nKnown contractors:\n${ctx.contractors
        .map((c: any) => `  - ${c.name} (${c.role}, ${c.status}, ${c.source}${c.hourly_rate ? `, $${c.hourly_rate}/hr` : ", fixed price"}) id=${c.id}`)
        .join("\n")}`;
    }
    if (ctx.projects?.length) {
      prompt += `\n\nKnown projects:\n${ctx.projects
        .map((p: any) => `  - ${p.name} (${p.status}, ${p.type}${p.budget_allocated ? `, $${p.budget_allocated.toLocaleString()} budget` : ""}) id=${p.id}`)
        .join("\n")}`;
    }
    if (ctx.overdue_count != null) {
      prompt += `\n\nOverdue tasks: ${ctx.overdue_count}`;
    }
    if (ctx.current_page) {
      prompt += `\nUser is currently on: ${ctx.current_page}`;
    }
  }

  return prompt;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorResponse(message: string, status: number): Response {
  return jsonResponse({ error: message }, status);
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Verify auth via user JWT
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return errorResponse("Unauthorized", 401);

  const anonClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: { user }, error: authError } = await anonClient.auth.getUser();
  if (authError || !user) return errorResponse("Unauthorized", 401);

  // Service role client — bypasses RLS for all hub data reads/writes
  const serviceClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  // Resolve author name for activity log entries
  const { data: profile } = await serviceClient
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .maybeSingle();
  const authorName = profile?.full_name ?? user.email ?? "Staff";

  try {
    const body = await req.json();
    const { message, conversation_history = [], initial_context } = body;
    const today = new Date().toISOString().split("T")[0];

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");

    // ── __init__: health check on panel open (not stored as user message) ──
    if (message === "__init__") {
      const summary = await generateInitSummary(serviceClient, today);
      await serviceClient.from("ai_chat_messages").insert({
        user_id:  user.id,
        role:     "assistant",
        content:  summary,
        metadata: { tool_results: [] },
      });
      return jsonResponse({ text: summary, tool_results: [] });
    }

    // ── Regular message ──────────────────────────────────────────────────────

    // Store user message
    await serviceClient.from("ai_chat_messages").insert({
      user_id:  user.id,
      role:     "user",
      content:  message,
      metadata: null,
    });

    // Build Claude messages from provided history + new user turn
    const messages = [
      ...(conversation_history as { role: string; content: string }[]).map((m) => ({
        role:    m.role,
        content: m.content,
      })),
      { role: "user", content: message },
    ];

    const systemPrompt = buildSystemPrompt(today, initial_context);

    const { text, toolResults } = await runAgentLoop({
      messages,
      systemPrompt,
      apiKey,
      serviceClient,
      authorId:   user.id,
      authorName,
      today,
    });

    // Store assistant response with tool_results in metadata
    await serviceClient.from("ai_chat_messages").insert({
      user_id:  user.id,
      role:     "assistant",
      content:  text,
      metadata: { tool_results: toolResults },
    });

    return jsonResponse({ text, tool_results: toolResults });
  } catch (err) {
    console.error("[hub-ai-assistant]", err);
    return errorResponse((err as Error).message, 500);
  }
});
