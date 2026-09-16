# Dialpad MCP (`api/dialpad-mcp.js`)

Remote MCP server (Streamable HTTP, stateless JSON-RPC) that exposes Dialpad
**contacts** and **call information** to MCP clients. Hosted as a Vercel
function on the staff portal.

- Endpoint: `https://app.automotivegroup.com.au/api/dialpad-mcp`
- Auth: `Authorization: Bearer <DIALPAD_MCP_TOKEN>` (fails closed if unset)

## Env vars (Vercel project `staff-portal`, Production + Preview)

| Var | Purpose |
|-----|---------|
| `DIALPAD_API_KEY` | Company API key — dialpad.com → Admin Settings → Company → Advanced → API keys. Needs the `ai_recap` scope for `dialpad_get_ai_recap`. |
| `DIALPAD_MCP_TOKEN` | Shared secret clients must present. Rotate by changing it and re-adding the MCP in each client. |

## Register in Claude Code

```bash
claude mcp add --transport http dialpad https://app.automotivegroup.com.au/api/dialpad-mcp \
  --header "Authorization: Bearer <DIALPAD_MCP_TOKEN>"
```

Run that from bash (Git Bash), not PowerShell, so the `--header` value survives.

## Tools

| Tool | What it does |
|------|--------------|
| `dialpad_search_contacts` | Name search over shared (and optionally local) contacts, cursor-paginated |
| `dialpad_find_contact_by_phone` | Match a phone number in any format (last 9 digits compared) |
| `dialpad_get_contact` | One contact by ID |
| `dialpad_create_contact` | Create shared or per-user contact (E.164 phones) |
| `dialpad_update_contact` | PATCH selected fields |
| `dialpad_list_calls` | Concluded calls in a date window; optional target (user/department/office) and direction/status filters |
| `dialpad_calls_for_contact` | Call history with one person by phone and/or contact ID, with answered count and talk time |
| `dialpad_get_call` | Full call record: parties, routing, recordings, voicemail, transcription text |
| `dialpad_get_transcript` | Speaker-labelled transcript text + AI moments |
| `dialpad_get_ai_recap` | AI summary, action items, purposes, disposition |
| `dialpad_get_recording_link` | Creates a share link for a call recording or voicemail |
| `dialpad_list_users` | Staff list with IDs (use as `target_id`) |
| `dialpad_request` | Raw passthrough to any `/api/v2` endpoint |

All timestamps leave the server as ISO-8601 and durations as integer seconds
(Dialpad natively uses epoch milliseconds for both).

## Dialpad limits worth knowing

- Any `started_after`..`started_before` span must be **under 30 days**. `dialpad_list_calls` clamps wider asks to the newest 30 days; `dialpad_calls_for_contact` slices wider windows automatically.
- `/call` pages are capped at **50** items; contacts and users at 100.
- Shared company contacts are empty for AGA; everything lives as per-user local contacts, so contact search includes local by default.

- `GET /call` (list) and `/transcripts` — 1200/min
- `GET /call/{id}` — **10/min** (so `dialpad_calls_for_contact` scans the list endpoint instead)
- `GET /call/{id}/ai_recap` — 12/min
- `POST /contacts` — 100/min

## Local smoke test

```bash
DIALPAD_API_KEY=... node -e "
import('./api/dialpad-mcp.js').then(async ({default: h}) => {
  process.env.DIALPAD_MCP_TOKEN='t'
  const res = { setHeader(){}, status(s){ this.s=s; return this }, json(b){ console.log(this.s, JSON.stringify(b).slice(0,500)); return this }, end(){ return this } }
  await h({ method:'POST', headers:{ authorization:'Bearer t' }, body:{ jsonrpc:'2.0', id:1, method:'tools/call', params:{ name:'dialpad_list_users', arguments:{ limit: 3 } } } }, res)
})"
```

Related: `supabase/functions/sales-dialpad-webhook` (inbound call events →
`sales_call_logs`) is the push side; this MCP is the pull side.
