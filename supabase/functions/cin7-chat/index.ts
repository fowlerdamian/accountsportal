// cin7-chat — the "Ask Cin7" assistant. Same agent-loop shape as xero-chat,
// but tools hit the Cin7 Core (DEAR) External API v2 live via _shared/cin7-client
// (no local warehouse; DEAR is rate-limited to 60 calls/min so tools keep
// result pages small). Auth mirrors xero-chat: check_connection is open, chat
// requires a portal JWT.
import { createClient } from "npm:@supabase/supabase-js@2";
import { cin7Fetch } from "../_shared/cin7-client.ts";
import { buildSystemPrompt } from "./systemPrompt.ts";
import { resolveModel } from "../_shared/model.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ─── Cin7 call helper ────────────────────────────────────────────────────────

async function call(path: string, opts?: Parameters<typeof cin7Fetch>[1]) {
  const r = await cin7Fetch(path, opts);
  if (!r.ok) throw new Error(`Cin7 ${opts?.method ?? "GET"} ${path} → ${r.status}: ${r.error}`);
  return r.data;
}

// ─── Tool definitions ────────────────────────────────────────────────────────

const str = (description: string) => ({ type: "string", description });
const num = (description: string) => ({ type: "number", description });

const tools = [
  {
    name: "cin7_product_search",
    description: "Search the product catalogue by SKU and/or name. Returns matching products with pricing and identifiers.",
    input_schema: {
      type: "object",
      properties: {
        name: str("Match against product name/description (partial)."),
        sku: str("Match against SKU (partial)."),
        limit: num("Max results (default 20, max 100)."),
        page: num("Page number (default 1)."),
      },
    },
  },
  {
    name: "cin7_stock_availability",
    description: "Get on-hand / available / on-order stock levels for products. Filter by SKU, name and/or location.",
    input_schema: {
      type: "object",
      properties: {
        sku: str("Filter by SKU (partial)."),
        name: str("Filter by product name (partial)."),
        location: str("Filter by warehouse/location name."),
        limit: num("Max results (default 50, max 1000)."),
        page: num("Page number (default 1)."),
      },
    },
  },
  {
    name: "cin7_list_sales",
    description: "List sale orders. Filter by free-text search, status, customer, or created/updated-since date. Returns summaries; use cin7_get_sale for full detail.",
    input_schema: {
      type: "object",
      properties: {
        search: str("Free text (order number, customer, etc.)."),
        status: str("Order status, e.g. DRAFT, AUTHORISED, ORDERED, INVOICED, VOIDED."),
        customerId: str("Filter by Cin7 customer ID (GUID)."),
        createdSince: str("ISO date, e.g. 2026-01-01."),
        updatedSince: str("ISO date, e.g. 2026-06-01."),
        limit: num("Max results (default 20, max 1000)."),
        page: num("Page number (default 1)."),
      },
    },
  },
  {
    name: "cin7_get_sale",
    description: "Get the full detail of one sale order by its Cin7 sale ID (GUID) — lines, invoices, fulfilment, totals.",
    input_schema: {
      type: "object",
      properties: { id: str("Cin7 sale ID (GUID).") },
      required: ["id"],
    },
  },
  {
    name: "cin7_list_purchases",
    description: "List purchase orders. Filter by free-text search or created/updated-since date.",
    input_schema: {
      type: "object",
      properties: {
        search: str("Free text (PO number, supplier, etc.)."),
        createdSince: str("ISO date."),
        updatedSince: str("ISO date."),
        limit: num("Max results (default 20)."),
        page: num("Page number (default 1)."),
      },
    },
  },
  {
    name: "cin7_get_purchase",
    description: "Get the full detail of one purchase order by its Cin7 purchase ID (GUID).",
    input_schema: {
      type: "object",
      properties: { id: str("Cin7 purchase ID (GUID).") },
      required: ["id"],
    },
  },
  {
    name: "cin7_search_customers",
    description: "Search customers by name and/or email. Returns customer records with tags, terms and contact details.",
    input_schema: {
      type: "object",
      properties: {
        name: str("Customer name (partial)."),
        email: str("Customer email (exact)."),
        limit: num("Max results (default 20)."),
        page: num("Page number (default 1)."),
      },
    },
  },
  {
    name: "cin7_search_suppliers",
    description: "Search suppliers by name.",
    input_schema: {
      type: "object",
      properties: {
        name: str("Supplier name (partial)."),
        limit: num("Max results (default 20)."),
        page: num("Page number (default 1)."),
      },
    },
  },
  {
    name: "cin7_get",
    description: "Advanced read: GET any Cin7 Core v2 endpoint when no specific tool fits (e.g. '/me', '/ref/location', '/saleInvoice'). Read-only — GET only.",
    input_schema: {
      type: "object",
      properties: {
        path: str("Endpoint path, e.g. '/ref/location'."),
        query: { type: "object", description: "Query string params." },
      },
      required: ["path"],
    },
  },

  // ── Writes (confirmation protocol enforced by the system prompt) ───────────
  {
    name: "cin7_create_customer",
    description: "Create a new customer. Name is required. WRITE OPERATION — only call after explicit user confirmation.",
    input_schema: {
      type: "object",
      properties: {
        name: str("Customer name (required, must be unique in Cin7)."),
        email: str("Primary email."),
        phone: str("Phone."),
        currency: str("ISO currency code (default AUD)."),
        paymentTerm: str("Payment term name as configured in Cin7."),
        tags: str("Comma-separated tags."),
        extra: { type: "object", description: "Any additional Cin7 customer fields to merge in." },
      },
      required: ["name"],
    },
  },
  {
    name: "cin7_update_customer",
    description: "Update an existing customer — pass only the fields to change. WRITE OPERATION — only call after explicit user confirmation.",
    input_schema: {
      type: "object",
      properties: {
        id: str("Cin7 customer ID (GUID)."),
        fields: { type: "object", description: "Customer fields to update (e.g. {Email, Phone, Tags})." },
      },
      required: ["id", "fields"],
    },
  },
  {
    name: "cin7_create_sale",
    description: "Create a sale order. Provide the full Cin7 sale object via `order` (must include Customer and Location). WRITE OPERATION — only call after explicit user confirmation.",
    input_schema: {
      type: "object",
      properties: {
        order: { type: "object", description: "Full Cin7 sale payload for POST /sale." },
      },
      required: ["order"],
    },
  },
  {
    name: "cin7_stock_adjustment",
    description: "Create a stock adjustment (EffectiveDate, Account, Lines[]). WRITES TO LIVE INVENTORY — only call after explicit user confirmation.",
    input_schema: {
      type: "object",
      properties: {
        adjustment: { type: "object", description: "Full Cin7 payload for POST /stockAdjustment." },
      },
      required: ["adjustment"],
    },
  },
];

const WRITE_TOOLS = new Set(["cin7_create_customer", "cin7_update_customer", "cin7_create_sale", "cin7_stock_adjustment"]);

// ─── Tool execution ──────────────────────────────────────────────────────────

async function executeTool(name: string, input: Record<string, unknown>): Promise<unknown> {
  const a = input as any;
  try {
    switch (name) {
      case "cin7_product_search":
        return await call("/product", { query: { Name: a.name, SKU: a.sku, Limit: a.limit ?? 20, Page: a.page ?? 1 } });
      case "cin7_stock_availability":
        return await call("/ref/productavailability", { query: { Sku: a.sku, Name: a.name, Location: a.location, Limit: a.limit ?? 50, Page: a.page ?? 1 } });
      case "cin7_list_sales":
        return await call("/saleList", { query: { Search: a.search, Status: a.status, CustomerID: a.customerId, CreatedSince: a.createdSince, UpdatedSince: a.updatedSince, Limit: a.limit ?? 20, Page: a.page ?? 1 } });
      case "cin7_get_sale":
        return await call("/sale", { query: { ID: a.id } });
      case "cin7_list_purchases":
        return await call("/purchaseList", { query: { Search: a.search, CreatedSince: a.createdSince, UpdatedSince: a.updatedSince, Limit: a.limit ?? 20, Page: a.page ?? 1 } });
      case "cin7_get_purchase":
        return await call("/purchase", { query: { ID: a.id } });
      case "cin7_search_customers":
        return await call("/customer", { query: { Name: a.name, Email: a.email, Limit: a.limit ?? 20, Page: a.page ?? 1 } });
      case "cin7_search_suppliers":
        return await call("/supplier", { query: { Name: a.name, Limit: a.limit ?? 20, Page: a.page ?? 1 } });
      case "cin7_get":
        return await call(String(a.path), { query: a.query });
      case "cin7_create_customer":
        return await call("/customer", {
          method: "POST",
          body: { Name: a.name, Email: a.email, Phone: a.phone, Currency: a.currency ?? "AUD", PaymentTerm: a.paymentTerm, Tags: a.tags, ...(a.extra ?? {}) },
        });
      case "cin7_update_customer":
        return await call("/customer", { method: "POST", body: { ID: a.id, ...(a.fields ?? {}) } });
      case "cin7_create_sale":
        return await call("/sale", { method: "POST", body: a.order });
      case "cin7_stock_adjustment":
        return await call("/stockAdjustment", { method: "POST", body: a.adjustment });
      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (err) {
    return { error: (err as Error).message };
  }
}

// ─── Agent loop (mirrors xero-chat) ──────────────────────────────────────────

type ContentBlock = { type: string; [key: string]: unknown };
type Message = { role: string; content: string | ContentBlock[] };

function trimHistory(messages: Message[], maxBytes = 200_000): Message[] {
  const trimmed = messages.map(m => {
    if (!Array.isArray(m.content)) return m;
    const content = m.content.map((b: any) => {
      if (b.type === "tool_result" && typeof b.content === "string" && b.content.length > 40000) {
        return { ...b, content: `[Truncated — result was ${b.content.length} chars. Ask a more specific query.]` };
      }
      return b;
    });
    return { ...m, content };
  });

  let result = trimmed;
  while (JSON.stringify(result).length > maxBytes && result.length > 2) {
    let nextStart = -1;
    for (let i = 1; i < result.length; i++) {
      const m = result[i];
      if (m.role !== "user") continue;
      const isToolResult = Array.isArray(m.content) &&
        (m.content as any[]).some((b: any) => b.type === "tool_result");
      if (!isToolResult) { nextStart = i; break; }
    }
    if (nextStart <= 0) break;
    result = result.slice(nextStart);
  }
  return result;
}

function sanitizeHistory(messages: Message[]): Message[] {
  if (!messages.length) return messages;

  let start = 0;
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role !== "user") continue;
    const isToolResult = Array.isArray(m.content) &&
      (m.content as any[]).some((b: any) => b.type === "tool_result");
    if (!isToolResult) { start = i; break; }
  }
  let result = messages.slice(start);

  while (result.length > 0) {
    const last = result[result.length - 1];
    if (
      last.role === "assistant" &&
      Array.isArray(last.content) &&
      (last.content as any[]).some((b: any) => b.type === "tool_use")
    ) {
      result = result.slice(0, -1);
    } else break;
  }

  return result;
}

async function runAgentLoop(
  messages: Message[],
  apiKey: string,
  today: string,
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
        model: await resolveModel(apiKey),
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
        const resultData = await executeTool(block.name, block.input);
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

// ─── Entry point ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization") ?? "";

  try {
    const body = await req.json();

    // check_connection just reports whether Cin7 credentials are configured —
    // no user data, so it stays unauthenticated (same shape as xero-chat).
    if (body.action === "check_connection") {
      const connected = !!(Deno.env.get("CIN7_ACCOUNT_ID") && Deno.env.get("CIN7_API_KEY"));
      return new Response(
        JSON.stringify(connected ? { connected: true, tenant_name: "Cin7 Core — AGA" } : { not_connected: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const anonClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    );
    const { data: { user }, error: authError } = await anonClient.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const message: string = body.message;
    const conversationHistory: Message[] = body.conversation_history ?? [];
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");

    const today = new Date().toISOString().split("T")[0];
    const messages: Message[] = [...sanitizeHistory(conversationHistory), { role: "user", content: message }];

    const { text, history } = await runAgentLoop(messages, apiKey, today);

    return new Response(JSON.stringify({ text, history }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
