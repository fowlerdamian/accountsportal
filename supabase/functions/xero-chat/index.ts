import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ─── Xero client (client_credentials) ────────────────────────────────────────

let cachedToken: string | null = null;
let tokenExpiresAt = 0;
let cachedTenantId: string | null = null;

async function getXeroToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiresAt - 60000) return cachedToken!;

  const clientId = Deno.env.get("XERO_CLIENT_ID")!;
  const clientSecret = Deno.env.get("XERO_CLIENT_SECRET")!;

  const res = await fetch("https://identity.xero.com/connect/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": "Basic " + btoa(`${clientId}:${clientSecret}`),
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: "accounting.transactions accounting.reports.read accounting.settings accounting.contacts",
    }),
  });

  if (!res.ok) throw new Error(`Xero token error: ${await res.text()}`);
  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + data.expires_in * 1000;
  return cachedToken!;
}

async function getXeroTenantId(): Promise<string> {
  if (cachedTenantId) return cachedTenantId!;
  const token = await getXeroToken();
  const res = await fetch("https://api.xero.com/connections", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Xero connections error: ${await res.text()}`);
  const connections = await res.json();
  if (!connections.length) throw new Error("No Xero connections found");
  cachedTenantId = connections[0].tenantId;
  return cachedTenantId!;
}

async function xeroRequest(endpoint: string): Promise<unknown> {
  const token = await getXeroToken();
  const tenantId = await getXeroTenantId();
  const url = `https://api.xero.com/api.xro/2.0${endpoint}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Xero-Tenant-Id": tenantId,
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`Xero API error (${res.status}): ${await res.text()}`);
  return res.json();
}

// ─── Tool definitions ─────────────────────────────────────────────────────────

const tools = [
  {
    name: "list_invoices",
    description: "List invoices from Xero with optional filters",
    input_schema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["DRAFT", "SUBMITTED", "AUTHORISED", "PAID", "VOIDED", "DELETED"] },
        contact_name: { type: "string", description: "Partial contact name match" },
        date_from: { type: "string", description: "YYYY-MM-DD" },
        date_to: { type: "string", description: "YYYY-MM-DD" },
        page: { type: "number" },
      },
    },
  },
  {
    name: "get_invoice",
    description: "Get full details of a specific invoice",
    input_schema: {
      type: "object",
      properties: {
        invoice_id: { type: "string", description: "Xero Invoice ID or Invoice Number" },
      },
      required: ["invoice_id"],
    },
  },
  {
    name: "list_bank_transactions",
    description: "List bank transactions from Xero for reconciliation",
    input_schema: {
      type: "object",
      properties: {
        bank_account_id: { type: "string" },
        date_from: { type: "string", description: "YYYY-MM-DD" },
        date_to: { type: "string", description: "YYYY-MM-DD" },
        status: { type: "string", enum: ["AUTHORISED", "DELETED"] },
        page: { type: "number" },
      },
    },
  },
  {
    name: "get_bank_statement",
    description: "Get bank statement lines for a specific bank account",
    input_schema: {
      type: "object",
      properties: {
        bank_account_id: { type: "string" },
        date_from: { type: "string", description: "YYYY-MM-DD" },
        date_to: { type: "string", description: "YYYY-MM-DD" },
      },
      required: ["bank_account_id"],
    },
  },
  {
    name: "list_payments",
    description: "List payments from Xero",
    input_schema: {
      type: "object",
      properties: {
        date_from: { type: "string", description: "YYYY-MM-DD" },
        date_to: { type: "string", description: "YYYY-MM-DD" },
        status: { type: "string", enum: ["AUTHORISED", "DELETED"] },
        page: { type: "number" },
      },
    },
  },
  {
    name: "list_accounts",
    description: "List chart of accounts or bank accounts",
    input_schema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["BANK", "REVENUE", "EXPENSE", "ASSET", "LIABILITY", "EQUITY", "ALL"] },
      },
    },
  },
  {
    name: "search_contacts",
    description: "Search for contacts (customers/suppliers) in Xero",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        is_supplier: { type: "boolean" },
        is_customer: { type: "boolean" },
        page: { type: "number" },
      },
    },
  },
  {
    name: "get_profit_and_loss",
    description: "Get Profit & Loss report from Xero",
    input_schema: {
      type: "object",
      properties: {
        from_date: { type: "string", description: "YYYY-MM-DD" },
        to_date: { type: "string", description: "YYYY-MM-DD" },
        periods: { type: "number" },
        timeframe: { type: "string", enum: ["MONTH", "QUARTER", "YEAR"] },
      },
    },
  },
  {
    name: "get_balance_sheet",
    description: "Get Balance Sheet report from Xero",
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string", description: "YYYY-MM-DD" },
        periods: { type: "number" },
        timeframe: { type: "string", enum: ["MONTH", "QUARTER", "YEAR"] },
      },
    },
  },
  {
    name: "get_trial_balance",
    description: "Get Trial Balance report from Xero",
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string", description: "YYYY-MM-DD" },
      },
    },
  },
  {
    name: "get_aged_receivables",
    description: "Get Aged Receivables report — overdue customer invoices",
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string", description: "YYYY-MM-DD" },
        contact_id: { type: "string" },
      },
    },
  },
  {
    name: "get_aged_payables",
    description: "Get Aged Payables report — overdue supplier bills",
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string", description: "YYYY-MM-DD" },
        contact_id: { type: "string" },
      },
    },
  },
  {
    name: "get_reconciliation_summary",
    description: "Get a summary of unreconciled items across bank accounts",
    input_schema: {
      type: "object",
      properties: {
        bank_account_id: { type: "string", description: "Omit for all bank accounts" },
      },
    },
  },
];

// ─── Tool execution ───────────────────────────────────────────────────────────

async function executeTool(name: string, input: Record<string, unknown>): Promise<unknown> {
  try {
    switch (name) {
      case "list_invoices": {
        const { status, contact_name, date_from, date_to, page = 1 } = input as any;
        const where: string[] = [];
        if (status) where.push(`Status=="${status}"`);
        if (contact_name) where.push(`Contact.Name.Contains("${contact_name}")`);
        if (date_from) where.push(`Date>=DateTime(${String(date_from).replace(/-/g, ",")})`);
        if (date_to) where.push(`Date<=DateTime(${String(date_to).replace(/-/g, ",")})`);
        const params = new URLSearchParams({ page: String(page) });
        if (where.length) params.set("where", where.join("&&"));
        const data = await xeroRequest(`/Invoices?${params}`) as any;
        return data.Invoices?.map((inv: any) => ({
          invoiceNumber: inv.InvoiceNumber,
          contact: inv.Contact?.Name,
          date: inv.DateString,
          dueDate: inv.DueDateString,
          status: inv.Status,
          total: inv.Total,
          amountDue: inv.AmountDue,
          amountPaid: inv.AmountPaid,
        }));
      }

      case "get_invoice": {
        const data = await xeroRequest(`/Invoices/${input.invoice_id}`) as any;
        const inv = data.Invoices?.[0];
        return {
          invoiceNumber: inv.InvoiceNumber,
          contact: inv.Contact?.Name,
          date: inv.DateString,
          dueDate: inv.DueDateString,
          status: inv.Status,
          subtotal: inv.SubTotal,
          tax: inv.TotalTax,
          total: inv.Total,
          amountDue: inv.AmountDue,
          lineItems: inv.LineItems?.map((li: any) => ({
            description: li.Description,
            quantity: li.Quantity,
            unitAmount: li.UnitAmount,
            lineAmount: li.LineAmount,
          })),
          payments: inv.Payments?.map((p: any) => ({
            date: p.DateString,
            amount: p.Amount,
            reference: p.Reference,
          })),
        };
      }

      case "list_bank_transactions": {
        const { bank_account_id, date_from, date_to, status, page = 1 } = input as any;
        const where: string[] = [];
        if (bank_account_id) where.push(`BankAccount.AccountID=guid("${bank_account_id}")`);
        if (status) where.push(`Status=="${status}"`);
        if (date_from) where.push(`Date>=DateTime(${String(date_from).replace(/-/g, ",")})`);
        if (date_to) where.push(`Date<=DateTime(${String(date_to).replace(/-/g, ",")})`);
        const params = new URLSearchParams({ page: String(page) });
        if (where.length) params.set("where", where.join("&&"));
        const data = await xeroRequest(`/BankTransactions?${params}`) as any;
        return data.BankTransactions?.map((tx: any) => ({
          type: tx.Type,
          contact: tx.Contact?.Name,
          date: tx.DateString,
          status: tx.Status,
          total: tx.Total,
          bankAccount: tx.BankAccount?.Name,
          reference: tx.Reference,
          isReconciled: tx.IsReconciled,
        }));
      }

      case "get_bank_statement": {
        const { bank_account_id, date_from, date_to } = input as any;
        const params = new URLSearchParams({ bankAccountID: bank_account_id });
        if (date_from) params.set("fromDate", date_from);
        if (date_to) params.set("toDate", date_to);
        const data = await xeroRequest(`/Reports/BankStatement?${params}`) as any;
        return data.Reports?.[0] ?? { message: "No statement data" };
      }

      case "list_payments": {
        const { date_from, date_to, status, page = 1 } = input as any;
        const where: string[] = [];
        if (status) where.push(`Status=="${status}"`);
        if (date_from) where.push(`Date>=DateTime(${String(date_from).replace(/-/g, ",")})`);
        if (date_to) where.push(`Date<=DateTime(${String(date_to).replace(/-/g, ",")})`);
        const params = new URLSearchParams({ page: String(page) });
        if (where.length) params.set("where", where.join("&&"));
        const data = await xeroRequest(`/Payments?${params}`) as any;
        return data.Payments?.map((p: any) => ({
          date: p.DateString,
          amount: p.Amount,
          reference: p.Reference,
          status: p.Status,
          invoiceNumber: p.Invoice?.InvoiceNumber,
          contact: p.Invoice?.Contact?.Name,
          bankAccount: p.Account?.Name,
          isReconciled: p.IsReconciled,
        }));
      }

      case "list_accounts": {
        const { type = "ALL" } = input as any;
        const endpoint = type === "ALL" ? "/Accounts" : `/Accounts?where=Type=="${type}"`;
        const data = await xeroRequest(endpoint) as any;
        return data.Accounts?.map((a: any) => ({
          accountId: a.AccountID,
          code: a.Code,
          name: a.Name,
          type: a.Type,
          bankAccountNumber: a.BankAccountNumber,
          status: a.Status,
        }));
      }

      case "search_contacts": {
        const { name, is_supplier, is_customer, page = 1 } = input as any;
        const where: string[] = [];
        if (name) where.push(`Name.Contains("${name}")`);
        if (is_supplier) where.push("IsSupplier==true");
        if (is_customer) where.push("IsCustomer==true");
        const params = new URLSearchParams({ page: String(page) });
        if (where.length) params.set("where", where.join("&&"));
        const data = await xeroRequest(`/Contacts?${params}`) as any;
        return data.Contacts?.map((c: any) => ({
          name: c.Name,
          email: c.EmailAddress,
          isSupplier: c.IsSupplier,
          isCustomer: c.IsCustomer,
          arOutstanding: c.Balances?.AccountsReceivable?.Outstanding,
          apOutstanding: c.Balances?.AccountsPayable?.Outstanding,
        }));
      }

      case "get_profit_and_loss": {
        const { from_date, to_date, periods, timeframe } = input as any;
        const params = new URLSearchParams();
        if (from_date) params.set("fromDate", from_date);
        if (to_date) params.set("toDate", to_date);
        if (periods) params.set("periods", String(periods));
        if (timeframe) params.set("timeframe", timeframe);
        const data = await xeroRequest(`/Reports/ProfitAndLoss?${params}`) as any;
        return data.Reports?.[0] ?? { message: "No report data" };
      }

      case "get_balance_sheet": {
        const { date, periods, timeframe } = input as any;
        const params = new URLSearchParams();
        if (date) params.set("date", date);
        if (periods) params.set("periods", String(periods));
        if (timeframe) params.set("timeframe", timeframe);
        const data = await xeroRequest(`/Reports/BalanceSheet?${params}`) as any;
        return data.Reports?.[0] ?? { message: "No report data" };
      }

      case "get_trial_balance": {
        const params = new URLSearchParams();
        if (input.date) params.set("date", input.date as string);
        const data = await xeroRequest(`/Reports/TrialBalance?${params}`) as any;
        return data.Reports?.[0] ?? { message: "No report data" };
      }

      case "get_aged_receivables": {
        const { date, contact_id } = input as any;
        const params = new URLSearchParams();
        if (date) params.set("date", date);
        if (contact_id) params.set("contactID", contact_id);
        const data = await xeroRequest(`/Reports/AgedReceivablesByContact?${params}`) as any;
        return data.Reports?.[0] ?? { message: "No report data" };
      }

      case "get_aged_payables": {
        const { date, contact_id } = input as any;
        const params = new URLSearchParams();
        if (date) params.set("date", date);
        if (contact_id) params.set("contactID", contact_id);
        const data = await xeroRequest(`/Reports/AgedPayablesByContact?${params}`) as any;
        return data.Reports?.[0] ?? { message: "No report data" };
      }

      case "get_reconciliation_summary": {
        const { bank_account_id } = input as any;
        const accountsData = await xeroRequest('/Accounts?where=Type=="BANK"') as any;
        let bankAccounts = accountsData.Accounts ?? [];
        if (bank_account_id) {
          bankAccounts = bankAccounts.filter((a: any) => a.AccountID === bank_account_id);
        }
        const summary = [];
        for (const account of bankAccounts) {
          const txData = await xeroRequest(
            `/BankTransactions?where=BankAccount.AccountID=guid("${account.AccountID}")&&IsReconciled==false&page=1`
          ) as any;
          const txs = txData.BankTransactions ?? [];
          const total = txs.reduce((sum: number, tx: any) => sum + (tx.Total || 0), 0);
          summary.push({
            accountName: account.Name,
            accountNumber: account.BankAccountNumber,
            unreconciledCount: txs.length,
            unreconciledTotal: Math.round(total * 100) / 100,
            oldestUnreconciled: txs.length > 0 ? txs[txs.length - 1]?.DateString : null,
          });
        }
        return { bankAccounts: summary };
      }

      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (err) {
    return { error: (err as Error).message };
  }
}

// ─── Agent loop ───────────────────────────────────────────────────────────────

async function runAgentLoop(
  messages: { role: string; content: unknown }[],
  apiKey: string,
  today: string,
): Promise<string> {
  const systemPrompt = `You are a financial assistant for Automotive Group Australia with direct access to their Xero accounting data.

Today's date: ${today}

Use the available tools to look up live data before answering. Be concise and professional.
- Format currency as $X,XXX (AUD unless otherwise noted)
- Format dates as "14 Apr 2026" style
- Use bullet points for lists of 3+ items
- Keep prose to 2–4 sentences
- If a question requires multiple lookups, do them all before responding`;

  const loopMessages = [...messages];
  const MAX_ITERATIONS = 8;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 2048,
        system: systemPrompt,
        tools,
        messages: loopMessages,
      }),
    });

    if (!res.ok) throw new Error(`Anthropic error: ${res.status} ${await res.text()}`);

    const result = await res.json();
    const content = result.content ?? [];
    loopMessages.push({ role: "assistant", content });

    if (result.stop_reason !== "tool_use") {
      return content
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text)
        .join("\n")
        .trim() || "Done.";
    }

    const toolUseBlocks = content.filter((b: any) => b.type === "tool_use");
    const toolResults = await Promise.all(
      toolUseBlocks.map(async (block: any) => ({
        type: "tool_result",
        tool_use_id: block.id,
        content: JSON.stringify(await executeTool(block.name, block.input)),
      }))
    );

    loopMessages.push({ role: "user", content: toolResults });
  }

  return "I ran into an issue completing that — please try again.";
}

// ─── Entry point ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
  }

  // Verify user is authenticated
  const anonClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: { user }, error: authError } = await anonClient.auth.getUser();
  if (authError || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
  }

  try {
    const { message, conversation_history = [] } = await req.json();
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");

    const today = new Date().toISOString().split("T")[0];
    const messages = [
      ...(conversation_history as { role: string; content: string }[]).map((m) => ({
        role: m.role,
        content: m.content,
      })),
      { role: "user", content: message },
    ];

    const text = await runAgentLoop(messages, apiKey, today);
    return new Response(JSON.stringify({ text }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[xero-chat]", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
