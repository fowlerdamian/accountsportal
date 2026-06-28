// Daily MTD finance digest — posts month-to-date Revenue, Gross Profit, OpEx and
// EBITDA to Damian's Google Chat. Refreshes the current-month snapshot first so
// the figures are genuinely up to "now", then reads finance_snapshot and posts.
//
// Wired in vercel.json: { "path": "/api/finance-mtd-digest", "schedule": "0 8 * * *" }
// 08:00 UTC ≈ 18:00 AEST. Sydney DST (AEDT, Oct–Apr) shifts this to 19:00 local —
// matches how the other portal crons are pinned to UTC. Adjust if that matters.

const RECIPIENT_EMAIL = 'damianf@automotivegroup.com.au'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

async function sb(path) {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase service env vars missing')
  const resp = await fetch(`${url}/rest/v1${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' },
  })
  if (!resp.ok) throw new Error(`Supabase ${resp.status}: ${await resp.text()}`)
  return resp.json()
}

async function refreshCurrentMonth() {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }
  if (process.env.FINANCE_CRON_SECRET) headers['x-cron-secret'] = process.env.FINANCE_CRON_SECRET
  const resp = await fetch(`${url}/functions/v1/xero-pl-snapshot`, {
    method: 'POST', headers, body: JSON.stringify({}), // default = current open month
  })
  if (!resp.ok) throw new Error(`xero-pl-snapshot ${resp.status}: ${await resp.text()}`)
  return resp.json()
}

async function postChat(webhook, text) {
  if (!webhook) return false
  try {
    const r = await fetch(webhook, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }),
    })
    return r.ok
  } catch (err) {
    console.warn('[finance-mtd-digest] chat post failed:', err.message)
    return false
  }
}

const money = (v) => {
  if (v == null) return '—'
  const n = Math.round(Number(v))
  const s = Math.abs(n).toLocaleString('en-AU')
  return n < 0 ? `-$${s}` : `$${s}`
}
const pct = (v) => (v == null ? '—' : `${(Number(v) * 100).toFixed(1)}%`)

export default async function handler(req, res) {
  try {
    // 1. Refresh the current month so the digest reflects today's MTD position.
    await refreshCurrentMonth()

    // 2. Read the current-month snapshot.
    const now = new Date()
    const ym = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
    const first = `${ym}-01`
    const [snap] = await sb(`/finance_snapshot?period_month=eq.${first}&select=*`)
    if (!snap) return res.status(200).json({ ok: true, skipped: 'no snapshot for current month' })

    // 3. Resolve the recipient's Google Chat webhook.
    const [prof] = await sb(`/profiles?email=eq.${encodeURIComponent(RECIPIENT_EMAIL)}&select=full_name,google_chat_webhook_url`)
    if (!prof?.google_chat_webhook_url) {
      return res.status(200).json({ ok: true, skipped: 'recipient has no Google Chat webhook' })
    }

    // 4. Build + post the message.
    const ebitdaMargin = snap.revenue ? Number(snap.ebitda) / Number(snap.revenue) : null
    const asAt = `${String(now.getUTCDate()).padStart(2, '0')} ${MONTHS[now.getUTCMonth()].slice(0, 3)}`
    const text = [
      `📊 *Finance — Month to Date* · ${MONTHS[now.getUTCMonth()]} ${now.getUTCFullYear()} (as at ${asAt})`,
      `_GST-exclusive · source: Xero_`,
      ``,
      `*Revenue:*  ${money(snap.revenue)}`,
      `*Gross Profit:*  ${money(snap.gross_profit)}  (${pct(snap.gross_profit_pct)})`,
      `*OpEx:*  ${money(snap.opex_ebitda)}`,
      `*EBITDA:*  ${money(snap.ebitda)}  (${pct(ebitdaMargin)})`,
      ...(snap.unmapped_count > 0 ? ['', `⚠️ ${snap.unmapped_count} unmapped P&L line(s) excluded — see the dashboard.`] : []),
      ``,
      `→ https://app.automotivegroup.com.au/accounts`,
    ].join('\n')

    const posted = await postChat(prof.google_chat_webhook_url, text)
    return res.status(200).json({ ok: true, posted, period: ym })
  } catch (err) {
    console.error('[finance-mtd-digest]', err)
    return res.status(500).json({ error: err.message })
  }
}
