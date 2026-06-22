#!/usr/bin/env node
/**
 * Due-date reminder
 * -----------------
 * Standing rule: every open staff task should have a due date. This automation
 * nudges each staff member who still has open tasks without a due date.
 *
 * Per run, for every user who is the assignee of open (non-done) tasks:
 *   • If they have >=1 open task missing a due_date and DON'T already have an
 *     open reminder → create one ("Set due dates on your tasks"), due TODAY.
 *   • If they already have an open reminder → refresh it (due TODAY, updated
 *     count) so it keeps surfacing each day until they're done.
 *   • If they have NO open tasks missing a due_date but DO have an open
 *     reminder → close it (status=done). i.e. it auto-closes once every due
 *     date is set.
 *
 * The reminder task itself always has a due date (today), so it never counts
 * itself as "missing". Idempotent: the reminder is identified by its assignee
 * + the fixed REMINDER_TITLE, with created_by === assigned_to (self-assigned).
 *
 * Env:
 *   SUPABASE_URL                (default https://nvlezbqolzwixquusbfo.supabase.co)
 *   SUPABASE_SERVICE_ROLE_KEY   (required)
 *
 * Flags:
 *   --dry-run   Log what would happen; write nothing.
 *
 * Exit code is non-zero if any user failed.
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL =
  process.env.SUPABASE_URL || 'https://nvlezbqolzwixquusbfo.supabase.co'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const DRY_RUN = process.argv.slice(2).includes('--dry-run')

if (!SERVICE_ROLE_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY is not set. Aborting.')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

const REMINDER_TITLE = '📅 Set due dates on your tasks'
const TASK_URGENCY = 4 // urgent — it's a "today" nudge
const TASK_IMPORTANCE = 3

// Local YYYY-MM-DD (the scheduler runs in the box's local time, and the
// front-end's due-date colouring also compares in local time).
function todayLocal() {
  const d = new Date()
  const tz = d.getTimezoneOffset() * 60_000
  return new Date(d.getTime() - tz).toISOString().slice(0, 10)
}

function buildDescription(count) {
  return [
    `You have ${count} open task${count === 1 ? '' : 's'} without a due date.`,
    '',
    'Open your task list and add a due date to each one so they can be',
    'prioritised and tracked. This reminder closes itself automatically once',
    'every open task has a due date.',
  ].join('\n')
}

async function main() {
  console.log(`[due-date-reminder] start  dryRun=${DRY_RUN}`)
  const today = todayLocal()

  // All open (non-done) tasks across everyone.
  const { data: tasks, error } = await supabase
    .from('staff_tasks')
    .select('id, title, status, assigned_to, due_date')
    .neq('status', 'done')
  if (error) {
    console.error('[due-date-reminder] query failed:', error.message)
    process.exit(1)
  }

  // Group per assignee: count tasks missing a due date, and find any existing
  // open reminder (so we don't create duplicates).
  const byUser = new Map() // userId -> { missing: number, reminder: task|null }
  for (const t of tasks) {
    if (!t.assigned_to) continue
    const u = byUser.get(t.assigned_to) || { missing: 0, reminder: null }
    if (t.title === REMINDER_TITLE) {
      u.reminder = t
    } else if (!t.due_date) {
      u.missing += 1
    }
    byUser.set(t.assigned_to, u)
  }

  let created = 0
  let refreshed = 0
  let closed = 0
  let failed = 0

  for (const [userId, { missing, reminder }] of byUser) {
    try {
      if (missing > 0 && !reminder) {
        const row = {
          title: REMINDER_TITLE,
          description: buildDescription(missing),
          status: 'not_started',
          assigned_to: userId,
          created_by: userId,
          urgency: TASK_URGENCY,
          importance: TASK_IMPORTANCE,
          due_date: today,
          ai_summary: 'Set due dates',
        }
        if (DRY_RUN) {
          console.log(`[dry-run] create reminder for ${userId} — ${missing} task(s) missing due dates`)
        } else {
          const { error: insErr } = await supabase.from('staff_tasks').insert(row)
          if (insErr) throw insErr
          console.log(`[ok] created reminder for ${userId} — ${missing} missing`)
        }
        created++
      } else if (missing > 0 && reminder) {
        // Keep it surfacing: refresh due date to today and update the count.
        if (DRY_RUN) {
          console.log(`[dry-run] refresh reminder ${reminder.id} for ${userId} — ${missing} missing`)
        } else {
          const { error: updErr } = await supabase
            .from('staff_tasks')
            .update({ due_date: today, description: buildDescription(missing) })
            .eq('id', reminder.id)
          if (updErr) throw updErr
          console.log(`[ok] refreshed reminder ${reminder.id} for ${userId} — ${missing} missing`)
        }
        refreshed++
      } else if (missing === 0 && reminder) {
        // All due dates set → auto-close the reminder.
        if (DRY_RUN) {
          console.log(`[dry-run] close reminder ${reminder.id} for ${userId} — all due dates set`)
        } else {
          const { error: closeErr } = await supabase
            .from('staff_tasks')
            .update({ status: 'done', completed_at: new Date().toISOString() })
            .eq('id', reminder.id)
          if (closeErr) throw closeErr
          console.log(`[ok] closed reminder ${reminder.id} for ${userId}`)
        }
        closed++
      }
    } catch (e) {
      console.error(`[fail] ${userId}: ${e.message}`)
      failed++
    }
  }

  console.log(
    `[due-date-reminder] done  created=${created} refreshed=${refreshed} closed=${closed} failed=${failed}`,
  )
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error('[due-date-reminder] fatal:', e)
  process.exit(1)
})
