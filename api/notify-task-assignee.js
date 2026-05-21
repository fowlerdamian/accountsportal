// Posts a Google Chat DM to the assignee of a staff_tasks event.
// Looks up `profiles.google_chat_webhook_url` for the recipient and POSTs
// to it. Falls back to the shared CONTRACTOR_HUB_GCHAT_WEBHOOK if the
// recipient hasn't set a personal webhook — the message still surfaces in
// the team channel rather than vanishing silently.
//
// Triggered fire-and-forget from src/apps/Tasks/lib/notifyTaskChat.ts on
// task creation, dependency assignment, blocker resolution, and comments.

// ─── Service-role Supabase client (no extra deps — fetch only) ───────────────
async function sb(path, init = {}) {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase service env vars missing')
  const resp = await fetch(`${url}/rest/v1${path}`, {
    ...init,
    headers: {
      apikey:         key,
      Authorization:  `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
  if (!resp.ok) {
    const body = await resp.text()
    throw new Error(`Supabase ${resp.status}: ${body}`)
  }
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
    console.warn('[notify-task-assignee] chat post failed:', err.message)
    return false
  }
}

function formatMessage(event, taskTitle, dueDate, actorName, parentTitle) {
  const due = dueDate ? `  (due ${dueDate})` : ''
  const link = 'https://app.automotivegroup.com.au/tasks'
  switch (event) {
    case 'assigned':
      return `📋 *${actorName ?? 'Someone'}* assigned you a task: *${taskTitle}*${due}\n→ <${link}|Open Tasks>`
    case 'dependency_assigned':
      return `🔗 *${actorName ?? 'Someone'}* is waiting on you: *${taskTitle}*${due}` +
             (parentTitle ? `\n   for: ${parentTitle}` : '') +
             `\n→ <${link}|Open Tasks>`
    case 'blocker_done':
      return `✅ Your blocker has been resolved — *${taskTitle}* is unblocked${due}\n→ <${link}|Open Tasks>`
    case 'comment':
      return `💬 *${actorName ?? 'Someone'}* commented on *${taskTitle}*${due}\n→ <${link}|Open Tasks>`
    default:
      return `📋 Update on *${taskTitle}*${due}\n→ <${link}|Open Tasks>`
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { task_id, recipient_id, event, task_title, actor_name } = req.body ?? {}
  if (!task_id || !recipient_id || !event) {
    return res.status(400).json({ error: 'task_id, recipient_id, and event are required' })
  }

  try {
    // Recipient's personal webhook
    const profiles = await sb(
      `/profiles?id=eq.${recipient_id}&select=google_chat_webhook_url,full_name`,
    )
    const profile = profiles?.[0]

    // Pull task to fill in dueDate + parent title if we don't have them yet
    const tasks = await sb(
      `/staff_tasks?id=eq.${task_id}&select=title,due_date,parent_task_id`,
    )
    const task = tasks?.[0]
    if (!task) return res.status(404).json({ error: 'task not found' })

    let parentTitle = null
    if (task.parent_task_id) {
      const parents = await sb(
        `/staff_tasks?id=eq.${task.parent_task_id}&select=title`,
      )
      parentTitle = parents?.[0]?.title ?? null
    }

    const message = formatMessage(
      event,
      task_title ?? task.title,
      task.due_date,
      actor_name,
      parentTitle,
    )

    // Try personal webhook first, fall back to team channel
    let posted = false
    if (profile?.google_chat_webhook_url) {
      posted = await postChat(profile.google_chat_webhook_url, message)
    }
    if (!posted && process.env.CONTRACTOR_HUB_GCHAT_WEBHOOK) {
      const teamMsg = profile?.full_name
        ? `(for ${profile.full_name}) ${message}`
        : message
      posted = await postChat(process.env.CONTRACTOR_HUB_GCHAT_WEBHOOK, teamMsg)
    }

    return res.status(200).json({ ok: true, posted })
  } catch (err) {
    console.error('[notify-task-assignee]', err)
    return res.status(500).json({ error: err.message })
  }
}
