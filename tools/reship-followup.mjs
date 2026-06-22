#!/usr/bin/env node
/**
 * Reship delivery follow-up
 * -------------------------
 * Standing rule: when a Support Hub case (public.cases) has a reship/replacement
 * tracking number, the staff member who made the case should follow up to confirm
 * the replacement parcel actually reached the customer.
 *
 * This script finds such cases that don't yet have a follow-up task and creates a
 * staff_tasks row assigned to the case owner. It is idempotent: each case is gated
 * on cases.reship_followup_at, so re-running only picks up new reships.
 *
 * Mapping note: cases.user_id references team_members(id), but staff_tasks.assigned_to
 * / created_by reference auth.users(id). We resolve the owner by email
 * (team_members.email -> profiles.email -> profiles.id, which equals the auth user id).
 *
 * Env:
 *   SUPABASE_URL                (default https://nvlezbqolzwixquusbfo.supabase.co)
 *   SUPABASE_SERVICE_ROLE_KEY   (required)
 *
 * Flags:
 *   --dry-run            Log what would happen; write nothing.
 *   --backfill           Ignore the age window (process every un-handled reship).
 *   --max-age-days=N     Only act on reships shipped within N days (default 30).
 *
 * Exit code is non-zero if any case failed.
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL =
  process.env.SUPABASE_URL || 'https://nvlezbqolzwixquusbfo.supabase.co'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const BACKFILL = args.includes('--backfill')
const maxAgeArg = args.find((a) => a.startsWith('--max-age-days='))
const MAX_AGE_DAYS = maxAgeArg ? Number(maxAgeArg.split('=')[1]) : 30

if (!SERVICE_ROLE_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY is not set. Aborting.')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

// Priorities for the generated task (staff_tasks check: 1..5).
const TASK_URGENCY = 3
const TASK_IMPORTANCE = 3
const DELIVERY_BUFFER_DAYS = 5 // due date = ship date + buffer (transit + chase time)

const CARRIER_LABELS = {
  tnt_australia: 'TNT Australia',
  startrack: 'StarTrack',
  australia_post: 'Australia Post',
  auspost: 'Australia Post',
  couriers_please: 'Couriers Please',
  aramex: 'Aramex',
  fastway: 'Aramex (Fastway)',
  tnt: 'TNT',
  dhl: 'DHL',
}

const CARRIER_TRACK_URL = {
  tnt_australia: (t) =>
    `https://www.tnt.com/express/en_au/site/shipping-tools/tracking.html?searchType=con&cons=${encodeURIComponent(t)}`,
  tnt: (t) =>
    `https://www.tnt.com/express/en_au/site/shipping-tools/tracking.html?searchType=con&cons=${encodeURIComponent(t)}`,
  startrack: (t) =>
    `https://startrack.com.au/track/search?id=${encodeURIComponent(t)}`,
  australia_post: (t) =>
    `https://auspost.com.au/mypost/track/#/details/${encodeURIComponent(t)}`,
  auspost: (t) =>
    `https://auspost.com.au/mypost/track/#/details/${encodeURIComponent(t)}`,
}

function carrierLabel(raw) {
  if (!raw) return 'carrier unknown'
  return (
    CARRIER_LABELS[raw] ||
    raw.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  )
}

function trackingUrl(carrier, tracking) {
  const fn = carrier ? CARRIER_TRACK_URL[carrier] : null
  return fn ? fn(tracking) : null
}

function dueDateFrom(shipDate) {
  const base = shipDate ? new Date(shipDate + 'T00:00:00Z') : new Date()
  base.setUTCDate(base.getUTCDate() + DELIVERY_BUFFER_DAYS)
  return base.toISOString().slice(0, 10) // YYYY-MM-DD
}

function buildTask(c, ownerId) {
  const carrier = carrierLabel(c.replacement_carrier)
  const url = trackingUrl(c.replacement_carrier, c.replacement_tracking_number)
  const title = `Confirm reship delivered — ${c.case_number} — ${c.customer_name || 'customer'}`
  const lines = [
    `Auto-created follow-up for Support Hub case ${c.case_number}.`,
    '',
    'A replacement (reship) parcel was sent for this case — confirm it actually reached the customer before considering it done.',
    '',
    `Customer: ${c.customer_name || '—'}`,
    `Order: ${c.order_number || c.cin7_order_number || '—'}`,
    `Reship tracking: ${c.replacement_tracking_number} (${carrier})`,
    c.replacement_ship_date ? `Shipped: ${c.replacement_ship_date}` : null,
    url ? `Track: ${url}` : null,
    '',
    'Action: check the tracking status / contact the customer to confirm delivery, then mark this task done.',
  ].filter((l) => l !== null)

  return {
    title,
    description: lines.join('\n'),
    status: 'not_started',
    assigned_to: ownerId,
    created_by: ownerId,
    urgency: TASK_URGENCY,
    importance: TASK_IMPORTANCE,
    due_date: dueDateFrom(c.replacement_ship_date),
  }
}

async function resolveOwnerId(teamMemberId) {
  // team_members -> email -> profiles.id (= auth.users.id)
  const { data: tm, error: tmErr } = await supabase
    .from('team_members')
    .select('email,name')
    .eq('id', teamMemberId)
    .maybeSingle()
  if (tmErr) throw tmErr
  if (!tm?.email) return { id: null, name: null, email: null }

  const { data: prof, error: pErr } = await supabase
    .from('profiles')
    .select('id,full_name')
    .ilike('email', tm.email)
    .maybeSingle()
  if (pErr) throw pErr
  return { id: prof?.id || null, name: tm.name, email: tm.email }
}

async function main() {
  console.log(
    `[reship-followup] start  dryRun=${DRY_RUN} backfill=${BACKFILL} maxAgeDays=${MAX_AGE_DAYS}`,
  )

  let query = supabase
    .from('cases')
    .select(
      'id, case_number, user_id, customer_name, order_number, cin7_order_number, status, replacement_tracking_number, replacement_carrier, replacement_ship_date',
    )
    .not('replacement_tracking_number', 'is', null)
    .neq('replacement_tracking_number', '')
    .is('reship_followup_at', null)
    .order('created_at', { ascending: true })

  if (!BACKFILL) {
    const cutoff = new Date()
    cutoff.setUTCDate(cutoff.getUTCDate() - MAX_AGE_DAYS)
    query = query.gte('replacement_ship_date', cutoff.toISOString().slice(0, 10))
  }

  const { data: cases, error } = await query
  if (error) {
    console.error('[reship-followup] query failed:', error.message)
    process.exit(1)
  }

  if (!cases.length) {
    console.log('[reship-followup] no cases need a follow-up task.')
    return
  }

  let ok = 0
  let skipped = 0
  let failed = 0

  for (const c of cases) {
    try {
      const owner = await resolveOwnerId(c.user_id)
      if (!owner.id) {
        console.warn(
          `[skip] ${c.case_number}: could not resolve owner (team_member ${c.user_id}, email ${owner.email || 'none'}) to an auth user`,
        )
        skipped++
        continue
      }

      const task = buildTask(c, owner.id)

      if (DRY_RUN) {
        console.log(
          `[dry-run] ${c.case_number}: would create task for ${owner.name} (${owner.email}) due ${task.due_date} — "${task.title}"`,
        )
        ok++
        continue
      }

      const { data: created, error: insErr } = await supabase
        .from('staff_tasks')
        .insert(task)
        .select('id')
        .single()
      if (insErr) throw insErr

      const { error: updErr } = await supabase
        .from('cases')
        .update({
          reship_followup_task_id: created.id,
          reship_followup_at: new Date().toISOString(),
        })
        .eq('id', c.id)
      if (updErr) {
        // Task exists but case wasn't stamped — surface loudly so it can be reconciled.
        throw new Error(
          `task ${created.id} created but failed to stamp case: ${updErr.message}`,
        )
      }

      console.log(
        `[ok] ${c.case_number}: task ${created.id} -> ${owner.name} (${owner.email}), due ${task.due_date}`,
      )
      ok++
    } catch (e) {
      console.error(`[fail] ${c.case_number}: ${e.message}`)
      failed++
    }
  }

  console.log(
    `[reship-followup] done  created=${ok} skipped=${skipped} failed=${failed}`,
  )
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error('[reship-followup] fatal:', e)
  process.exit(1)
})
