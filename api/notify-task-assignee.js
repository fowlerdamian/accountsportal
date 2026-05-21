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

// Google Chat link format is <URL|TEXT>; pipe / angle brackets in TEXT break it.
function safeLinkText(s) {
  return String(s ?? '').replace(/[|<>]/g, ' ').trim() || 'task'
}

function truncate(s, max) {
  if (!s) return ''
  const t = String(s).replace(/\s+/g, ' ').trim()
  return t.length > max ? t.slice(0, max) + '…' : t
}

// Same Eisenhower classifier as src/apps/Tasks/lib/eisenhower.ts
function quadrantLabel(urgency, importance) {
  const u = urgency    ?? 3
  const i = importance ?? 3
  if (i >= 3 && u >= 3) return 'Do'
  if (i >= 3)           return 'Schedule'
  if (u >= 3)           return 'Delegate'
  return 'Drop'
}

/**
 * Mirrors the Support hub's 3-line notification pattern
 * (see src/apps/Support/lib/notifyGoogleChat.ts):
 *
 *   Line 1: emoji + *<URL|linked-id>* — context
 *   Line 2: short summary / description
 *   Line 3: metadata · separated · by · middots
 */
function formatMessage({ event, taskId, taskTitle, description, dueDate, urgency, importance, actorName, parentTitle, blockerTitle, commentBody }) {
  const taskUrl   = `https://app.automotivegroup.com.au/tasks?task=${encodeURIComponent(taskId)}`
  const titleLink = `*<${taskUrl}|${safeLinkText(taskTitle)}>*`
  const summary   = truncate(description, 100) || '_no description_'
  const quad      = quadrantLabel(urgency, importance)
  const dueChip   = dueDate ? `Due ${dueDate}` : 'No due date'

  switch (event) {
    case 'assigned':
      return `📋 ${titleLink} — from ${actorName ?? 'someone'}\n${summary}\n${dueChip} · ${quad}`

    case 'dependency_assigned': {
      const forLine = parentTitle ? ` — for ${safeLinkText(parentTitle)}` : ''
      return `🔗 ${titleLink} — ${actorName ?? 'someone'} is waiting on you${forLine}\n${summary}\n${dueChip} · ${quad}`
    }

    case 'blocker_done': {
      const meta = blockerTitle ? `Was waiting on: ${safeLinkText(blockerTitle)}` : 'Unblocked'
      return `✅ ${titleLink} — unblocked\n${summary}\n${meta} · ${dueChip}`
    }

    case 'comment': {
      const body = truncate(commentBody, 100) || summary
      return `💬 ${titleLink} — comment from ${actorName ?? 'someone'}\n${body}\n${dueChip} · ${quad}`
    }

    default:
      return `📋 ${titleLink} — update\n${summary}\n${dueChip} · ${quad}`
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { task_id, recipient_id, event, task_title, actor_name, comment_body } = req.body ?? {}
  if (!task_id || !recipient_id || !event) {
    return res.status(400).json({ error: 'task_id, recipient_id, and event are required' })
  }

  try {
    // Recipient's personal webhook
    const profiles = await sb(
      `/profiles?id=eq.${recipient_id}&select=google_chat_webhook_url,full_name`,
    )
    const profile = profiles?.[0]

    // Pull task — title, description, due, score, parent + blocker IDs
    const tasks = await sb(
      `/staff_tasks?id=eq.${task_id}&select=title,description,due_date,urgency,importance,parent_task_id,blocked_by_task_id`,
    )
    const task = tasks?.[0]
    if (!task) return res.status(404).json({ error: 'task not found' })

    // Resolve parent + blocker titles in one round trip if either is present
    const lookupIds = [task.parent_task_id, task.blocked_by_task_id].filter(Boolean)
    let parentTitle = null
    let blockerTitle = null
    if (lookupIds.length > 0) {
      const linked = await sb(
        `/staff_tasks?id=in.(${lookupIds.join(',')})&select=id,title`,
      )
      const byId = Object.fromEntries((linked ?? []).map((r) => [r.id, r.title]))
      parentTitle  = task.parent_task_id     ? byId[task.parent_task_id]     ?? null : null
      blockerTitle = task.blocked_by_task_id ? byId[task.blocked_by_task_id] ?? null : null
    }

    const message = formatMessage({
      event,
      taskId:       task_id,
      taskTitle:    task_title ?? task.title,
      description:  task.description,
      dueDate:      task.due_date,
      urgency:      task.urgency,
      importance:   task.importance,
      actorName:    actor_name,
      parentTitle,
      blockerTitle,
      commentBody:  comment_body,
    })

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
