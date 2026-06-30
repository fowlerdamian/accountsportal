# cin7-mcp

A remote **Model Context Protocol (MCP)** server that exposes the Cin7 Core
(DEAR) inventory API to MCP clients (Claude Code, Claude Desktop, etc.).

- **Transport:** MCP Streamable HTTP. Clients POST JSON-RPC 2.0 to the function
  URL; the server replies with a JSON body. `GET` returns `405` (no
  server-initiated SSE stream).
- **Backend:** Supabase edge function on project `nvlezbqolzwixquusbfo`.
- **Endpoint:** `https://nvlezbqolzwixquusbfo.supabase.co/functions/v1/cin7-mcp`

## Auth

Two layers of secrets (set as Supabase function secrets):

| Secret             | Purpose                                              |
| ------------------ | ---------------------------------------------------- |
| `CIN7_ACCOUNT_ID`  | Cin7 `api-auth-accountid` header                     |
| `CIN7_API_KEY`     | Cin7 `api-auth-applicationkey` header                |
| `CIN7_MCP_TOKEN`   | Bearer token every MCP client must send (this gate)  |

When `CIN7_MCP_TOKEN` is set, every request must include
`Authorization: Bearer <CIN7_MCP_TOKEN>`. Deployed with `--no-verify-jwt` so
this bearer gate (not Supabase JWT) protects the endpoint.

## Tools

**Read:** `cin7_product_search`, `cin7_stock_availability`, `cin7_list_sales`,
`cin7_get_sale`, `cin7_list_purchases`, `cin7_get_purchase`,
`cin7_search_customers`, `cin7_search_suppliers`.

**Write (mutates live data):** `cin7_create_customer`, `cin7_update_customer`,
`cin7_create_sale`, `cin7_stock_adjustment`.

**Generic escape hatch:** `cin7_request` — arbitrary authenticated call to any
Cin7 Core v2 endpoint (`path`, `method`, `query`, `body`). Covers anything the
typed tools don't.

## Add to Claude Code

```bash
claude mcp add cin7-core \
  --transport http \
  https://nvlezbqolzwixquusbfo.supabase.co/functions/v1/cin7-mcp \
  --header "Authorization: Bearer <CIN7_MCP_TOKEN>"
```

(The active token value is stored in Supabase secrets, not in this repo. Retrieve
or rotate it with `supabase secrets set CIN7_MCP_TOKEN=...`.)

## Deploy / redeploy

```bash
supabase functions deploy cin7-mcp --no-verify-jwt
```

## Quick test

```bash
URL=https://nvlezbqolzwixquusbfo.supabase.co/functions/v1/cin7-mcp
curl -s -X POST "$URL" -H "Authorization: Bearer $CIN7_MCP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Layout

- `index.ts` — JSON-RPC handler + tool definitions.
- `../_shared/cin7-client.ts` — authenticated Cin7 v2 fetch with rate-limit
  (429/503) retry/backoff. Reusable by other `cin7-*` functions.
