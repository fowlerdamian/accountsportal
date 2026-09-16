// Dialpad → dialpad_calls sync for the Support Hub "Satisfaction" tab.
//
// Three phases, all time-budgeted so the function returns well inside Vercel's
// 60s limit and can simply be called again to continue:
//   1. pull    — list concluded calls from the watermark (max started_at − 2h,
//                or the last 30 days on first run) and upsert them
//   2. enrich  — fetch transcripts for answered calls that don't have one yet
//                (counts Dialpad "positive/negative_sentiment" moments)
//   3. grade   — send transcripts to the dialpad-grade edge function (Claude)
//                for csat / sentiment / resolved / purpose / summary / flags
//
// Triggers:
//   • Vercel cron (daily; Hobby plan allows one run/day) — GET with the
//     Vercel cron auth header
//   • Support Hub page load — POST with the staff user's Supabase JWT
//   • Manual: POST with `x-cron-secret: $FINANCE_CRON_SECRET`
//
// Env: DIALPAD_API_KEY, SUPABASE_URL/VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//      VITE_SUPABASE_PUBLISHABLE_KEY (JWT check), optional FINANCE_CRON_SECRET, CRON_SECRET.

const DIALPAD_BASE = 'https://dialpad.com/api/v2'
const CALL_PAGE_LIMIT = 50
const MAX_WINDOW_MS = 30 * 86400e3 - 60e3
const OVERLAP_MS = 2 * 3600e3
const BUDGET_MS = 42e3           // total wall-clock budget per invocation
const PULL_MAX_PAGES = 6
const ENRICH_MAX = 12
const GRADE_MAX = 8
const MIN_GRADE_SECONDS = 20     // shorter answered calls are skipped as "too_short"
const MIN_TRANSCRIPT_CHARS = 120

// ─── Dialpad ──────────────────────────────────────────────────────────────────

async function dp(path, query, apiKey) {
  const url = new URL(`${DIALPAD_BASE}${path}`)
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null) url.searchParams.set(k, String(v))
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' } })
    if (r.status === 429) { await new Promise((res) => setTimeout(res, 2000 * (attempt + 1))); continue }
    const text = await r.text()
    if (!r.ok) throw new Error(`Dialpad ${r.status} ${path}: ${text.slice(0, 200)}`)
    return text ? JSON.parse(text) : {}
  }
  throw new Error(`Dialpad rate-limited on ${path}`)
}

const toIso = (ms) => { const n = Number(ms); return ms && Number.isFinite(n) ? new Date(n).toISOString() : null }
const toSec = (ms) => { const n = Number(ms); return Number.isFinite(n) ? Math.round(n / 1000) : 0 }

function callStatus(c) {
  if (c.voicemail_link || c.voicemail_recording_id || c.state === 'voicemail') return 'voicemail'
  if (Number(c.duration) > 0 || c.date_connected) return 'answered'
  return 'missed'
}

function rowFromCall(c) {
  const started = Number(c.date_started)
  const connected = Number(c.date_connected)
  return {
    call_id: String(c.call_id),
    started_at: toIso(c.date_started),
    connected_at: toIso(c.date_connected),
    ended_at: toIso(c.date_ended),
    direction: c.direction === 'inbound' ? 'inbound' : 'outbound',
    status: callStatus(c),
    duration_seconds: toSec(c.duration),
    ring_seconds: Number.isFinite(started) && Number.isFinite(connected) && connected >= started ? Math.round((connected - started) / 1000) : null,
    external_number: c.external_number ?? null,
    internal_number: c.internal_number ?? null,
    contact_id: c.contact?.id ? String(c.contact.id) : null,
    contact_name: c.contact?.name ?? null,
    agent_id: c.target?.id ? String(c.target.id) : null,
    agent_name: c.target?.name ?? null,
    target_type: c.target?.type ?? null,
    was_recorded: Boolean(c.was_recorded),
    is_transferred: Boolean(c.is_transferred),
    has_voicemail: Boolean(c.voicemail_link),
    mos_score: c.mos_score ?? null,
    raw: c,
    synced_at: new Date().toISOString(),
  }
}

// ─── Supabase (service role, REST only) ───────────────────────────────────────

function sbEnv() {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase service env vars missing')
  return { url, key }
}

async function sb(path, init = {}) {
  const { url, key } = sbEnv()
  const r = await fetch(`${url}/rest/v1${path}`, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
  if (!r.ok) throw new Error(`Supabase ${r.status} ${path}: ${(await r.text()).slice(0, 300)}`)
  const text = await r.text()
  return text ? JSON.parse(text) : null
}

async function getAuthUserId(authHeader) {
  if (!authHeader?.startsWith('Bearer ')) return null
  const token = authHeader.slice(7).trim()
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
  const anon = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_ANON_KEY
  if (!token || !url || !anon) return null
  try {
    const r = await fetch(`${url}/auth/v1/user`, { headers: { apikey: anon, Authorization: `Bearer ${token}` } })
    if (!r.ok) return null
    return (await r.json())?.id ?? null
  } catch { return null }
}

// ─── Phases ───────────────────────────────────────────────────────────────────

async function pull(apiKey, deadline) {
  const latest = await sb('/dialpad_calls?select=started_at&order=started_at.desc&limit=1')
  const now = Date.now()
  let after = latest?.[0]?.started_at ? new Date(latest[0].started_at).getTime() - OVERLAP_MS : now - MAX_WINDOW_MS
  if (now - after > MAX_WINDOW_MS) after = now - MAX_WINDOW_MS
  let cursor, pages = 0, upserted = 0
  do {
    if (pages >= PULL_MAX_PAGES || Date.now() > deadline) break
    const data = await dp('/call', { started_after: after, started_before: now, cursor, limit: CALL_PAGE_LIMIT }, apiKey)
    pages++
    const rows = (data.items ?? []).filter((c) => c.call_id && c.date_started).map(rowFromCall)
    if (rows.length) {
      await sb('/dialpad_calls?on_conflict=call_id', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(rows),
      })
      upserted += rows.length
    }
    cursor = data.cursor
  } while (cursor)
  return { pages, upserted, from: toIso(after), complete: !cursor }
}

async function enrich(apiKey, deadline) {
  const pending = await sb(
    `/dialpad_calls?select=call_id,duration_seconds&status=eq.answered&transcript_fetched_at=is.null&ai_skip_reason=is.null&order=started_at.desc&limit=${ENRICH_MAX}`,
  )
  let fetched = 0, skipped = 0
  for (const row of pending ?? []) {
    if (Date.now() > deadline) break
    if (row.duration_seconds < MIN_GRADE_SECONDS) {
      await sb(`/dialpad_calls?call_id=eq.${row.call_id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ ai_skip_reason: 'too_short', transcript_fetched_at: new Date().toISOString() }) })
      skipped++
      continue
    }
    let t
    try { t = await dp(`/transcripts/${row.call_id}`, {}, apiKey) } catch (err) {
      // 404 = no transcript for this call (not recorded / AI off) — mark and move on.
      if (/Dialpad 404/.test(err.message)) {
        await sb(`/dialpad_calls?call_id=eq.${row.call_id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ ai_skip_reason: 'no_transcript', transcript_fetched_at: new Date().toISOString() }) })
        skipped++
        continue
      }
      throw err
    }
    const lines = Array.isArray(t?.lines) ? t.lines : []
    const dialogue = lines.filter((l) => (l.type ?? 'transcript') === 'transcript')
    const moments = lines.filter((l) => (l.type ?? 'transcript') !== 'transcript')
    const text = dialogue.map((l) => `${l.name ?? 'Unknown'}: ${l.content ?? ''}`).join('\n')
    const patch = {
      transcript_lines: dialogue.length,
      transcript_text: text,
      transcript_fetched_at: new Date().toISOString(),
      positive_moments: moments.filter((m) => m.content === 'positive_sentiment').length,
      negative_moments: moments.filter((m) => m.content === 'negative_sentiment').length,
    }
    if (text.length < MIN_TRANSCRIPT_CHARS) { patch.ai_skip_reason = 'no_transcript'; skipped++ } else fetched++
    await sb(`/dialpad_calls?call_id=eq.${row.call_id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(patch) })
  }
  return { fetched, skipped, remaining: Math.max(0, (pending?.length ?? 0) - fetched - skipped) }
}

async function grade(deadline) {
  const { url, key } = sbEnv()
  const pending = await sb(
    `/dialpad_calls?select=call_id,direction,agent_name,contact_name,duration_seconds,transcript_text&status=eq.answered&ai_graded_at=is.null&ai_skip_reason=is.null&transcript_text=not.is.null&order=started_at.desc&limit=${GRADE_MAX}`,
  )
  let graded = 0, failed = 0
  for (const row of pending ?? []) {
    if (Date.now() > deadline) break
    const r = await fetch(`${url}/functions/v1/dialpad-grade`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        call_id: row.call_id, direction: row.direction, agent_name: row.agent_name,
        contact_name: row.contact_name, duration_seconds: row.duration_seconds, transcript: row.transcript_text,
      }),
    })
    if (!r.ok) {
      failed++
      console.warn('[dialpad-sync] grade failed', row.call_id, r.status, (await r.text()).slice(0, 200))
      continue
    }
    const g = await r.json()
    await sb(`/dialpad_calls?call_id=eq.${row.call_id}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        ai_csat: g.csat, ai_sentiment: g.sentiment, ai_resolved: g.resolved, ai_purpose: g.purpose,
        ai_summary: g.summary, ai_flags: g.flags ?? [], ai_graded_at: new Date().toISOString(), ai_model: g.model ?? null,
        ...(g.purpose === 'Internal' ? { ai_skip_reason: 'internal' } : {}),
      }),
    })
    graded++
  }
  return { graded, failed, remaining: Math.max(0, (pending?.length ?? 0) - graded - failed) }
}

// ─── Handler ──────────────────────────────────────────────────────────────────

async function authorised(req) {
  const cronSecret = process.env.CRON_SECRET
  const auth = req.headers['authorization'] ?? ''
  if (cronSecret && auth === `Bearer ${cronSecret}`) return 'cron'
  const shared = process.env.FINANCE_CRON_SECRET
  if (shared && req.headers['x-cron-secret'] === shared) return 'secret'
  if (await getAuthUserId(auth)) return 'user'
  return null
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST' && req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const who = await authorised(req)
  if (!who) return res.status(401).json({ error: 'unauthorized' })

  const apiKey = process.env.DIALPAD_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'DIALPAD_API_KEY not configured' })

  const t0 = Date.now()
  const deadline = t0 + BUDGET_MS
  const phases = (req.query?.phase ?? (typeof req.body === 'object' ? req.body?.phase : null)) ?? 'all'
  const out = { trigger: who }
  try {
    if (phases === 'all' || phases === 'pull') out.pull = await pull(apiKey, deadline)
    if (phases === 'all' || phases === 'enrich') out.enrich = await enrich(apiKey, deadline)
    if (phases === 'all' || phases === 'grade') out.grade = await grade(deadline)
    out.elapsed_ms = Date.now() - t0
    out.more = Boolean((out.enrich?.remaining ?? 0) || (out.grade?.remaining ?? 0) || (out.pull && !out.pull.complete))
    return res.status(200).json(out)
  } catch (err) {
    console.error('[dialpad-sync]', err)
    return res.status(500).json({ ...out, error: err?.message ?? String(err), elapsed_ms: Date.now() - t0 })
  }
}
