// Daily cron — pings every active assignee with their tasks that are
// overdue or due tomorrow. Skips users without a configured Google Chat
// webhook (no fallback spam to the team channel for individual reminders).
//
// Wired in vercel.json: { "path": "/api/task-reminders", "schedule": "0 22 * * *" }
// 22:00 UTC ≈ 08:00 AEST. Adjust if Sydney moves to DST.

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
    console.warn('[task-reminders] chat post failed:', err.message)
    return false
  }
}

function todayISO()    { return new Date().toISOString().split('T')[0] }
function tomorrowISO() {
  const d = new Date(); d.setDate(d.getDate() + 1)
  return d.toISOString().split('T')[0]
}

// "2026-05-23" → "23 May" — matches notify-task-assignee.js
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
function formatDueDate(iso) {
  if (!iso) return ''
  const [, m, d] = iso.split('-').map(Number)
  if (!m || !d || !MONTHS[m - 1]) return iso
  return `${String(d).padStart(2, '0')} ${MONTHS[m - 1]}`
}

export default async function handler(req, res) {
  try {
    const today    = todayISO()
    const tomorrow = tomorrowISO()

    // All open tasks due today, tomorrow, or earlier.
    const tasks = await sb(
      `/staff_tasks?status=in.(not_started,in_progress,blocked)` +
      `&due_date=lte.${tomorrow}` +
      `&select=id,title,due_date,assigned_to,created_by,urgency,importance`,
    )
    if (!Array.isArray(tasks) || tasks.length === 0) {
      return res.status(200).json({ ok: true, skipped: true, count: 0 })
    }

    // Sort by Eisenhower score then due date — highest-priority first.
    const byScore = (a, b) => {
      const sa = (a.urgency ?? 0) * (a.importance ?? 0)
      const sbx = (b.urgency ?? 0) * (b.importance ?? 0)
      if (sbx !== sa) return sbx - sa
      return (a.due_date ?? '').localeCompare(b.due_date ?? '')
    }

    // Group by assignee — "tasks on your plate".
    const byAssignee = new Map()
    for (const t of tasks) {
      const arr = byAssignee.get(t.assigned_to) ?? []
      arr.push(t)
      byAssignee.set(t.assigned_to, arr)
    }

    // Group by creator, excluding self-assigned — "tasks you've handed to
    // others and are still waiting on". This is what surfaces outstanding
    // work a person delegated so they can chase it up.
    const byDelegator = new Map()
    for (const t of tasks) {
      if (t.created_by === t.assigned_to) continue // not delegated
      const arr = byDelegator.get(t.created_by) ?? []
      arr.push(t)
      byDelegator.set(t.created_by, arr)
    }

    // Load every relevant profile (assignees + delegators) in one query.
    const ids = Array.from(new Set([...byAssignee.keys(), ...byDelegator.keys()]))
    const profiles = await sb(
      `/profiles?id=in.(${ids.join(',')})&select=id,full_name,google_chat_webhook_url`,
    )
    const profById = new Map(profiles.map((p) => [p.id, p]))
    const nameFor  = (id) => profById.get(id)?.full_name ?? 'someone'

    let posted = 0
    // Every user who is an assignee OR a delegator gets one combined digest.
    for (const userId of ids) {
      const prof = profById.get(userId)
      if (!prof?.google_chat_webhook_url) continue // skip if no webhook

      const mine = (byAssignee.get(userId) ?? []).slice().sort(byScore)
      const overdue  = mine.filter((t) => t.due_date < today)
      const dueToday = mine.filter((t) => t.due_date === today)
      const dueTmrw  = mine.filter((t) => t.due_date === tomorrow)

      // Delegated-out tasks still outstanding, grouped by who they landed on.
      const delegated = (byDelegator.get(userId) ?? []).slice().sort(byScore)

      // Nothing to say to this person — don't send an empty card.
      if (mine.length === 0 && delegated.length === 0) continue

      const lines = []
      lines.push(`📋 *Daily task digest* — ${mine.length} on your plate${delegated.length ? `, ${delegated.length} waiting on others` : ''}`)
      if (overdue.length)  lines.push(`\n⚠️ *Overdue (${overdue.length}):*\n${overdue.slice(0,5).map(t => `  • ${t.title} (${formatDueDate(t.due_date)})`).join('\n')}`)
      if (dueToday.length) lines.push(`\n📅 *Due today (${dueToday.length}):*\n${dueToday.slice(0,5).map(t => `  • ${t.title}`).join('\n')}`)
      if (dueTmrw.length)  lines.push(`\n🕐 *Due tomorrow (${dueTmrw.length}):*\n${dueTmrw.slice(0,5).map(t => `  • ${t.title}`).join('\n')}`)
      if (delegated.length) lines.push(`\n👥 *Waiting on others (${delegated.length}):*\n${delegated.slice(0,5).map(t => `  • ${t.title} — ${nameFor(t.assigned_to)} (${formatDueDate(t.due_date)})`).join('\n')}`)
      lines.push(`\n→ https://app.automotivegroup.com.au/tasks`)

      const ok = await postChat(prof.google_chat_webhook_url, lines.join('\n'))
      if (ok) posted++
    }

    return res.status(200).json({ ok: true, recipients: ids.length, posted })
  } catch (err) {
    console.error('[task-reminders]', err)
    return res.status(500).json({ error: err.message })
  }
}
