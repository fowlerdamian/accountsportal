import { createClient } from "npm:@supabase/supabase-js@2";
import { buildSystemPrompt } from "./systemPrompt.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ─── Xero client ──────────────────────────────────────────────────────────────

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
      scope: "accounting.transactions accounting.reports.read accounting.settings accounting.contacts accounting.journals.read",
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

async function xeroWrite(endpoint: string, body: unknown, method = "POST"): Promise<unknown> {
  const token = await getXeroToken();
  const tenantId = await getXeroTenantId();
  const url = `https://api.xero.com/api.xro/2.0${endpoint}`;
  const res = await fetch(url, {
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
  // ── Read tools ───────────────────────────────────────────────────────────────
  {
    name: "list_invoices",
    description: "List invoices from Xero with optional filters",
    input_schema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["ACCREC", "ACCPAY"], description: "ACCREC = sales invoices, ACCPAY = bills" },
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
    description: "Get full details of a specific invoice including line items",
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

  // ── Write tools ───────────────────────────────────────────────────────────────
  {
    name: "create_invoice",
    description: "Create a new sales invoice (ACCREC) or bill (ACCPAY) in Xero. WRITE OPERATION — only call after explicit user confirmation.",
    input_schema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["ACCREC", "ACCPAY"], description: "ACCREC = Sales Invoice, ACCPAY = Bill" },
        contact_id: { type: "string", description: "Xero ContactID (preferred)" },
        contact_name: { type: "string", description: "Contact name — used if contact_id is not known" },
        date: { type: "string", description: "YYYY-MM-DD, defaults to today" },
        due_date: { type: "string", description: "YYYY-MM-DD" },
        reference: { type: "string" },
        status: { type: "string", enum: ["DRAFT", "SUBMITTED", "AUTHORISED"], description: "Defaults to DRAFT" },
        line_items: {
          type: "array",
          description: "At least one line item required",
          items: {
            type: "object",
            properties: {
              description: { type: "string" },
              quantity: { type: "number" },
              unit_amount: { type: "number", description: "Price per unit (AUD)" },
              account_code: { type: "string", description: "Xero account code e.g. 200" },
              tax_type: { type: "string", description: "e.g. OUTPUT, INPUT, NONE — default OUTPUT for ACCREC, INPUT for ACCPAY" },
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
        invoice_id: { type: "string", description: "Xero InvoiceID or InvoiceNumber" },
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
        invoice_id: { type: "string", description: "Xero InvoiceID or InvoiceNumber" },
      },
      required: ["invoice_id"],
    },
  },
  {
    name: "create_manual_journal",
    description: "Create a manual journal entry in Xero. WRITE OPERATION — only call after explicit user confirmation. Lines must balance to zero.",
    input_schema: {
      type: "object",
      properties: {
        narration: { type: "string", description: "Journal description / narration" },
        date: { type: "string", description: "YYYY-MM-DD, defaults to today" },
        journal_lines: {
          type: "array",
          description: "Minimum two lines. Must balance to zero (debits = credits).",
          items: {
            type: "object",
            properties: {
              account_code: { type: "string" },
              description: { type: "string" },
              net_amount: { type: "number", description: "Positive = debit, negative = credit" },
              tax_type: { type: "string", description: "e.g. NONE, OUTPUT, INPUT" },
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

const WRITE_TOOLS = new Set(["create_invoice", "void_invoice", "approve_invoice", "create_manual_journal"]);

async function executeTool(name: string, input: Record<string, unknown>): Promise<unknown> {
  try {
    switch (name) {
      // ── Read ───────────────────────────────────────────────────────────────
      case "list_invoices": {
        const { type, status, contact_name, date_from, date_to, page = 1 } = input as any;
        const where: string[] = [];
        if (type) where.push(`Type=="${type}"`);
        if (status) where.push(`Status=="${status}"`);
        if (contact_name) where.push(`Contact.Name.Contains("${contact_name}")`);
        if (date_from) where.push(`Date>=DateTime(${String(date_from).replace(/-/g, ",")})`);
        if (date_to) where.push(`Date<=DateTime(${String(date_to).replace(/-/g, ",")})`);
        const params = new URLSearchParams({ page: String(page) });
        if (where.length) params.set("where", where.join("&&"));
        const data = await xeroRequest(`/Invoices?${params}`) as any;
        return data.Invoices?.map((inv: any) => ({
          invoiceId: inv.InvoiceID,
          invoiceNumber: inv.InvoiceNumber,
          type: inv.Type,
          contact: inv.Contact?.Name,
          date: inv.DateString,
          dueDate: inv.DueDateString,
          status: inv.Status,
          total: inv.Total,
          amountDue: inv.AmountDue,
          amountPaid: inv.AmountPaid,
          isOverdue: inv.IsOverdue,
        }));
      }

      case "get_invoice": {
        const data = await xeroRequest(`/Invoices/${input.invoice_id}`) as any;
        const inv = data.Invoices?.[0];
        if (!inv) return { error: "Invoice not found" };
        return {
          invoiceId: inv.InvoiceID,
          invoiceNumber: inv.InvoiceNumber,
          type: inv.Type,
          contact: inv.Contact?.Name,
          contactId: inv.Contact?.ContactID,
          date: inv.DateString,
          dueDate: inv.DueDateString,
          status: inv.Status,
          subtotal: inv.SubTotal,
          tax: inv.TotalTax,
          total: inv.Total,
          amountDue: inv.AmountDue,
          amountPaid: inv.AmountPaid,
          reference: inv.Reference,
          lineItems: inv.LineItems?.map((li: any) => ({
            description: li.Description,
            quantity: li.Quantity,
            unitAmount: li.UnitAmount,
            accountCode: li.AccountCode,
            taxType: li.TaxType,
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
          contactId: c.ContactID,
          name: c.Name,
          email: c.EmailAddress,
          phone: c.Phones?.find((p: any) => p.PhoneType === "DEFAULT")?.PhoneNumber,
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

      // ── Write ──────────────────────────────────────────────────────────────
      case "create_invoice": {
        const { type, contact_id, contact_name, date, due_date, reference, status = "DRAFT", line_items } = input as any;

        let contact: any = {};
        if (contact_id) {
          contact = { ContactID: contact_id };
        } else if (contact_name) {
          const searchData = await xeroRequest(`/Contacts?where=Name.Contains("${contact_name}")`) as any;
          const found = searchData.Contacts?.[0];
          contact = found ? { ContactID: found.ContactID } : { Name: contact_name };
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

        const data = await xeroWrite("/Invoices", { Invoices: [invoiceBody] }) as any;
        const inv = data.Invoices?.[0];
        if (!inv) throw new Error("Invoice creation returned no data");
        return {
          invoiceId: inv.InvoiceID,
          invoiceNumber: inv.InvoiceNumber,
          contact: inv.Contact?.Name,
          status: inv.Status,
          subtotal: inv.SubTotal,
          tax: inv.TotalTax,
          total: inv.Total,
          date: inv.DateString,
          dueDate: inv.DueDateString,
        };
      }

      case "void_invoice": {
        const { invoice_id } = input as any;
        const data = await xeroWrite(`/Invoices/${invoice_id}`, {
          Invoices: [{ InvoiceID: invoice_id, Status: "VOIDED" }],
        }) as any;
        const inv = data.Invoices?.[0];
        return {
          invoiceId: inv.InvoiceID,
          invoiceNumber: inv.InvoiceNumber,
          status: inv.Status,
        };
      }

      case "approve_invoice": {
        const { invoice_id } = input as any;
        const data = await xeroWrite(`/Invoices/${invoice_id}`, {
          Invoices: [{ InvoiceID: invoice_id, Status: "AUTHORISED" }],
        }) as any;
        const inv = data.Invoices?.[0];
        return {
          invoiceId: inv.InvoiceID,
          invoiceNumber: inv.InvoiceNumber,
          status: inv.Status,
          total: inv.Total,
        };
      }

      case "create_manual_journal": {
        const { narration, date, journal_lines } = input as any;

        // Validate balance
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
        const data = await xeroWrite("/ManualJournals", body) as any;
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

async function runAgentLoop(
  messages: Message[],
  apiKey: string,
  today: string,
): Promise<{ text: string; history: Message[] }> {
  const systemPrompt = buildSystemPrompt(today);
  const loopMessages = [...messages];
  const MAX_ITERATIONS = 10;

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
        max_tokens: 4096,
        system: systemPrompt,
        tools,
        messages: loopMessages,
      }),
    });

    if (res.status === 429) {
      // Rate limited — wait and retry once
      await new Promise(r => setTimeout(r, 3000));
      continue;
    }

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Anthropic error ${res.status}: ${errText}`);
    }

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
        const resultData = await executeTool(block.name, block.input);
        return {
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(resultData),
          // Tag write tool results so the model knows it was executed
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
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: { user }, error: authError } = await anonClient.auth.getUser();
  if (authError || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const message: string = body.message;
    const conversationHistory: Message[] = body.conversation_history ?? [];

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");

    const today = new Date().toISOString().split("T")[0];

    // Build messages: existing history + new user message
    const messages: Message[] = [
      ...conversationHistory,
      { role: "user", content: message },
    ];

    const { text, history } = await runAgentLoop(messages, apiKey, today);

    return new Response(JSON.stringify({ text, history }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = (err as Error).message;
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
