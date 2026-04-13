import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type AppContext =
  | "dashboard" | "support" | "sales-support" | "logistics"
  | "compliance" | "accounts" | "purchase-orders" | "projects" | "guide";

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

// ── Handler ───────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { messages, context = "dashboard", userEmail = "Staff" } = await req.json() as {
      messages: { role: string; content: string }[];
      context: AppContext;
      userEmail: string;
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

    const systemPrompt = buildSystemPrompt(context as AppContext, data, userEmail);

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
        max_tokens: 1024,
        system: systemPrompt,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error("Anthropic error:", err);
      return new Response(
        JSON.stringify({ reply: "AI service error. Please try again." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
      );
    }

    const result = await response.json();
    const reply = result.content?.[0]?.text ?? "No response.";

    return new Response(
      JSON.stringify({ reply }),
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
