/**
 * cin7-mcp — a remote Model Context Protocol (MCP) server for Cin7 Core (DEAR).
 *
 * Transport: MCP Streamable HTTP. The client POSTs JSON-RPC 2.0 messages to
 * this single endpoint; we reply with a JSON body (no server-initiated SSE
 * stream, so GET returns 405 per spec).
 *
 * Auth: if CIN7_MCP_TOKEN is set, every POST must carry
 *   Authorization: Bearer <CIN7_MCP_TOKEN>
 * Deploy with --no-verify-jwt so this gate (not Supabase's JWT) protects it.
 *
 * Cin7 credentials: CIN7_ACCOUNT_ID + CIN7_API_KEY (see _shared/cin7-client.ts).
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { cin7Fetch } from "../_shared/cin7-client.ts";

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "cin7-core", version: "1.0.0" };

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, mcp-protocol-version, mcp-session-id",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

// ─── Tool definitions ───────────────────────────────────────────────────────
// Each tool has a JSON-Schema inputSchema and an async handler that returns a
// plain JS value (serialised to text for the MCP content block).

interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, any>) => Promise<unknown>;
}

const str = (description: string) => ({ type: "string", description });
const num = (description: string) => ({ type: "number", description });

/** Throw on a failed Cin7 call so it surfaces as an MCP tool error. */
async function call(path: string, opts?: Parameters<typeof cin7Fetch>[1]) {
  const r = await cin7Fetch(path, opts);
  if (!r.ok) {
    throw new Error(`Cin7 ${opts?.method ?? "GET"} ${path} → ${r.status}: ${r.error}`);
  }
  return r.data;
}

const TOOLS: Tool[] = [
  // ── READ ──────────────────────────────────────────────────────────────────
  {
    name: "cin7_product_search",
    description:
      "Search the product catalogue by SKU and/or name. Returns matching products with pricing and identifiers.",
    inputSchema: {
      type: "object",
      properties: {
        name: str("Match against product name/description (partial)."),
        sku: str("Match against SKU (partial)."),
        limit: num("Max results (default 20, max 100)."),
        page: num("Page number (default 1)."),
      },
    },
    handler: (a) =>
      call("/product", {
        query: { Name: a.name, SKU: a.sku, Limit: a.limit ?? 20, Page: a.page ?? 1 },
      }),
  },
  {
    name: "cin7_stock_availability",
    description:
      "Get on-hand / available / on-order stock levels for products. Filter by SKU, name and/or location.",
    inputSchema: {
      type: "object",
      properties: {
        sku: str("Filter by SKU (partial)."),
        name: str("Filter by product name (partial)."),
        location: str("Filter by warehouse/location name."),
        limit: num("Max results (default 50, max 1000)."),
        page: num("Page number (default 1)."),
      },
    },
    handler: (a) =>
      call("/ref/productavailability", {
        query: {
          Sku: a.sku,
          Name: a.name,
          Location: a.location,
          Limit: a.limit ?? 50,
          Page: a.page ?? 1,
        },
      }),
  },
  {
    name: "cin7_list_sales",
    description:
      "List sale orders. Filter by free-text search, status, customer, or created/updated-since date. Returns summaries; use cin7_get_sale for full detail.",
    inputSchema: {
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
    handler: (a) =>
      call("/saleList", {
        query: {
          Search: a.search,
          Status: a.status,
          CustomerID: a.customerId,
          CreatedSince: a.createdSince,
          UpdatedSince: a.updatedSince,
          Limit: a.limit ?? 20,
          Page: a.page ?? 1,
        },
      }),
  },
  {
    name: "cin7_get_sale",
    description: "Get the full detail of one sale order by its Cin7 sale ID (GUID).",
    inputSchema: {
      type: "object",
      properties: { id: str("Cin7 sale ID (GUID).") },
      required: ["id"],
    },
    handler: (a) => call("/sale", { query: { ID: a.id } }),
  },
  {
    name: "cin7_list_purchases",
    description:
      "List purchase orders. Filter by free-text search or created/updated-since date.",
    inputSchema: {
      type: "object",
      properties: {
        search: str("Free text (PO number, supplier, etc.)."),
        createdSince: str("ISO date."),
        updatedSince: str("ISO date."),
        limit: num("Max results (default 20)."),
        page: num("Page number (default 1)."),
      },
    },
    handler: (a) =>
      call("/purchaseList", {
        query: {
          Search: a.search,
          CreatedSince: a.createdSince,
          UpdatedSince: a.updatedSince,
          Limit: a.limit ?? 20,
          Page: a.page ?? 1,
        },
      }),
  },
  {
    name: "cin7_get_purchase",
    description: "Get the full detail of one purchase order by its Cin7 purchase ID (GUID).",
    inputSchema: {
      type: "object",
      properties: { id: str("Cin7 purchase ID (GUID).") },
      required: ["id"],
    },
    handler: (a) => call("/purchase", { query: { ID: a.id } }),
  },
  {
    name: "cin7_search_customers",
    description: "Search customers by name and/or email.",
    inputSchema: {
      type: "object",
      properties: {
        name: str("Customer name (partial)."),
        email: str("Customer email (exact)."),
        limit: num("Max results (default 20)."),
        page: num("Page number (default 1)."),
      },
    },
    handler: (a) =>
      call("/customer", {
        query: { Name: a.name, Email: a.email, Limit: a.limit ?? 20, Page: a.page ?? 1 },
      }),
  },
  {
    name: "cin7_search_suppliers",
    description: "Search suppliers by name.",
    inputSchema: {
      type: "object",
      properties: {
        name: str("Supplier name (partial)."),
        limit: num("Max results (default 20)."),
        page: num("Page number (default 1)."),
      },
    },
    handler: (a) =>
      call("/supplier", { query: { Name: a.name, Limit: a.limit ?? 20, Page: a.page ?? 1 } }),
  },

  // ── WRITE ───────────────────────────────────────────────────────────────────
  {
    name: "cin7_create_customer",
    description:
      "Create a new customer. Name is required. Optional: email, phone, currency (default AUD), paymentTerm, tags, and any other Cin7 customer fields via `extra`.",
    inputSchema: {
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
    handler: (a) =>
      call("/customer", {
        method: "POST",
        body: {
          Name: a.name,
          Email: a.email,
          Phone: a.phone,
          Currency: a.currency ?? "AUD",
          PaymentTerm: a.paymentTerm,
          Tags: a.tags,
          ...(a.extra ?? {}),
        },
      }),
  },
  {
    name: "cin7_update_customer",
    description:
      "Update an existing customer. Requires the customer ID (GUID); pass only the fields to change via `fields`.",
    inputSchema: {
      type: "object",
      properties: {
        id: str("Cin7 customer ID (GUID)."),
        fields: { type: "object", description: "Customer fields to update (e.g. {Email, Phone, Tags})." },
      },
      required: ["id", "fields"],
    },
    handler: (a) =>
      call("/customer", { method: "POST", body: { ID: a.id, ...(a.fields ?? {}) } }),
  },
  {
    name: "cin7_create_sale",
    description:
      "Create a sale order. Provide the full Cin7 sale object via `order` (must include Customer, Location, and either Order.Lines or a quote/order block). This passes straight through to POST /sale — consult Cin7 docs for required fields. WRITES TO LIVE DATA.",
    inputSchema: {
      type: "object",
      properties: {
        order: { type: "object", description: "Full Cin7 sale payload for POST /sale." },
      },
      required: ["order"],
    },
    handler: (a) => call("/sale", { method: "POST", body: a.order }),
  },
  {
    name: "cin7_stock_adjustment",
    description:
      "Create a stock adjustment. Provide the full Cin7 stock-adjustment object via `adjustment` (EffectiveDate, Account, and Lines[]). Passes through to POST /stockAdjustment. WRITES TO LIVE INVENTORY.",
    inputSchema: {
      type: "object",
      properties: {
        adjustment: { type: "object", description: "Full Cin7 payload for POST /stockAdjustment." },
      },
      required: ["adjustment"],
    },
    handler: (a) => call("/stockAdjustment", { method: "POST", body: a.adjustment }),
  },

  // ── GENERIC ESCAPE HATCH ─────────────────────────────────────────────────────
  {
    name: "cin7_request",
    description:
      "Advanced: make an arbitrary authenticated call to any Cin7 Core v2 endpoint. Use when no specific tool fits. method defaults to GET. WRITE methods (POST/PUT/DELETE) mutate live data — use with care.",
    inputSchema: {
      type: "object",
      properties: {
        path: str("Endpoint path, e.g. '/me', '/saleList', '/product'."),
        method: { type: "string", enum: ["GET", "POST", "PUT", "DELETE"], description: "HTTP method (default GET)." },
        query: { type: "object", description: "Query string params." },
        body: { type: "object", description: "JSON body for POST/PUT." },
      },
      required: ["path"],
    },
    handler: (a) =>
      call(a.path, { method: a.method ?? "GET", query: a.query, body: a.body }),
  },
];

const TOOL_MAP = new Map(TOOLS.map((t) => [t.name, t]));

// ─── JSON-RPC plumbing ───────────────────────────────────────────────────────

interface RpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: any;
}

function rpcResult(id: RpcRequest["id"], result: unknown) {
  return { jsonrpc: "2.0", id, result };
}
function rpcError(id: RpcRequest["id"], code: number, message: string, data?: unknown) {
  return { jsonrpc: "2.0", id, error: { code, message, ...(data ? { data } : {}) } };
}

async function dispatch(msg: RpcRequest): Promise<unknown | null> {
  switch (msg.method) {
    case "initialize":
      return rpcResult(msg.id, {
        protocolVersion: msg.params?.protocolVersion ?? PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
      });

    case "tools/list":
      return rpcResult(msg.id, {
        tools: TOOLS.map(({ name, description, inputSchema }) => ({
          name,
          description,
          inputSchema,
        })),
      });

    case "tools/call": {
      const name = msg.params?.name;
      const tool = TOOL_MAP.get(name);
      if (!tool) return rpcError(msg.id, -32602, `Unknown tool: ${name}`);
      try {
        const data = await tool.handler(msg.params?.arguments ?? {});
        return rpcResult(msg.id, {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        });
      } catch (err) {
        // Tool-level error: report via isError so the model can react.
        return rpcResult(msg.id, {
          content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        });
      }
    }

    case "ping":
      return rpcResult(msg.id, {});

    default:
      // Notifications (no id) we silently accept; unknown requests get an error.
      if (msg.id === undefined || msg.id === null) return null;
      if (msg.method?.startsWith("notifications/")) return null;
      return rpcError(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

// ─── HTTP entrypoint ─────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // No server-initiated SSE stream → 405 on GET per the Streamable HTTP spec.
  if (req.method === "GET") {
    return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
  }

  // Bearer-token gate (only enforced when CIN7_MCP_TOKEN is configured).
  const expected = Deno.env.get("CIN7_MCP_TOKEN");
  if (expected) {
    const auth = req.headers.get("Authorization") ?? "";
    if (auth !== `Bearer ${expected}`) {
      return new Response(
        JSON.stringify(rpcError(null, -32001, "Unauthorized")),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return new Response(
      JSON.stringify(rpcError(null, -32700, "Parse error")),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // Support both single messages and JSON-RPC batches.
  const isBatch = Array.isArray(payload);
  const messages = (isBatch ? payload : [payload]) as RpcRequest[];

  const responses: unknown[] = [];
  for (const msg of messages) {
    const out = await dispatch(msg);
    if (out !== null) responses.push(out);
  }

  // Notifications only → 202 Accepted, no body.
  if (responses.length === 0) {
    return new Response(null, { status: 202, headers: corsHeaders });
  }

  const body = isBatch ? responses : responses[0];
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
