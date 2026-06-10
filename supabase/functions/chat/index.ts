import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type AppContext =
  | "dashboard" | "support" | "sales-support" | "logistics"
  | "compliance" | "accounts" | "purchase-orders" | "projects"
  | "guide" | "tasks";

// ── Data loaders ──────────────────────────────────────────────────────────────

async function loadSupportData(sb: ReturnType<typeof createClient>) {
  const [{ data: cases }, { data: actionItems }, { data: teamMembers }] = await Promise.all([
    sb.from("cases")
      .select("case_number, type, status, priority, customer_name, product_name, order_number, description, created_at, updated_at, error_origin")
      .order("created_at", { ascending: false })
      .limit(100),
    sb.from("action_items")
      .select("id, description, status, due_date, assigned_to, case_id")
      .neq("status", "done")
      .limit(50),
    sb.from("team_members")
      .select("id, name, role")
      .eq("active", true),
  ]);
  return { cases, actionItems, teamMembers };
}

async function loadSalesData(sb: ReturnType<typeof createClient>) {
  const today = new Date().toISOString().split("T")[0];
  const [{ data: leads }, { data: callList }, { data: jobs }] = await Promise.all([
    sb.from("sales_leads")
      .select("id, channel, company_name, lead_score, status, recommended_contact_name, recommended_contact_position, recommended_pitch, discovery_source, is_existing_customer, created_at")
      .order("lead_score", { ascending: false })
      .limit(80),
    sb.from("call_list")
      .select("id, channel, company_name, recommended_contact_name, recommended_pitch, is_complete, call_outcome, scheduled_date")
      .eq("scheduled_date", today)
      .limit(50),
    sb.from("research_jobs")
      .select("id, channel, job_type, status, leads_found, started_at, completed_at")
      .order("created_at", { ascending: false })
      .limit(10),
  ]);
  return { leads, callList, jobs };
}

async function loadLogisticsData(sb: ReturnType<typeof createClient>) {
  const [{ data: invoices }, { data: disputes }] = await Promise.all([
    sb.from("freight_invoices")
      .select("id, invoice_number, carrier_id, invoice_date, total_amount, status, dispute_reason")
      .order("invoice_date", { ascending: false })
      .limit(60),
    sb.from("freight_invoices")
      .select("id, invoice_number, carrier_id, invoice_date, total_amount, dispute_reason, status")
      .not("dispute_reason", "is", null)
      .limit(30),
  ]);
  return { invoices, disputes };
}

async function loadPurchaseOrdersData(sb: ReturnType<typeof createClient>) {
  const { data: orders } = await sb.from("purchase_orders")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(80);
  return { orders };
}

async function loadProjectsData(sb: ReturnType<typeof createClient>) {
  const [{ data: projects }, { data: tasks }, { data: contractors }] = await Promise.all([
    sb.from("projects")
      .select("id, name, status, description, start_date, end_date, budget")
      .order("created_at", { ascending: false })
      .limit(40),
    sb.from("tasks")
      .select("id, title, status, priority, due_date, assigned_to, project_id")
      .order("created_at", { ascending: false })
      .limit(80),
    sb.from("contractors")
      .select("id, name, role, email, status")
      .limit(30),
  ]);
  return { projects, tasks, contractors };
}

async function loadStaffTasksData(sb: ReturnType<typeof createClient>) {
  const [{ data: staffTasks }, { data: staff }] = await Promise.all([
    sb.from("staff_tasks")
      .select("id, title, description, status, created_by, assigned_to, due_date, urgency, importance, blocked_by_task_id, parent_task_id, completed_at, status_notes, created_at")
      .order("created_at", { ascending: false })
      .limit(80),
    sb.from("profiles")
      .select("id, full_name, email"),
  ]);
  return { staffTasks, staff };
}

async function loadComplianceData(sb: ReturnType<typeof createClient>) {
  const [{ data: actions }, { data: kbItems }] = await Promise.all([
    sb.from("actions")
      .select("id, question_text, answer_text, ai_feedback, status, document_id, created_at")
      .order("created_at", { ascending: false })
      .limit(50),
    sb.from("compliance_kb_items")
      .select("id, title, content, category, created_at")
      .order("created_at", { ascending: false })
      .limit(30),
  ]);
  return { actions, kbItems };
}

async function loadGuideData(sb: ReturnType<typeof createClient>) {
  const [{ data: guides }, { data: feedback }, { data: questions }] = await Promise.all([
    sb.from("guide_publications")
      .select("id, title, status, brand_id, created_at, updated_at")
      .order("updated_at", { ascending: false })
      .limit(40),
    sb.from("feedback")
      .select("id, guide_id, rating, comment, created_at")
      .order("created_at", { ascending: false })
      .limit(30),
    sb.from("support_questions")
      .select("id, guide_id, question, created_at")
      .order("created_at", { ascending: false })
      .limit(20),
  ]);
  return { guides, feedback, questions };
}

// ── System prompt builders ────────────────────────────────────────────────────

function buildSystemPrompt(context: AppContext, data: Record<string, unknown>, userEmail: string): string {
  const today = new Date().toISOString().split("T")[0];
  const base = `Today is ${today}. Staff member: ${userEmail}.\nBe concise, direct, and use markdown formatting where helpful.\n\n`;

  switch (context) {
    case "support": {
      const d = data as { cases: unknown; actionItems: unknown; teamMembers: unknown };
      return base + `You are a customer service operations assistant. You have full visibility of the support team's cases, action items, and team members.

## Cases (most recent 100)
${JSON.stringify(d.cases ?? [], null, 2)}

## Pending Action Items
${JSON.stringify(d.actionItems ?? [], null, 2)}

## Team Members
${JSON.stringify(d.teamMembers ?? [], null, 2)}

Answer questions about case status, workload, overdue items, patterns, and team assignments. Case types include warranty claims, order errors, freight issues, and complaints.`;
    }

    case "sales-support": {
      const d = data as { leads: unknown; callList: unknown; jobs: unknown };
      return base + `You are a sales support assistant with full visibility of the lead database, today's call list, and research jobs.

## Leads (top 80 by score)
${JSON.stringify(d.leads ?? [], null, 2)}

## Today's Call List
${JSON.stringify(d.callList ?? [], null, 2)}

## Recent Research Jobs
${JSON.stringify(d.jobs ?? [], null, 2)}

Channels are: trailbait (lure fishing), fleetcraft (fleet/commercial), aga (fishing club members).
Answer questions about leads, call priorities, scores, pitches, and research job status.`;
    }

    case "logistics": {
      const d = data as { invoices: unknown; disputes: unknown };
      return base + `You are a logistics and freight assistant with full visibility of freight invoices and disputes.

## Recent Freight Invoices (last 60)
${JSON.stringify(d.invoices ?? [], null, 2)}

## Disputed Invoices
${JSON.stringify(d.disputes ?? [], null, 2)}

Answer questions about freight costs, invoice status, carrier disputes, and spend analysis.`;
    }

    case "purchase-orders": {
      const d = data as { orders: unknown };
      return base + `You are a purchasing assistant with full visibility of purchase orders.

## Purchase Orders (most recent 80)
${JSON.stringify(d.orders ?? [], null, 2)}

Answer questions about PO status, overdue orders, supplier performance, and ordering patterns.`;
    }

    case "projects": {
      const d = data as { projects: unknown; tasks: unknown; contractors: unknown };
      return base + `You are a project management assistant with full visibility of projects, tasks, and contractors.

## Projects
${JSON.stringify(d.projects ?? [], null, 2)}

## Tasks (most recent 80)
${JSON.stringify(d.tasks ?? [], null, 2)}

## Contractors
${JSON.stringify(d.contractors ?? [], null, 2)}

Answer questions about project status, overdue tasks, contractor workload, and deadlines.`;
    }

    case "tasks": {
      const d = data as { staffTasks: unknown; staff: unknown };
      return base + `You are a staff task assistant with full visibility of the cross-staff task tracker. Tasks use Eisenhower scoring (urgency × importance) and can block each other via blocked_by_task_id / parent_task_id. created_by and assigned_to are profile ids — resolve them to names using the staff list.

## Staff Tasks (most recent 80)
${JSON.stringify(d.staffTasks ?? [], null, 2)}

## Staff
${JSON.stringify(d.staff ?? [], null, 2)}

Answer questions about open tasks, who is overloaded, what is blocked, overdue items, and priorities.`;
    }

    case "compliance": {
      const d = data as { actions: unknown; kbItems: unknown };
      return base + `You are an ISO 9001 compliance assistant with full visibility of audit action items and the knowledge base.

## Audit Action Items
${JSON.stringify(d.actions ?? [], null, 2)}

## Knowledge Base
${JSON.stringify(d.kbItems ?? [], null, 2)}

Answer questions about compliance status, open action items, ISO clauses, and documentation requirements.`;
    }

    case "accounts": {
      return base + `You are an accounts and financial reporting assistant for this business.
The Accounts module processes profit and loss data imported from Xero/accounting systems.
Answer questions about financial performance, margins, reporting periods, and P&L analysis.
If asked for specific figures, note that live data requires viewing the Accounts dashboard directly.`;
    }

    case "guide": {
      const d = data as { guides: unknown; feedback: unknown; questions: unknown };
      return base + `You are a guide portal assistant with visibility of published guides, customer feedback, and support questions.

## Guides
${JSON.stringify(d.guides ?? [], null, 2)}

## Recent Feedback
${JSON.stringify(d.feedback ?? [], null, 2)}

## Support Questions
${JSON.stringify(d.questions ?? [], null, 2)}

Answer questions about guide publication status, feedback trends, and customer support questions.`;
    }

    case "dashboard":
    default: {
      const d = data as Record<string, unknown>;
      return base + `You are an all-knowing business operations assistant. You have visibility across all apps in the portal: customer support, sales, logistics, purchasing, projects, compliance, and the guide portal.

## Support: Recent Cases (last 30)
${JSON.stringify(d.cases ?? [], null, 2)}

## Support: Pending Action Items
${JSON.stringify(d.actionItems ?? [], null, 2)}

## Sales: Today's Call List
${JSON.stringify(d.callList ?? [], null, 2)}

## Sales: Top Leads (by score, top 20)
${JSON.stringify(d.leads ?? [], null, 2)}

## Projects: Active Tasks (last 30)
${JSON.stringify(d.tasks ?? [], null, 2)}

## Projects: Projects
${JSON.stringify(d.projects ?? [], null, 2)}

## Logistics: Recent Invoices (last 20)
${JSON.stringify(d.invoices ?? [], null, 2)}

## Purchase Orders (last 20)
${JSON.stringify(d.orders ?? [], null, 2)}

## Compliance: Open Actions
${JSON.stringify(d.complianceActions ?? [], null, 2)}

Answer any question about the business across all these apps. Summarise, identify issues, flag what needs attention, and give actionable answers.`;
    }
  }
}

// ── Write tools ───────────────────────────────────────────────────────────────
// The chat can act, not just answer: create staff tasks, update their status,
// and comment on them. All writes run under the service role but are stamped
// with the requesting user's profile id (resolved from their email), and
// assignee notifications reuse the portal's /api/notify-task-assignee endpoint
// with the caller's own JWT forwarded.

const PORTAL_URL = Deno.env.get("PORTAL_URL") ?? "https://app.automotivegroup.com.au";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TOOLS = [
  {
    name: "create_task",
    description: "Create a staff task and assign it to a staff member. When the user says 'make a task for <person> re this', derive a concise title and a description capturing the specifics (names, IDs, amounts, what needs doing) from the current screen content.",
    input_schema: {
      type: "object",
      properties: {
        title:         { type: "string", description: "Short, specific task title" },
        description:   { type: "string", description: "What needs doing and the relevant context from the screen (IDs, customers, amounts, links)" },
        assignee_name: { type: "string", description: "Name of the staff member to assign to (first name is fine)" },
        due_date:      { type: "string", description: "Optional due date, YYYY-MM-DD" },
        urgency:       { type: "integer", minimum: 1, maximum: 5, description: "1–5, Eisenhower urgency" },
        importance:    { type: "integer", minimum: 1, maximum: 5, description: "1–5, Eisenhower importance" },
      },
      required: ["title", "assignee_name"],
    },
  },
  {
    name: "update_task_status",
    description: "Update the status of an existing staff task. Identify the task by its uuid or a distinctive fragment of its title.",
    input_schema: {
      type: "object",
      properties: {
        task:   { type: "string", description: "Task uuid or title fragment" },
        status: { type: "string", enum: ["not_started", "in_progress", "blocked", "done"] },
      },
      required: ["task", "status"],
    },
  },
  {
    name: "add_task_comment",
    description: "Add a comment to an existing staff task. Identify the task by its uuid or a distinctive fragment of its title.",
    input_schema: {
      type: "object",
      properties: {
        task:    { type: "string", description: "Task uuid or title fragment" },
        comment: { type: "string" },
      },
      required: ["task", "comment"],
    },
  },
];

interface ToolCtx {
  sb: ReturnType<typeof createClient>;
  requester: { id: string; full_name: string | null; email: string | null } | null;
  userJwt: string | null;
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
  }).catch((err) => console.warn("[chat] summary failed:", err));
  (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime?.waitUntil?.(work);
}

function notifyTask(userJwt: string | null, payload: Record<string, unknown>): void {
  if (!userJwt) return;
  fetch(`${PORTAL_URL}/api/notify-task-assignee`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: userJwt },
    body: JSON.stringify(payload),
  }).catch((err) => console.warn("[chat] notify failed:", err));
}

async function resolveAssignee(sb: ToolCtx["sb"], name: string) {
  const { data } = await sb.from("profiles").select("id, full_name, email");
  const q = name.toLowerCase().trim();
  const all = (data ?? []) as { id: string; full_name: string | null; email: string | null }[];
  const matches = all.filter((p) =>
    (p.full_name ?? "").toLowerCase().includes(q) ||
    (p.email ?? "").toLowerCase().split("@")[0] === q
  );
  return { matches, all };
}

async function findTask(sb: ToolCtx["sb"], identifier: string) {
  const cols = "id, title, status, assigned_to, created_by";
  if (UUID_RE.test(identifier.trim())) {
    const { data } = await sb.from("staff_tasks").select(cols).eq("id", identifier.trim());
    return data ?? [];
  }
  const { data } = await sb.from("staff_tasks")
    .select(cols)
    .ilike("title", `%${identifier}%`)
    .order("created_at", { ascending: false })
    .limit(5);
  return data ?? [];
}

async function executeTool(name: string, input: Record<string, unknown>, ctx: ToolCtx): Promise<Record<string, unknown>> {
  try {
    if (!ctx.requester) {
      return { ok: false, error: "Could not match your login email to a staff profile — task actions are unavailable." };
    }

    if (name === "create_task") {
      const { matches, all } = await resolveAssignee(ctx.sb, String(input.assignee_name ?? ""));
      if (matches.length === 0) {
        return { ok: false, error: `No staff member matches "${input.assignee_name}". Staff: ${all.map((p) => p.full_name).filter(Boolean).join(", ")}` };
      }
      if (matches.length > 1) {
        return { ok: false, error: `"${input.assignee_name}" is ambiguous: ${matches.map((p) => p.full_name).join(", ")}. Ask the user which one.` };
      }
      const assignee = matches[0];
      const { data: task, error } = await ctx.sb.from("staff_tasks").insert({
        title:       String(input.title),
        description: input.description ? String(input.description) : null,
        assigned_to: assignee.id,
        created_by:  ctx.requester.id,
        due_date:    input.due_date ? String(input.due_date) : null,
        urgency:     input.urgency ?? null,
        importance:  input.importance ?? null,
        status:      "not_started",
      }).select("id, title").single();
      if (error) return { ok: false, error: error.message };

      queueTaskSummary(task.id);

      if (assignee.id !== ctx.requester.id) {
        notifyTask(ctx.userJwt, {
          task_id:      task.id,
          recipient_id: assignee.id,
          event:        "assigned",
          task_title:   task.title,
          actor_name:   ctx.requester.full_name ?? ctx.requester.email,
        });
      }
      return { ok: true, task_id: task.id, title: task.title, assigned_to: assignee.full_name, url: `${PORTAL_URL}/tasks?task=${task.id}` };
    }

    if (name === "update_task_status") {
      const found = await findTask(ctx.sb, String(input.task ?? ""));
      if (found.length === 0) return { ok: false, error: `No task found matching "${input.task}".` };
      if (found.length > 1) {
        return { ok: false, error: `Multiple tasks match: ${found.map((t) => `"${t.title}" (${t.status})`).join("; ")}. Ask the user which one.` };
      }
      const status = String(input.status);
      const { error } = await ctx.sb.from("staff_tasks")
        .update({ status, completed_at: status === "done" ? new Date().toISOString() : null })
        .eq("id", found[0].id);
      if (error) return { ok: false, error: error.message };
      return { ok: true, task_id: found[0].id, title: found[0].title, status };
    }

    if (name === "add_task_comment") {
      const found = await findTask(ctx.sb, String(input.task ?? ""));
      if (found.length === 0) return { ok: false, error: `No task found matching "${input.task}".` };
      if (found.length > 1) {
        return { ok: false, error: `Multiple tasks match: ${found.map((t) => `"${t.title}" (${t.status})`).join("; ")}. Ask the user which one.` };
      }
      const task = found[0];
      const { error } = await ctx.sb.from("staff_task_comments").insert({
        task_id:   task.id,
        author_id: ctx.requester.id,
        body:      String(input.comment),
        mentions:  [],
      });
      if (error) return { ok: false, error: error.message };

      const recipient = task.assigned_to === ctx.requester.id ? task.created_by : task.assigned_to;
      if (recipient && recipient !== ctx.requester.id) {
        notifyTask(ctx.userJwt, {
          task_id:      task.id,
          recipient_id: recipient,
          event:        "comment",
          task_title:   task.title,
          actor_name:   ctx.requester.full_name ?? ctx.requester.email,
          comment_body: String(input.comment),
        });
      }
      return { ok: true, task_id: task.id, title: task.title };
    }

    return { ok: false, error: `Unknown tool: ${name}` };
  } catch (err) {
    console.error(`[chat] tool ${name} failed:`, err);
    return { ok: false, error: String(err) };
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { messages, context = "dashboard", userEmail = "Staff", screen } = await req.json() as {
      messages: { role: string; content: string }[];
      context: AppContext;
      userEmail: string;
      screen?: { path?: string; title?: string; text?: string };
    };

    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicKey) {
      return new Response(
        JSON.stringify({ reply: "AI is not configured. Please contact your administrator." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Load context-appropriate data
    let data: Record<string, unknown> = {};
    try {
      if (context === "support") {
        data = await loadSupportData(sb);
      } else if (context === "sales-support") {
        data = await loadSalesData(sb);
      } else if (context === "logistics") {
        data = await loadLogisticsData(sb);
      } else if (context === "purchase-orders") {
        data = await loadPurchaseOrdersData(sb);
      } else if (context === "projects") {
        data = await loadProjectsData(sb);
      } else if (context === "tasks") {
        data = await loadStaffTasksData(sb);
      } else if (context === "compliance") {
        data = await loadComplianceData(sb);
      } else if (context === "guide") {
        data = await loadGuideData(sb);
      } else if (context === "accounts") {
        // No DB tables to load; prompt handles it
        data = {};
      } else {
        // dashboard — load summary from all apps
        const today = new Date().toISOString().split("T")[0];
        const [
          { data: cases },
          { data: actionItems },
          { data: leads },
          { data: callList },
          { data: tasks },
          { data: projects },
          { data: invoices },
          { data: orders },
          { data: complianceActions },
        ] = await Promise.all([
          sb.from("cases").select("case_number, type, status, priority, customer_name, product_name, created_at").order("created_at", { ascending: false }).limit(30),
          sb.from("action_items").select("id, description, status, due_date, assigned_to").neq("status", "done").limit(20),
          sb.from("sales_leads").select("id, channel, company_name, lead_score, status").order("lead_score", { ascending: false }).limit(20),
          sb.from("call_list").select("id, channel, company_name, is_complete, scheduled_date").eq("scheduled_date", today).limit(30),
          sb.from("tasks").select("id, title, status, priority, due_date, assigned_to").order("created_at", { ascending: false }).limit(30),
          sb.from("projects").select("id, name, status, end_date").order("created_at", { ascending: false }).limit(15),
          sb.from("freight_invoices").select("id, invoice_number, total_amount, status, invoice_date").order("invoice_date", { ascending: false }).limit(20),
          sb.from("purchase_orders").select("*").order("created_at", { ascending: false }).limit(20),
          sb.from("actions").select("id, question_text, status, document_id").eq("status", "open").limit(20),
        ]);
        data = { cases, actionItems, leads, callList, tasks, projects, invoices, orders, complianceActions };
      }
    } catch (dbErr) {
      console.error("DB load error:", dbErr);
      // Continue with empty data — the AI can still answer general questions
    }

    // Resolve the requesting user's profile — writes are stamped with it.
    let requester: ToolCtx["requester"] = null;
    try {
      const { data: rows } = await sb.from("profiles")
        .select("id, full_name, email")
        .ilike("email", userEmail)
        .limit(1);
      requester = (rows?.[0] as ToolCtx["requester"]) ?? null;
    } catch (err) {
      console.warn("[chat] requester lookup failed:", err);
    }

    let systemPrompt = buildSystemPrompt(context as AppContext, data, userEmail);

    if (screen?.text) {
      systemPrompt += `\n\n## Current screen (what the user is looking at RIGHT NOW)
Path: ${screen.path ?? "unknown"}
Page title: ${screen.title ?? "unknown"}
Visible text:
${String(screen.text).slice(0, 8000)}

When the user says "this", "this page", or "what I'm working on", they mean the screen content above.`;
    }

    systemPrompt += `\n\n## Actions
You can act, not just answer: create staff tasks, update task status, and comment on tasks using the provided tools.
- "Make a task for <person> re this" → write a concise, specific title and a description capturing the key details from the current screen (IDs, customer/product names, amounts, what needs doing). Set sensible urgency/importance (1–5).
- Don't ask for confirmation when the request is clear; only ask if the assignee or target task is ambiguous.
- After acting, confirm briefly what you did, including the task title and assignee.
- EXCEPTION: if the user's message @mentions a staff member (e.g. "@John look at this"), the portal already creates a task for them automatically — do NOT call create_task for @mentions; just answer the message itself.`;

    const ctx: ToolCtx = { sb, requester, userJwt: req.headers.get("Authorization") };

    // Tool loop — keep calling until the model stops requesting tools.
    const apiMessages: Record<string, unknown>[] = messages.map((m) => ({ role: m.role, content: m.content }));
    let reply = "No response.";
    let didWrite = false;

    for (let round = 0; round < 5; round++) {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": anthropicKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        signal: AbortSignal.timeout(25000),
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 2048,
          system: systemPrompt,
          tools: TOOLS,
          messages: apiMessages,
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        console.error("Anthropic error:", err);
        return new Response(
          JSON.stringify({ reply: "AI service error. Please try again.", didWrite }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
        );
      }

      const result = await response.json();
      const text = (result.content ?? [])
        .filter((b: { type: string }) => b.type === "text")
        .map((b: { text: string }) => b.text)
        .join("\n")
        .trim();
      if (text) reply = text;

      if (result.stop_reason !== "tool_use") break;

      apiMessages.push({ role: "assistant", content: result.content });
      const toolResults = [];
      for (const block of result.content.filter((b: { type: string }) => b.type === "tool_use")) {
        const outcome = await executeTool(block.name, block.input ?? {}, ctx);
        if (outcome.ok) didWrite = true;
        toolResults.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(outcome) });
      }
      apiMessages.push({ role: "user", content: toolResults });
    }

    return new Response(
      JSON.stringify({ reply, didWrite }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("chat function error:", err);
    return new Response(
      JSON.stringify({ reply: "Something went wrong. Please try again." }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
