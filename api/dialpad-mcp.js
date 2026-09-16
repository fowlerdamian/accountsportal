// Dialpad MCP — remote MCP server (Streamable HTTP, stateless JSON-RPC) that
// exposes Dialpad contacts + call information (call logs, call detail,
// transcripts, AI recaps, recording share links) to MCP clients such as
// Claude Code and claude.ai.
//
//   POST https://app.automotivegroup.com.au/api/dialpad-mcp
//   Authorization: Bearer <DIALPAD_MCP_TOKEN>
//
// Env (Vercel project "staff-portal"):
//   DIALPAD_API_KEY   — company API key from dialpad.com → Admin → API keys
//   DIALPAD_MCP_TOKEN — shared secret MCP clients must present (fail-closed)
//
// Register in Claude Code:
//   claude mcp add --transport http dialpad https://app.automotivegroup.com.au/api/dialpad-mcp \
//     --header "Authorization: Bearer <DIALPAD_MCP_TOKEN>"
//
// No SDK dependency on purpose — the Vite app's package.json stays untouched
// and the function cold-starts fast. Same approach as supabase/functions/cin7-mcp.

const DIALPAD_BASE = 'https://dialpad.com/api/v2'
const PROTOCOL_VERSION = '2025-06-18'
const SERVER_INFO = { name: 'dialpad-mcp', version: '1.0.0' }
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100 // contacts/users
const CALL_PAGE_LIMIT = 50 // Dialpad: "Limit cannot be greater than 50" on /call
const MAX_SCAN_PAGES = 10 // upper bound for client-side call filtering
// Dialpad rejects any started_after..started_before span of 30 days or more.
const MAX_WINDOW_MS = 30 * 86400e3 - 60e3
// Stop scanning before Vercel's 60s function limit and hand back a resume point.
const SCAN_BUDGET_MS = 40e3

// ─── Dialpad client ───────────────────────────────────────────────────────────

class DialpadError extends Error {
  constructor(status, body, path) {
    super(`Dialpad ${status} on ${path}: ${typeof body === 'string' ? body : JSON.stringify(body)}`)
    this.status = status
    this.body = body
  }
}

async function dp(method, path, { query, body, apiKey } = {}) {
  const url = new URL(`${DIALPAD_BASE}${path}`)
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v === undefined || v === null || v === '') continue
    url.searchParams.set(k, String(v))
  }
  const headers = { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  let resp
  for (let attempt = 0; attempt < 3; attempt++) {
    resp = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
    if (resp.status !== 429) break
    const retryAfter = Number(resp.headers.get('retry-after')) || 2 * (attempt + 1)
    await new Promise((r) => setTimeout(r, Math.min(retryAfter, 10) * 1000))
  }

  const text = await resp.text()
  let data
  try { data = text ? JSON.parse(text) : {} } catch { data = text }
  if (!resp.ok) throw new DialpadError(resp.status, data, path)
  return data
}

// ─── Normalisers ──────────────────────────────────────────────────────────────
// Dialpad timestamps are UTC ms since epoch and durations are ms (as floats or
// strings). Everything leaving this server is ISO-8601 + integer seconds so the
// model doesn't have to reason about units.

function toIso(ms) {
  const n = Number(ms)
  if (!ms || Number.isNaN(n)) return null
  return new Date(n).toISOString()
}

function toSeconds(ms) {
  const n = Number(ms)
  return Number.isFinite(n) ? Math.round(n / 1000) : 0
}

/** Accepts ISO-8601, "YYYY-MM-DD", or epoch ms/seconds → epoch ms. */
function toEpochMs(value, label) {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value === 'number') return value < 1e12 ? value * 1000 : value
  const s = String(value).trim()
  if (/^\d+$/.test(s)) return toEpochMs(Number(s), label)
  const t = Date.parse(s)
  if (Number.isNaN(t)) throw new Error(`${label} must be ISO-8601 or epoch ms (got "${value}")`)
  return t
}

function digits(raw) {
  return String(raw ?? '').replace(/\D/g, '')
}

/** Last 9 digits is enough to match +61 4xx xxx xxx against 04xx xxx xxx. */
function phoneKey(raw) {
  const d = digits(raw)
  return d.length >= 8 ? d.slice(-9) : null
}

/** Split [after, before) into Dialpad-sized slices, newest first. */
function windowSlices(after, before) {
  const slices = []
  let hi = before
  while (hi > after) {
    const lo = Math.max(after, hi - MAX_WINDOW_MS)
    slices.push({ started_after: lo, started_before: hi })
    hi = lo
  }
  return slices
}

function clampLimit(limit) {
  const n = Number(limit)
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT
  return Math.min(Math.floor(n), MAX_LIMIT)
}

function callStatus(c) {
  if (c.voicemail_link || c.voicemail_recording_id || c.state === 'voicemail') return 'voicemail'
  if (Number(c.duration) > 0 || c.date_connected) return 'answered'
  return 'missed'
}

function summariseCall(c) {
  return {
    call_id: c.call_id ?? c.id,
    direction: c.direction ?? null,
    status: callStatus(c),
    started_at: toIso(c.date_started),
    connected_at: toIso(c.date_connected),
    ended_at: toIso(c.date_ended),
    duration_seconds: toSeconds(c.duration),
    talk_seconds: toSeconds(c.talk_time),
    external_number: c.external_number ?? null,
    internal_number: c.internal_number ?? null,
    contact: c.contact
      ? { id: c.contact.id ?? null, name: c.contact.name ?? null, phone: c.contact.phone ?? null, email: c.contact.email ?? null, type: c.contact.type ?? null }
      : null,
    target: c.target
      ? { id: c.target.id ?? null, name: c.target.name ?? null, type: c.target.type ?? null, phone: c.target.phone ?? null }
      : null,
    was_recorded: Boolean(c.was_recorded),
    recording_ids: (c.recording_details ?? []).map((r) => ({ id: r.id, type: r.recording_type ?? r.type ?? 'callrecording', duration_seconds: toSeconds(r.duration) })),
    has_voicemail: Boolean(c.voicemail_link),
    mos_score: c.mos_score ?? null,
    csat_score: c.csat_score ?? null,
    is_transferred: Boolean(c.is_transferred),
    labels: c.labels ?? [],
  }
}

function summariseContact(c) {
  return {
    id: c.id,
    display_name: c.display_name ?? [c.first_name, c.last_name].filter(Boolean).join(' '),
    first_name: c.first_name ?? null,
    last_name: c.last_name ?? null,
    company_name: c.company_name ?? null,
    job_title: c.job_title ?? null,
    primary_phone: c.primary_phone ?? null,
    primary_email: c.primary_email ?? null,
    phones: c.phones ?? [],
    emails: c.emails ?? [],
    urls: c.urls ?? [],
    extension: c.extension ?? null,
    owner_id: c.owner_id ?? null,
    type: c.type ?? null,
  }
}

function summariseUser(u) {
  return {
    id: u.id,
    display_name: u.display_name ?? [u.first_name, u.last_name].filter(Boolean).join(' '),
    emails: u.emails ?? [],
    phone_numbers: u.phone_numbers ?? [],
    office_id: u.office_id ?? null,
    state: u.state ?? null,
    is_admin: Boolean(u.is_admin ?? u.company_admin),
  }
}

function transcriptView(t) {
  const lines = Array.isArray(t?.lines) ? t.lines : []
  const dialogue = []
  const moments = []
  for (const l of lines) {
    const entry = { time: l.time ?? null, speaker: l.name ?? null, user_id: l.user_id ?? null, contact_id: l.contact_id ?? null, type: l.type ?? 'transcript', content: l.content ?? '' }
    if (entry.type === 'transcript') dialogue.push(entry)
    else moments.push(entry)
  }
  return {
    call_id: t?.call_id ?? null,
    line_count: dialogue.length,
    moments,
    text: dialogue.map((l) => `${l.speaker ?? 'Unknown'}: ${l.content}`).join('\n'),
    dialogue,
  }
}

// ─── Client-side call filtering ───────────────────────────────────────────────
// The list endpoint can't filter by phone number or contact, so we page through
// a bounded date window and match locally. Uses the 1200/min list endpoint, not
// the 10/min get-call endpoint.

async function scanCalls(apiKey, { started_after, started_before, target_type, target_id, match, max }) {
  const out = []
  const t0 = Date.now()
  let pages = 0
  let oldestSeen = started_before
  const stop = (reason) => ({ calls: out, truncated: true, stop_reason: reason, resume_before: toIso(oldestSeen), scanned_pages: pages })
  for (const slice of windowSlices(started_after, started_before)) {
    let cursor
    do {
      if (pages >= MAX_SCAN_PAGES) return stop('page_limit')
      if (Date.now() - t0 > SCAN_BUDGET_MS) return stop('time_budget')
      const data = await dp('GET', '/call', { apiKey, query: { ...slice, target_type, target_id, cursor, limit: CALL_PAGE_LIMIT } })
      pages++
      for (const c of data.items ?? []) {
        const started = Number(c.date_started)
        if (Number.isFinite(started) && started < oldestSeen) oldestSeen = started
        if (match(c)) out.push(summariseCall(c))
        if (out.length >= max) return stop('max_results')
      }
      cursor = data.cursor
    } while (cursor)
  }
  return { calls: out, truncated: false, stop_reason: null, resume_before: null, scanned_pages: pages }
}

// ─── Tools ────────────────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'dialpad_search_contacts',
    description: 'Search Dialpad contacts by name. Returns shared company contacts by default; pass owner_id to search one user\'s personal contacts, or include_local to include everyone\'s local contacts. Cursor-paginated.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name filter (prefix/contains match on display name)' },
        owner_id: { type: 'string', description: 'Dialpad user ID — restrict to that user\'s local contacts' },
        include_local: { type: 'boolean', description: 'Include per-user local contacts (default true)' },
        cursor: { type: 'string', description: 'Pagination cursor from a previous response' },
        limit: { type: 'integer', description: `Max results per page (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT})` },
      },
    },
  },
  {
    name: 'dialpad_find_contact_by_phone',
    description: 'Find Dialpad contacts whose phone matches a number (any format — last digits are compared, so +61 4xx and 04xx match). Scans shared + local contacts.',
    inputSchema: {
      type: 'object',
      properties: {
        phone: { type: 'string', description: 'Phone number in any format' },
        max_pages: { type: 'integer', description: `Contact pages to scan (default ${MAX_SCAN_PAGES})` },
      },
      required: ['phone'],
    },
  },
  {
    name: 'dialpad_get_contact',
    description: 'Get a single Dialpad contact by ID.',
    inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'Contact ID' } }, required: ['id'] },
  },
  {
    name: 'dialpad_create_contact',
    description: 'Create a Dialpad contact. Phones must be E.164 (+61…); the first phone/email is primary. Omit owner_id for a company-wide shared contact.',
    inputSchema: {
      type: 'object',
      properties: {
        first_name: { type: 'string' },
        last_name: { type: 'string' },
        company_name: { type: 'string' },
        job_title: { type: 'string' },
        phones: { type: 'array', items: { type: 'string' }, description: 'E.164 phone numbers, primary first' },
        emails: { type: 'array', items: { type: 'string' }, description: 'Email addresses, primary first' },
        urls: { type: 'array', items: { type: 'string' } },
        extension: { type: 'string' },
        owner_id: { type: 'string', description: 'Create as a local contact for this user; omit for shared' },
      },
      required: ['first_name', 'last_name'],
    },
  },
  {
    name: 'dialpad_update_contact',
    description: 'Update fields on an existing Dialpad contact (PATCH). Only the fields you pass change. Arrays replace the existing list.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        first_name: { type: 'string' },
        last_name: { type: 'string' },
        company_name: { type: 'string' },
        job_title: { type: 'string' },
        phones: { type: 'array', items: { type: 'string' } },
        emails: { type: 'array', items: { type: 'string' } },
        urls: { type: 'array', items: { type: 'string' } },
        extension: { type: 'string' },
      },
      required: ['id'],
    },
  },
  {
    name: 'dialpad_list_calls',
    description: 'List concluded Dialpad calls in a date window (newest first). Filter to one user/department/office/call centre with target_type + target_id. Times are ISO-8601 or epoch ms; defaults to the last 7 days; one query covers at most 30 days (wider windows are clamped to the newest 30). Returns compact call summaries with recording IDs.',
    inputSchema: {
      type: 'object',
      properties: {
        started_after: { type: 'string', description: 'ISO-8601 / YYYY-MM-DD / epoch ms (default: 7 days ago)' },
        started_before: { type: 'string', description: 'ISO-8601 / YYYY-MM-DD / epoch ms (default: now)' },
        target_type: { type: 'string', enum: ['user', 'department', 'office', 'callcenter', 'callrouter', 'channel', 'room', 'staffgroup', 'coachinggroup', 'coachingteam'] },
        target_id: { type: 'string', description: 'ID of the target (e.g. a user ID from dialpad_list_users)' },
        direction: { type: 'string', enum: ['inbound', 'outbound'], description: 'Optional client-side direction filter' },
        status: { type: 'string', enum: ['answered', 'missed', 'voicemail'], description: 'Optional client-side status filter' },
        cursor: { type: 'string' },
        limit: { type: 'integer', description: `Per page (default ${DEFAULT_LIMIT}, max ${CALL_PAGE_LIMIT})` },
      },
    },
  },
  {
    name: 'dialpad_calls_for_contact',
    description: 'Call history with a specific person: pass a phone number (any format) and/or a Dialpad contact ID. Scans the date window (default last 30 days; wider windows are split into 30-day slices) newest first. Busy periods may be truncated by a time budget — the response then includes resume_before to continue.',
    inputSchema: {
      type: 'object',
      properties: {
        phone: { type: 'string', description: 'External phone number in any format' },
        contact_id: { type: 'string', description: 'Dialpad contact ID' },
        started_after: { type: 'string', description: 'Default: 30 days ago' },
        started_before: { type: 'string', description: 'Default: now' },
        target_type: { type: 'string', description: 'Optional: narrow to a user/department etc.' },
        target_id: { type: 'string' },
        max_results: { type: 'integer', description: 'Stop after this many matches (default 50)' },
      },
    },
  },
  {
    name: 'dialpad_get_call',
    description: 'Full detail for one call: parties, routing breadcrumbs, recording details, voicemail link, transcription text (if Dialpad attached one), quality scores. Rate-limited by Dialpad to 10/min — prefer dialpad_list_calls for bulk.',
    inputSchema: { type: 'object', properties: { call_id: { type: 'string' } }, required: ['call_id'] },
  },
  {
    name: 'dialpad_get_transcript',
    description: 'AI transcript for a call: speaker-labelled dialogue as text plus any AI "moments" (action items, questions, custom moments).',
    inputSchema: {
      type: 'object',
      properties: {
        call_id: { type: 'string' },
        include_dialogue: { type: 'boolean', description: 'Also return the structured line array (default false; text is always returned)' },
      },
      required: ['call_id'],
    },
  },
  {
    name: 'dialpad_get_ai_recap',
    description: 'Dialpad AI recap for a call: summary, action items, call purposes and disposition/outcome. summary_format: short | medium | long | bullet. Rate-limited to 12/min.',
    inputSchema: {
      type: 'object',
      properties: {
        call_id: { type: 'string' },
        summary_format: { type: 'string', enum: ['short', 'medium', 'long', 'bullet'] },
      },
      required: ['call_id'],
    },
  },
  {
    name: 'dialpad_get_recording_link',
    description: 'Get a shareable listen/download link for a call recording or voicemail. Pass a call_id (uses its first recording, or voicemail) or an explicit recording_id + recording_type. Creates a share link with the given privacy (default "company" = anyone in the org).',
    inputSchema: {
      type: 'object',
      properties: {
        call_id: { type: 'string' },
        recording_id: { type: 'string' },
        recording_type: { type: 'string', enum: ['callrecording', 'admincallrecording', 'voicemail'] },
        privacy: { type: 'string', enum: ['owner', 'admin', 'company', 'public'], description: 'Default company' },
      },
    },
  },
  {
    name: 'dialpad_list_users',
    description: 'List Dialpad users (staff) with their IDs, emails and numbers. Filter by email, name prefix, number or state. Use the ID as target_id for call filtering.',
    inputSchema: {
      type: 'object',
      properties: {
        email: { type: 'string' },
        first_name: { type: 'string', description: 'Prefix match' },
        last_name: { type: 'string', description: 'Prefix match' },
        number: { type: 'string', description: 'E.164 number' },
        state: { type: 'string', enum: ['active', 'suspended', 'deleted', 'pending', 'cancelled', 'all'] },
        cursor: { type: 'string' },
        limit: { type: 'integer' },
      },
    },
  },
  {
    name: 'dialpad_request',
    description: 'Raw passthrough to any Dialpad v2 endpoint for cases the typed tools don\'t cover (e.g. /sms, /departments, /offices, /stats). Path is relative to /api/v2. Raw Dialpad response is returned unchanged (ms timestamps).',
    inputSchema: {
      type: 'object',
      properties: {
        method: { type: 'string', enum: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'] },
        path: { type: 'string', description: 'e.g. "/offices" or "/call/123456"' },
        query: { type: 'object', additionalProperties: true },
        body: { type: 'object', additionalProperties: true },
      },
      required: ['method', 'path'],
    },
  },
]

const HANDLERS = {
  async dialpad_search_contacts(a, k) {
    const data = await dp('GET', '/contacts', { apiKey: k, query: { name: a.name, owner_id: a.owner_id, include_local: a.include_local ?? true, cursor: a.cursor, limit: clampLimit(a.limit) } })
    return { contacts: (data.items ?? []).map(summariseContact), cursor: data.cursor ?? null }
  },

  async dialpad_find_contact_by_phone(a, k) {
    const want = phoneKey(a.phone)
    if (!want) throw new Error('phone must contain at least 8 digits')
    const maxPages = Math.min(Number(a.max_pages) || MAX_SCAN_PAGES, 50)
    const matches = []
    let cursor
    for (let page = 0; page < maxPages; page++) {
      const data = await dp('GET', '/contacts', { apiKey: k, query: { include_local: true, cursor, limit: MAX_LIMIT } })
      for (const c of data.items ?? []) {
        const phones = [c.primary_phone, ...(c.phones ?? [])]
        if (phones.some((p) => phoneKey(p) === want)) matches.push(summariseContact(c))
      }
      cursor = data.cursor
      if (!cursor) break
    }
    return { query: a.phone, matches, scanned_all: !cursor }
  },

  async dialpad_get_contact(a, k) {
    return summariseContact(await dp('GET', `/contacts/${encodeURIComponent(a.id)}`, { apiKey: k }))
  },

  async dialpad_create_contact(a, k) {
    const { first_name, last_name, company_name, job_title, phones, emails, urls, extension, owner_id } = a
    const body = { first_name, last_name, company_name, job_title, phones, emails, urls, extension, owner_id }
    for (const key of Object.keys(body)) if (body[key] === undefined) delete body[key]
    return summariseContact(await dp('POST', '/contacts', { apiKey: k, body }))
  },

  async dialpad_update_contact(a, k) {
    const { id, ...rest } = a
    const allowed = ['first_name', 'last_name', 'company_name', 'job_title', 'phones', 'emails', 'urls', 'extension']
    const body = {}
    for (const key of allowed) if (rest[key] !== undefined) body[key] = rest[key]
    if (Object.keys(body).length === 0) throw new Error('pass at least one field to update')
    return summariseContact(await dp('PATCH', `/contacts/${encodeURIComponent(id)}`, { apiKey: k, body }))
  },

  async dialpad_list_calls(a, k) {
    const now = Date.now()
    const started_after = toEpochMs(a.started_after, 'started_after') ?? now - 7 * 86400e3
    const started_before = toEpochMs(a.started_before, 'started_before') ?? now
    // One request = one Dialpad window (<30 days). Wider asks are clamped to the newest 30 days;
    // use dialpad_calls_for_contact for multi-window scans.
    const clamped = started_before - started_after > MAX_WINDOW_MS
    const effective_after = clamped ? started_before - MAX_WINDOW_MS : started_after
    const data = await dp('GET', '/call', { apiKey: k, query: { started_after: effective_after, started_before, target_type: a.target_type, target_id: a.target_id, cursor: a.cursor, limit: Math.min(clampLimit(a.limit), CALL_PAGE_LIMIT) } })
    let calls = (data.items ?? []).map(summariseCall)
    if (a.direction) calls = calls.filter((c) => c.direction === a.direction)
    if (a.status) calls = calls.filter((c) => c.status === a.status)
    return {
      window: { started_after: toIso(effective_after), started_before: toIso(started_before) },
      ...(clamped ? { note: 'Dialpad limits one query to <30 days; window clamped to the newest 30 days. Pass an earlier started_before to page back.' } : {}),
      count: calls.length,
      calls,
      cursor: data.cursor ?? null,
    }
  },

  async dialpad_calls_for_contact(a, k) {
    const want = a.phone ? phoneKey(a.phone) : null
    const contactId = a.contact_id ? String(a.contact_id) : null
    if (!want && !contactId) throw new Error('pass phone and/or contact_id')
    const now = Date.now()
    const started_after = toEpochMs(a.started_after, 'started_after') ?? now - 30 * 86400e3
    const started_before = toEpochMs(a.started_before, 'started_before') ?? now
    const match = (c) => {
      if (contactId && String(c.contact?.id ?? '') === contactId) return true
      if (want && (phoneKey(c.external_number) === want || phoneKey(c.contact?.phone) === want)) return true
      return false
    }
    const { calls, truncated, stop_reason, resume_before, scanned_pages } = await scanCalls(k, { started_after, started_before, target_type: a.target_type, target_id: a.target_id, match, max: Number(a.max_results) || 50 })
    const answered = calls.filter((c) => c.status === 'answered')
    return {
      query: { phone: a.phone ?? null, contact_id: contactId },
      window: { started_after: toIso(started_after), started_before: toIso(started_before) },
      count: calls.length,
      answered: answered.length,
      total_talk_seconds: answered.reduce((s, c) => s + c.duration_seconds, 0),
      last_call_at: calls[0]?.started_at ?? null,
      truncated,
      ...(truncated ? { stop_reason, resume_before, hint: `Scan stopped (${stop_reason}) after ${scanned_pages} pages. Call again with started_before=${resume_before} to continue further back.` } : { scanned_pages }),
      calls,
    }
  },

  async dialpad_get_call(a, k) {
    const c = await dp('GET', `/call/${encodeURIComponent(a.call_id)}`, { apiKey: k })
    return {
      ...summariseCall(c),
      entry_point_target: c.entry_point_target ?? null,
      proxy_target: c.proxy_target ?? null,
      routing_breadcrumbs: c.routing_breadcrumbs ?? [],
      recording_details: (c.recording_details ?? []).map((r) => ({ ...r, start_time: toIso(r.start_time), duration_seconds: toSeconds(r.duration) })),
      call_recording_share_links: c.call_recording_share_links ?? [],
      voicemail_link: c.voicemail_link ?? null,
      voicemail_share_link: c.voicemail_share_link ?? null,
      voicemail_recording_id: c.voicemail_recording_id ?? null,
      transcription_text: c.transcription_text ?? null,
      custom_data: c.custom_data ?? null,
      state: c.state ?? null,
    }
  },

  async dialpad_get_transcript(a, k) {
    const view = transcriptView(await dp('GET', `/transcripts/${encodeURIComponent(a.call_id)}`, { apiKey: k }))
    if (!a.include_dialogue) delete view.dialogue
    return view
  },

  async dialpad_get_ai_recap(a, k) {
    return dp('GET', `/call/${encodeURIComponent(a.call_id)}/ai_recap`, { apiKey: k, query: { summary_format: a.summary_format } })
  },

  async dialpad_get_recording_link(a, k) {
    let recording_id = a.recording_id
    let recording_type = a.recording_type
    if (!recording_id) {
      if (!a.call_id) throw new Error('pass call_id or recording_id')
      const c = await dp('GET', `/call/${encodeURIComponent(a.call_id)}`, { apiKey: k })
      const rec = (c.recording_details ?? [])[0]
      if (rec) {
        recording_id = rec.id
        recording_type = recording_type ?? rec.recording_type ?? rec.type ?? 'callrecording'
      } else if (c.voicemail_recording_id) {
        recording_id = c.voicemail_recording_id
        recording_type = recording_type ?? 'voicemail'
      } else {
        return { call_id: a.call_id, recording: null, message: 'Call has no recording or voicemail' }
      }
    }
    const link = await dp('POST', '/recordingsharelink', { apiKey: k, body: { recording_id: String(recording_id), recording_type: recording_type ?? 'callrecording', privacy: a.privacy ?? 'company' } })
    return { call_id: link.call_id ?? a.call_id ?? null, recording_id, recording_type: link.type ?? recording_type, privacy: link.privacy, access_link: link.access_link, share_link_id: link.id }
  },

  async dialpad_list_users(a, k) {
    const data = await dp('GET', '/users', { apiKey: k, query: { email: a.email, first_name: a.first_name, last_name: a.last_name, number: a.number, state: a.state, cursor: a.cursor, limit: clampLimit(a.limit) } })
    return { users: (data.items ?? []).map(summariseUser), cursor: data.cursor ?? null }
  },

  async dialpad_request(a, k) {
    const path = String(a.path ?? '')
    if (!path.startsWith('/')) throw new Error('path must start with "/" (relative to /api/v2)')
    return dp(a.method, path, { apiKey: k, query: a.query, body: a.body })
  },
}

// ─── JSON-RPC plumbing ────────────────────────────────────────────────────────

const rpcResult = (id, result) => ({ jsonrpc: '2.0', id, result })
const rpcError = (id, code, message, data) => ({ jsonrpc: '2.0', id, error: { code, message, ...(data !== undefined ? { data } : {}) } })

async function callTool(name, args, apiKey) {
  const fn = HANDLERS[name]
  if (!fn) return { isError: true, content: [{ type: 'text', text: `Unknown tool: ${name}` }] }
  try {
    const result = await fn(args ?? {}, apiKey)
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: result }
  } catch (err) {
    const text = err instanceof DialpadError
      ? `Dialpad API error ${err.status}: ${typeof err.body === 'string' ? err.body : JSON.stringify(err.body)}`
      : `Error: ${err?.message ?? String(err)}`
    return { isError: true, content: [{ type: 'text', text }] }
  }
}

async function handleMessage(msg, apiKey) {
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    return rpcError(msg?.id ?? null, -32600, 'Invalid Request')
  }
  const { id, method, params } = msg
  const isNotification = id === undefined || id === null

  switch (method) {
    case 'initialize':
      return rpcResult(id, {
        protocolVersion: params?.protocolVersion ?? PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: 'Dialpad contacts and call information for Automotive Group Australia. Use dialpad_list_users to resolve staff IDs, dialpad_list_calls / dialpad_calls_for_contact for call history, then dialpad_get_transcript or dialpad_get_ai_recap for what was said. Timestamps are ISO-8601; durations are seconds.',
      })
    case 'ping':
      return rpcResult(id, {})
    case 'tools/list':
      return rpcResult(id, { tools: TOOLS })
    case 'tools/call':
      if (!apiKey) return rpcError(id, -32000, 'DIALPAD_API_KEY is not configured on the server')
      return rpcResult(id, await callTool(params?.name, params?.arguments, apiKey))
    case 'resources/list':
      return rpcResult(id, { resources: [] })
    case 'prompts/list':
      return rpcResult(id, { prompts: [] })
    default:
      if (isNotification) return null // notifications/initialized, notifications/cancelled …
      return rpcError(id, -32601, `Method not found: ${method}`)
  }
}

function authorised(req) {
  const expected = process.env.DIALPAD_MCP_TOKEN
  if (!expected) return false // fail closed
  const header = req.headers['authorization'] ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  return token.length > 0 && token === expected
}

// ─── Vercel handler ───────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, DELETE, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Mcp-Session-Id, Mcp-Protocol-Version')
    return res.status(204).end()
  }

  if (!authorised(req)) {
    res.setHeader('WWW-Authenticate', 'Bearer realm="dialpad-mcp"')
    return res.status(401).json({ error: process.env.DIALPAD_MCP_TOKEN ? 'unauthorized' : 'DIALPAD_MCP_TOKEN not configured' })
  }

  if (req.method === 'GET') {
    // Stateless server: no server-initiated SSE stream.
    return res.status(405).json({ error: 'SSE stream not supported; POST JSON-RPC messages' })
  }
  if (req.method === 'DELETE') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  let payload = req.body
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload) } catch { return res.status(400).json(rpcError(null, -32700, 'Parse error')) }
  }
  if (!payload) return res.status(400).json(rpcError(null, -32700, 'Parse error'))

  const apiKey = process.env.DIALPAD_API_KEY
  const messages = Array.isArray(payload) ? payload : [payload]
  const responses = (await Promise.all(messages.map((m) => handleMessage(m, apiKey)))).filter(Boolean)

  if (responses.length === 0) return res.status(202).end()
  res.setHeader('Content-Type', 'application/json')
  return res.status(200).json(Array.isArray(payload) ? responses : responses[0])
}
