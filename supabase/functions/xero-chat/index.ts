import { createClient } from "npm:@supabase/supabase-js@2";
import { buildSystemPrompt } from "./systemPrompt.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type SC = ReturnType<typeof createClient>;

// ─── Xero token helper (for writes only) ─────────────────────────────────────

let cachedToken: string | null = null;
let tokenExpiresAt = 0;
let cachedTenantId: string | null = null;

async function getXeroToken(sc: SC): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiresAt - 60000) return cachedToken!;

  const { data: row, error } = await sc
    .from("xero_tokens")
    .select("refresh_token, tenant_id, tenant_name")
    .eq("id", 1)
    .single();

  if (error || !row?.refresh_token) {
    throw new Error("XERO_NOT_CONNECTED: Xero has not been authorised. Please connect via the Xero settings.");
  }

  const clientId = Deno.env.get("XERO_CLIENT_ID")!;
  const clientSecret = Deno.env.get("XERO_CLIENT_SECRET")!;

  const res = await fetch("https://identity.xero.com/connect/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": "Basic " + btoa(`${clientId}:${clientSecret}`),
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: row.refresh_token }),
  });

  if (!res.ok) {
    const errText = await res.text();
    if (errText.includes("invalid_grant") || errText.includes("Token has expired")) {
      await sc.from("xero_tokens").delete().eq("id", 1);
      throw new Error("XERO_NOT_CONNECTED: Xero authorisation has expired. Please reconnect.");
    }
    throw new Error(`Xero token error: ${errText}`);
  }

  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + data.expires_in * 1000;

  await sc.from("xero_tokens").upsert({
    id: 1,
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(),
    scope: data.scope,
    tenant_id: row.tenant_id ?? cachedTenantId,
    tenant_name: row.tenant_name,
    updated_at: new Date().toISOString(),
  });

  if (row.tenant_id) cachedTenantId = row.tenant_id;
  return cachedToken!;
}

async function getXeroTenantId(sc: SC): Promise<string> {
  if (cachedTenantId) return cachedTenantId!;
  const { data: row } = await sc.from("xero_tokens").select("tenant_id").eq("id", 1).single();
  if (row?.tenant_id) { cachedTenantId = row.tenant_id; return cachedTenantId!; }
  const token = await getXeroToken(sc);
  const res = await fetch("https://api.xero.com/connections", { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Xero connections error: ${await res.text()}`);
  const connections = await res.json();
  if (!connections.length) throw new Error("No Xero connections found");
  cachedTenantId = connections[0].tenantId;
  return cachedTenantId!;
}

async function xeroWrite(endpoint: string, body: unknown, sc: SC, method = "POST"): Promise<unknown> {
  const token = await getXeroToken(sc);
  const tenantId = await getXeroTenantId(sc);
  const res = await fetch(`https://api.xero.com/api.xro/2.0${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Xero-Tenant-Id": tenantId,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Xero API error (${res.status}): ${await res.text()}`);
  return res.json();
}

// ─── Tool definitions ─────────────────────────────────────────────────────────

const tools = [
  // ── DB read ──────────────────────────────────────────────────────────────────
  {
    name: "query_xero_db",
    description: "Run a SELECT query against the local Xero data warehouse. Use this for all read operations — it's fast, has no rate limits, and covers invoices, line items, contacts, accounts, payments, bank transactions, journals, credit notes. Always prefer this over live Xero API calls for reads.",
    input_schema: {
      type: "object",
      properties: {
        sql: {
          type: "string",
          description: "A SELECT query against the xero_* tables or views. Never mutate data.",
        },
      },
      required: ["sql"],
    },
  },

  // ── On-demand sync ───────────────────────────────────────────────────────────
  {
    name: "sync_xero_data",
    description: "Trigger a fresh sync from Xero into the local database. Use when the user asks about very recent data (today/yesterday) that may not be in the DB yet, or when they explicitly ask to refresh. Syncs the specified entities for the given date range.",
    input_schema: {
      type: "object",
      properties: {
        entities: {
          type: "array",
          items: { type: "string", enum: ["invoices", "payments", "bank_transactions", "contacts", "accounts", "journals", "credit_notes", "tracking", "full"] },
          description: "Which entities to sync. Use [\"full\"] to sync everything.",
        },
        date_from: { type: "string", description: "YYYY-MM-DD — start of date range for transactional data" },
        date_to: { type: "string", description: "YYYY-MM-DD — end of date range for transactional data" },
      },
      required: ["entities"],
    },
  },

  // ── Write tools (hit Xero API directly) ──────────────────────────────────────
  {
    name: "create_invoice",
    description: "Create a new sales invoice (ACCREC) or bill (ACCPAY) in Xero. WRITE OPERATION — only call after explicit user confirmation.",
    input_schema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["ACCREC", "ACCPAY"] },
        contact_id: { type: "string", description: "Xero ContactID (get from query_xero_db if needed)" },
        contact_name: { type: "string", description: "Used if contact_id not known" },
        date: { type: "string", description: "YYYY-MM-DD, defaults to today" },
        due_date: { type: "string", description: "YYYY-MM-DD" },
        reference: { type: "string" },
        status: { type: "string", enum: ["DRAFT", "SUBMITTED", "AUTHORISED"], description: "Defaults to DRAFT" },
        line_items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              description: { type: "string" },
              quantity: { type: "number" },
              unit_amount: { type: "number" },
              account_code: { type: "string" },
              tax_type: { type: "string" },
            },
            required: ["description", "quantity", "unit_amount", "account_code"],
          },
        },
      },
      required: ["type", "line_items"],
    },
  },
  {
    name: "void_invoice",
    description: "Void an existing invoice or bill. WRITE OPERATION — only call after explicit user confirmation. Cannot be undone.",
    input_schema: {
      type: "object",
      properties: {
        invoice_id: { type: "string", description: "Xero InvoiceID" },
      },
      required: ["invoice_id"],
    },
  },
  {
    name: "approve_invoice",
    description: "Approve (authorise) a draft invoice or bill. WRITE OPERATION — only call after explicit user confirmation.",
    input_schema: {
      type: "object",
      properties: {
        invoice_id: { type: "string", description: "Xero InvoiceID" },
      },
      required: ["invoice_id"],
    },
  },
  {
    name: "update_invoice_lines",
    description: "Update one or more line items on an existing Xero invoice — change account code, description, quantity, or unit amount. Use this to remap account codes on shipping/freight lines. WRITE OPERATION — only call after explicit user confirmation.",
    input_schema: {
      type: "object",
      properties: {
        invoice_id: { type: "string", description: "Xero InvoiceID (get from query_xero_db using xero_line_items.invoice_id)" },
        line_items: {
          type: "array",
          description: "Line items to update. Each must include line_item_id plus the fields to change.",
          items: {
            type: "object",
            properties: {
              line_item_id: { type: "string", description: "Xero LineItemID from xero_line_items table" },
              account_code: { type: "string", description: "New account code (e.g. '400', '200'). Get valid codes from xero_accounts." },
              description: { type: "string" },
              quantity: { type: "number" },
              unit_amount: { type: "number" },
              tax_type: { type: "string" },
            },
            required: ["line_item_id"],
          },
        },
      },
      required: ["invoice_id", "line_items"],
    },
  },
  {
    name: "bulk_update_invoice_lines",
    description: "Update line items across MULTIPLE invoices in one operation — e.g. remap account codes on shipping lines across 10, 50, or 200 invoices at once. Use this instead of calling update_invoice_lines repeatedly. WRITE OPERATION — only call after explicit user confirmation.",
    input_schema: {
      type: "object",
      properties: {
        invoices: {
          type: "array",
          description: "List of invoices to update. Each entry has an invoice_id and the line_items to change within that invoice.",
          items: {
            type: "object",
            properties: {
              invoice_id: { type: "string", description: "Xero InvoiceID" },
              line_items: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    line_item_id: { type: "string", description: "Xero LineItemID from xero_line_items table" },
                    account_code: { type: "string" },
                    description: { type: "string" },
                    quantity: { type: "number" },
                    unit_amount: { type: "number" },
                    tax_type: { type: "string" },
                  },
                  required: ["line_item_id"],
                },
              },
            },
            required: ["invoice_id", "line_items"],
          },
        },
      },
      required: ["invoices"],
    },
  },
  {
    name: "create_manual_journal",
    description: "Create a manual journal entry in Xero. WRITE OPERATION — only call after explicit user confirmation. Lines must balance to zero.",
    input_schema: {
      type: "object",
      properties: {
        narration: { type: "string" },
        date: { type: "string", description: "YYYY-MM-DD" },
        journal_lines: {
          type: "array",
          items: {
            type: "object",
            properties: {
              account_code: { type: "string" },
              description: { type: "string" },
              net_amount: { type: "number", description: "Positive = debit, negative = credit" },
              tax_type: { type: "string" },
            },
            required: ["account_code", "net_amount"],
          },
        },
      },
      required: ["narration", "journal_lines"],
    },
  },
];

// ─── Tool execution ───────────────────────────────────────────────────────────

const WRITE_TOOLS = new Set(["create_invoice", "void_invoice", "approve_invoice", "create_manual_journal", "update_invoice_lines", "bulk_update_invoice_lines"]);

async function executeTool(name: string, input: Record<string, unknown>, sc: SC, userToken: string): Promise<unknown> {
  try {
    switch (name) {

      // ── DB read ──────────────────────────────────────────────────────────────
      case "query_xero_db": {
        const sql = String(input.sql ?? "").trim();
        // Safety: only allow SELECT
        const firstWord = sql.replace(/\/\*[\s\S]*?\*\//g, "").trim().split(/\s+/)[0].toUpperCase();
        if (!["SELECT", "WITH"].includes(firstWord)) {
          return { error: "Only SELECT queries are permitted." };
        }
        const { data, error } = await sc.rpc("execute_xero_query", { query_sql: sql });
        if (error) return { error: error.message };
        return { rows: data, count: Array.isArray(data) ? data.length : null };
      }

      // ── On-demand sync ───────────────────────────────────────────────────────
      case "sync_xero_data": {
        const { entities, date_from, date_to } = input as any;
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;

        const res = await fetch(`${supabaseUrl}/functions/v1/xero-sync`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": userToken,
          },
          body: JSON.stringify({ entities, date_from, date_to, sync_type: "manual" }),
        });

        if (!res.ok) return { error: `Sync failed: ${await res.text()}` };
        const result = await res.json() as any;
        return { synced: result.results, total_records: result.total };
      }

      // ── Writes ───────────────────────────────────────────────────────────────
      case "create_invoice": {
        const { type, contact_id, contact_name, date, due_date, reference, status = "DRAFT", line_items } = input as any;

        let contact: any = {};
        if (contact_id) {
          contact = { ContactID: contact_id };
        } else if (contact_name) {
          // Look up in local DB first
          const { data } = await sc.from("xero_contacts").select("contact_id").ilike("name", `%${contact_name}%`).limit(1).single();
          contact = data ? { ContactID: data.contact_id } : { Name: contact_name };
        }

        const defaultTaxType = type === "ACCREC" ? "OUTPUT" : "INPUT";
        const invoiceBody = {
          Type: type,
          Contact: contact,
          Date: date || new Date().toISOString().split("T")[0],
          DueDate: due_date,
          Reference: reference,
          Status: status,
          LineItems: line_items.map((li: any) => ({
            Description: li.description,
            Quantity: li.quantity,
            UnitAmount: li.unit_amount,
            AccountCode: li.account_code,
            TaxType: li.tax_type || defaultTaxType,
          })),
        };

        const data = await xeroWrite("/Invoices", { Invoices: [invoiceBody] }, sc) as any;
        const inv = data.Invoices?.[0];
        if (!inv) throw new Error("Invoice creation returned no data");
        return {
          invoiceId: inv.InvoiceID,
          invoiceNumber: inv.InvoiceNumber,
          contact: inv.Contact?.Name,
          status: inv.Status,
          total: inv.Total,
          date: inv.DateString,
          dueDate: inv.DueDateString,
        };
      }

      case "void_invoice": {
        const { invoice_id } = input as any;
        const data = await xeroWrite(`/Invoices/${invoice_id}`, {
          Invoices: [{ InvoiceID: invoice_id, Status: "VOIDED" }],
        }, sc) as any;
        const inv = data.Invoices?.[0];
        return { invoiceId: inv.InvoiceID, invoiceNumber: inv.InvoiceNumber, status: inv.Status };
      }

      case "approve_invoice": {
        const { invoice_id } = input as any;
        const data = await xeroWrite(`/Invoices/${invoice_id}`, {
          Invoices: [{ InvoiceID: invoice_id, Status: "AUTHORISED" }],
        }, sc) as any;
        const inv = data.Invoices?.[0];
        return { invoiceId: inv.InvoiceID, invoiceNumber: inv.InvoiceNumber, status: inv.Status, total: inv.Total };
      }

      case "create_manual_journal": {
        const { narration, date, journal_lines } = input as any;
        const netSum = journal_lines.reduce((s: number, jl: any) => s + (jl.net_amount || 0), 0);
        if (Math.abs(netSum) > 0.01) {
          return { error: `Journal lines do not balance. Net sum: ${netSum.toFixed(2)}. Must equal zero.` };
        }
        const body = {
          ManualJournals: [{
            Narration: narration,
            Date: date || new Date().toISOString().split("T")[0],
            JournalLines: journal_lines.map((jl: any) => ({
              AccountCode: jl.account_code,
              Description: jl.description || narration,
              NetAmount: jl.net_amount,
              TaxType: jl.tax_type || "NONE",
            })),
          }],
        };
        const data = await xeroWrite("/ManualJournals", body, sc) as any;
        const journal = data.ManualJournals?.[0];
        if (!journal) throw new Error("Journal creation returned no data");
        return {
          manualJournalId: journal.ManualJournalID,
          narration: journal.Narration,
          date: journal.DateString,
          status: journal.Status,
          lineCount: journal.JournalLines?.length,
        };
      }

      case "update_invoice_lines": {
        const { invoice_id, line_items } = input as any;
        const data = await xeroWrite(`/Invoices/${invoice_id}`, {
          InvoiceID: invoice_id,
          LineItems: line_items.map((li: any) => ({
            LineItemID: li.line_item_id,
            ...(li.account_code  !== undefined ? { AccountCode: li.account_code }   : {}),
            ...(li.description   !== undefined ? { Description: li.description }     : {}),
            ...(li.quantity      !== undefined ? { Quantity: li.quantity }           : {}),
            ...(li.unit_amount   !== undefined ? { UnitAmount: li.unit_amount }      : {}),
            ...(li.tax_type      !== undefined ? { TaxType: li.tax_type }            : {}),
          })),
        }, sc) as any;
        const inv = data.Invoices?.[0];
        if (!inv) throw new Error("Update returned no data");
        return {
          invoiceId: inv.InvoiceID,
          invoiceNumber: inv.InvoiceNumber,
          status: inv.Status,
          updatedLines: line_items.length,
        };
      }

      case "bulk_update_invoice_lines": {
        const { invoices } = input as any;
        const results: Array<{ invoiceId: string; invoiceNumber?: string; updatedLines: number; error?: string }> = [];
        for (const inv of invoices) {
          try {
            const data = await xeroWrite(`/Invoices/${inv.invoice_id}`, {
              InvoiceID: inv.invoice_id,
              LineItems: inv.line_items.map((li: any) => ({
                LineItemID: li.line_item_id,
                ...(li.account_code !== undefined ? { AccountCode: li.account_code } : {}),
                ...(li.description  !== undefined ? { Description: li.description }  : {}),
                ...(li.quantity     !== undefined ? { Quantity: li.quantity }         : {}),
                ...(li.unit_amount  !== undefined ? { UnitAmount: li.unit_amount }    : {}),
                ...(li.tax_type     !== undefined ? { TaxType: li.tax_type }          : {}),
              })),
            }, sc) as any;
            const updated = data.Invoices?.[0];
            results.push({ invoiceId: inv.invoice_id, invoiceNumber: updated?.InvoiceNumber, updatedLines: inv.line_items.length });
          } catch (err) {
            results.push({ invoiceId: inv.invoice_id, updatedLines: 0, error: (err as Error).message });
          }
        }
        const succeeded = results.filter(r => !r.error).length;
        const failed = results.filter(r => r.error).length;
        return { totalInvoices: invoices.length, succeeded, failed, results };
      }

      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (err) {
    return { error: (err as Error).message };
  }
}

// ─── Agent loop ───────────────────────────────────────────────────────────────

type ContentBlock = { type: string; [key: string]: unknown };
type Message = { role: string; content: string | ContentBlock[] };

// Trim history to prevent Anthropic context overflow.
// Keeps the last N message pairs and truncates large tool results.
function trimHistory(messages: Message[], maxBytes = 200_000): Message[] {
  // Truncate oversized tool_result content inline
  const trimmed = messages.map(m => {
    if (!Array.isArray(m.content)) return m;
    const content = m.content.map((b: any) => {
      if (b.type === "tool_result" && typeof b.content === "string" && b.content.length > 8000) {
        const parsed = (() => { try { return JSON.parse(b.content); } catch { return null; } })();
        const summary = parsed?.count != null
          ? `[Truncated — ${parsed.count} rows returned. Ask a more specific query to see results.]`
          : `[Truncated — result was ${b.content.length} chars. Ask a more specific query.]`;
        return { ...b, content: summary };
      }
      return b;
    });
    return { ...m, content };
  });

  // If still too large, drop oldest message pairs until under limit
  let result = trimmed;
  while (JSON.stringify(result).length > maxBytes && result.length > 2) {
    // Remove oldest pair (first two messages: user + assistant)
    result = result.slice(2);
  }
  return result;
}

async function runAgentLoop(
  messages: Message[],
  apiKey: string,
  today: string,
  sc: SC,
  userToken: string,
): Promise<{ text: string; history: Message[] }> {
  const systemPrompt = buildSystemPrompt(today);
  const loopMessages = trimHistory([...messages]);
  const MAX_ITERATIONS = 25;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        system: systemPrompt,
        tools,
        messages: loopMessages,
      }),
    });

    if (res.status === 429) {
      await new Promise(r => setTimeout(r, 3000));
      continue;
    }

    if (!res.ok) throw new Error(`Anthropic error ${res.status}: ${await res.text()}`);

    const result = await res.json();
    const content: ContentBlock[] = result.content ?? [];
    loopMessages.push({ role: "assistant", content });

    if (result.stop_reason !== "tool_use") {
      const text = content
        .filter(b => b.type === "text")
        .map(b => b.text as string)
        .join("\n")
        .trim() || "Done.";
      return { text, history: loopMessages };
    }

    const toolUseBlocks = content.filter(b => b.type === "tool_use");
    const toolResults = await Promise.all(
      toolUseBlocks.map(async (block: any) => {
        const isWrite = WRITE_TOOLS.has(block.name);
        const resultData = await executeTool(block.name, block.input, sc, userToken);
        return {
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(resultData),
          ...(isWrite ? { is_error: (resultData as any)?.error != null } : {}),
        };
      })
    );

    loopMessages.push({ role: "user", content: toolResults });
  }

  return {
    text: "I reached the maximum number of steps for this request. Please try a more specific question.",
    history: loopMessages,
  };
}

// ─── Entry point ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
  }

  const anonClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
  );
  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error: authError } = await anonClient.auth.getUser(token);
  if (authError || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
  }

  const serviceClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const body = await req.json();

    if (body.action === "check_connection") {
      const { data: row } = await serviceClient
        .from("xero_tokens")
        .select("tenant_name, refresh_token, updated_at")
        .eq("id", 1)
        .single();
      if (!row?.refresh_token) {
        return new Response(JSON.stringify({ not_connected: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // Also return last sync time
      const { data: lastSync } = await serviceClient
        .from("xero_sync_log")
        .select("completed_at, entity, records_synced")
        .not("completed_at", "is", null)
        .order("completed_at", { ascending: false })
        .limit(1)
        .single();

      return new Response(JSON.stringify({
        connected: true,
        tenant_name: row.tenant_name ?? null,
        last_sync: lastSync ?? null,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const message: string = body.message;
    const conversationHistory: Message[] = body.conversation_history ?? [];
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");

    const today = new Date().toISOString().split("T")[0];
    const messages: Message[] = [...conversationHistory, { role: "user", content: message }];

    const { text, history } = await runAgentLoop(messages, apiKey, today, serviceClient, authHeader);

    return new Response(JSON.stringify({ text, history }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const errMessage = (err as Error).message;
    const isNotConnected = errMessage.startsWith("XERO_NOT_CONNECTED:");
    return new Response(
      JSON.stringify({ error: errMessage, not_connected: isNotConnected }),
      { status: isNotConnected ? 200 : 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
