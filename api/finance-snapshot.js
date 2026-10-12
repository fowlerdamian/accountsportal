// Nightly cron — re-runs the Xero P&L snapshot for the current open month so the
// Finance Dashboard tab (Accounts module) always reflects the latest figures.
// Heavy lifting lives in the Supabase edge function `xero-pl-snapshot`; this thin
// route just invokes it, matching the established Vercel-cron → edge-function pattern.
//
// Wired in vercel.json: { "path": "/api/finance-snapshot", "schedule": "0 15 * * *" }
// 15:00 UTC ≈ 01:00 AEST — after the day's Xero activity has settled.
//
// Monthly backfill: { "path": "/api/finance-snapshot?backfill=24", "schedule": "30 15 1 * *" }
// Closed months only change when someone posts back into them (year-end journals,
// late bills), which the nightly run never sees — so re-pull two years monthly.

const MAX_BACKFILL_MONTHS = 24

export default async function handler(req, res) {
  try {
    const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !key) throw new Error('Supabase service env vars missing')

    const headers = {
      apikey:        key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    }
    // Optional shared secret (only enforced if FINANCE_CRON_SECRET is set on both ends).
    if (process.env.FINANCE_CRON_SECRET) headers['x-cron-secret'] = process.env.FINANCE_CRON_SECRET

    // ?backfill=N re-runs the trailing N months (capped) so journals posted to
    // already-closed months flow through to the snapshots.
    const n = parseInt(req.query?.backfill, 10)
    const backfill = Number.isFinite(n) && n > 0 ? Math.min(n, MAX_BACKFILL_MONTHS) : 0

    const resp = await fetch(`${url}/functions/v1/xero-pl-snapshot`, {
      method:  'POST',
      headers,
      body:    JSON.stringify(backfill ? { backfill } : {}), // default = current open month
    })

    const text = await resp.text()
    if (!resp.ok) throw new Error(`xero-pl-snapshot ${resp.status}: ${text}`)

    return res.status(200).json({ ok: true, result: JSON.parse(text) })
  } catch (err) {
    console.error('[finance-snapshot]', err)
    return res.status(500).json({ error: err.message })
  }
}
