// Daily cron — end-of-day task score out of 10 for every active assignee,
// posted to their personal Google Chat webhook to encourage completing tasks.
// Skips users without a configured webhook, same as task-reminders.js.
//
// Score (out of 10):
//   • Delivery (6 pts) — share of tasks due today that got done (6 if nothing due)
//   • Backlog  (4 pts) — starts at 4, minus 1 per overdue open task
//   • Bonus            — +1 per extra completion today beyond due-today items (cap 10)
//
// Wired in vercel.json: { "path": "/api/task-score-report", "schedule": "0 7 * * 1-5" }
// 07:00 UTC ≈ 17:00 AEST. Adjust if Sydney moves to DST.

async function sb(path) {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase service env vars missing')
  const resp = await fetch(`${url}/rest/v1${path}`, {
    headers: {
      apikey:        key,
      Authorization: `Bearer ${key}`,
      Accept:        'application/json',
    },
  })
  if (!resp.ok) throw new Error(`Supabase ${resp.status}: ${await resp.text()}`)
  return resp.json()
}

async function postChat(webhookUrl, text) {
  if (!webhookUrl) return false
  try {
    const r = await fetch(webhookUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ text }),
    })
    return r.ok
  } catch (err) {
    console.warn('[task-score-report] chat post failed:', err.message)
    return false
  }
}

// Today's date in AEST (UTC+10, no DST in QLD)
function todayAEST() {
  return new Date(Date.now() + 10 * 3600 * 1000).toISOString().split('T')[0]
}

function scoreFor({ dueTodayTotal, dueTodayDone, overdue, doneToday }) {
  const delivery = dueTodayTotal > 0 ? 6 * (dueTodayDone / dueTodayTotal) : 6
  const backlog  = Math.max(0, 4 - overdue)
  const bonus    = Math.max(0, doneToday - dueTodayDone)
  return Math.max(0, Math.min(10, Math.round(delivery + backlog + bonus)))
}

function verdict(score) {
  if (score === 10) return '🏆 Perfect score — outstanding!'
  if (score >= 8)   return '💪 Great work — keep the streak going!'
  if (score >= 5)   return '👍 Solid effort — clear the overdue items to boost tomorrow’s score.'
  return '🔄 Tough day — pick one overdue task to knock over first thing tomorrow.'
}

export default async function handler(req, res) {
  try {
    const today      = todayAEST()
    const todayStart = encodeURIComponent(`${today}T00:00:00+10:00`)

    // Open tasks due today or earlier (overdue + due-today-open)
    const open = await sb(
      `/staff_tasks?status=in.(not_started,in_progress,blocked)` +
      `&due_date=lte.${today}` +
      `&select=id,assigned_to,due_date`,
    )
    // Everything due today regardless of status (today's planned load)
    const dueToday = await sb(
      `/staff_tasks?due_date=eq.${today}&select=id,assigned_to,status`,
    )
    // Completed today (AEST)
    const doneToday = await sb(
      `/staff_tasks?status=eq.done&completed_at=gte.${todayStart}` +
      `&select=id,assigned_to`,
    )

    // Per-user stats
    const stats = new Map()
    const get = (id) => {
      if (!id) return null
      if (!stats.has(id)) stats.set(id, { dueTodayTotal: 0, dueTodayDone: 0, overdue: 0, doneToday: 0 })
      return stats.get(id)
    }
    for (const t of open)      { const s = get(t.assigned_to); if (s && t.due_date < today) s.overdue++ }
    for (const t of dueToday)  { const s = get(t.assigned_to); if (s) { s.dueTodayTotal++; if (t.status === 'done') s.dueTodayDone++ } }
    for (const t of doneToday) { const s = get(t.assigned_to); if (s) s.doneToday++ }

    if (stats.size === 0) {
      return res.status(200).json({ ok: true, skipped: true, count: 0 })
    }

    const ids = Array.from(stats.keys())
    const profiles = await sb(
      `/profiles?id=in.(${ids.join(',')})&select=id,full_name,google_chat_webhook_url`,
    )
    const profById = new Map(profiles.map((p) => [p.id, p]))

    let posted = 0
    const results = []
    for (const [userId, s] of stats.entries()) {
      const prof = profById.get(userId)
      const score = scoreFor(s)
      results.push({ userId, ...s, score })
      if (!prof?.google_chat_webhook_url) continue // skip if no webhook

      const lines = [
        `🏅 *Daily task score: ${score}/10*`,
        '',
        `✅ Completed today: ${s.doneToday}`,
      ]
      if (s.dueTodayTotal > 0) lines.push(`📅 Due today done: ${s.dueTodayDone}/${s.dueTodayTotal}`)
      if (s.overdue > 0)       lines.push(`⚠️ Overdue: ${s.overdue}`)
      lines.push('', verdict(score), '', '→ https://app.automotivegroup.com.au/tasks')

      const ok = await postChat(prof.google_chat_webhook_url, lines.join('\n'))
      if (ok) posted++
    }

    return res.status(200).json({ ok: true, recipients: stats.size, posted, results })
  } catch (err) {
    console.error('[task-score-report]', err)
    return res.status(500).json({ error: err.message })
  }
}
