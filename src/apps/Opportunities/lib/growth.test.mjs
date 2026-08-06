// Run with: node --test src/apps/Opportunities/lib/
// Uses Node's built-in test runner — no new devDependency.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  GROWTH_CONFIG,
  sizeFactor,
  winFactor,
  closeFactor,
  lastQualifyingActivityMs,
  computeOpportunityState,
} from './growth.js'

const DAY = 86_400_000
const NOW = Date.UTC(2026, 7, 6, 4, 0, 0) // fixed reference — engine never reads the clock

const baseOpp = {
  amount: 25_000,
  probability: 0.5,
  expected_close_date: null,
  is_parked: false,
  hubspot_created_at: new Date(NOW - 100 * DAY).toISOString(),
  created_at: new Date(NOW - 100 * DAY).toISOString(),
}

const activityAt = (ms) => ({ occurred_at: new Date(ms).toISOString() })

test('an open task does not reset the bubble', () => {
  const activities = [activityAt(NOW - 10 * DAY)]
  const openTask = { status: 'not_started', completed_at: null, created_at: new Date(NOW - 2 * DAY).toISOString() }
  const state = computeOpportunityState(baseOpp, activities, [openTask], NOW)
  assert.ok(Math.abs(state.daysSinceLastActivity - 10) < 1e-9,
    `open task must not move the anchor (got ${state.daysSinceLastActivity})`)
})

test('completing a task resets from completed_at, not created_at', () => {
  const activities = [activityAt(NOW - 10 * DAY)]
  const doneTask = {
    status: 'done',
    created_at: new Date(NOW - 9 * DAY).toISOString(),
    completed_at: new Date(NOW - 1 * DAY).toISOString(),
  }
  const state = computeOpportunityState(baseOpp, activities, [doneTask], NOW)
  assert.ok(Math.abs(state.daysSinceLastActivity - 1) < 1e-9,
    `must measure from completed_at (got ${state.daysSinceLastActivity})`)
})

test('un-completing recomputes from the next most recent qualifying activity', () => {
  const activities = [activityAt(NOW - 9 * DAY)]
  const reopened = { status: 'not_started', completed_at: null }
  const state = computeOpportunityState(baseOpp, activities, [reopened], NOW)
  assert.ok(Math.abs(state.daysSinceLastActivity - 9) < 1e-9)
  // Belt-and-braces: even a stale completed_at on a non-done task must not count.
  const staleTimestamp = { status: 'in_progress', completed_at: new Date(NOW - 1 * DAY).toISOString() }
  const state2 = computeOpportunityState(baseOpp, activities, [staleTimestamp], NOW)
  assert.ok(Math.abs(state2.daysSinceLastActivity - 9) < 1e-9,
    'a completed_at on a task that is not done must not qualify')
})

test('a parked deal does not grow and renders at base size', () => {
  const parked = { ...baseOpp, is_parked: true }
  const state = computeOpportunityState(parked, [activityAt(NOW - 400 * DAY)], [], NOW)
  assert.equal(state.parked, true)
  assert.equal(state.growthPerDay, 0)
  assert.equal(state.bloat, 0)
  assert.equal(state.health, 0)
  assert.equal(state.overTolerance, false)
  assert.equal(state.haloRadius, state.coreRadius)
})

test('slack goes negative past tolerance', () => {
  const state = computeOpportunityState(baseOpp, [activityAt(NOW - 365 * DAY)], [], NOW)
  assert.ok(state.bloat > GROWTH_CONFIG.toleranceUnits)
  assert.ok(state.slackDays < 0, `slackDays must be negative past tolerance (got ${state.slackDays})`)
  assert.ok(state.health > 1)
  assert.equal(state.overTolerance, true)
})

test('bigger, likelier, closer deals grow faster', () => {
  const activities = [activityAt(NOW - 14 * DAY)]
  const small = computeOpportunityState({ ...baseOpp, amount: 5_000 }, activities, [], NOW)
  const big = computeOpportunityState({ ...baseOpp, amount: 250_000 }, activities, [], NOW)
  assert.ok(big.bloat > small.bloat)

  const unlikely = computeOpportunityState({ ...baseOpp, probability: 0.1 }, activities, [], NOW)
  const likely = computeOpportunityState({ ...baseOpp, probability: 0.9 }, activities, [], NOW)
  assert.ok(likely.bloat > unlikely.bloat)

  const far = computeOpportunityState(
    { ...baseOpp, expected_close_date: new Date(NOW + 180 * DAY).toISOString().slice(0, 10) }, activities, [], NOW)
  const near = computeOpportunityState(
    { ...baseOpp, expected_close_date: new Date(NOW + 3 * DAY).toISOString().slice(0, 10) }, activities, [], NOW)
  assert.ok(near.bloat > far.bloat)
})

test('factor clamps hold at the extremes', () => {
  assert.equal(sizeFactor(1), GROWTH_CONFIG.size.min)
  assert.equal(sizeFactor(0), GROWTH_CONFIG.size.min)
  assert.equal(sizeFactor(null), GROWTH_CONFIG.size.min)
  assert.equal(sizeFactor(1e12), GROWTH_CONFIG.size.max)
  assert.equal(closeFactor(0), GROWTH_CONFIG.close.max)      // 45/20 = 2.25 exactly
  assert.equal(closeFactor(-30), GROWTH_CONFIG.close.max)    // overdue clamps to 0 days first
  assert.equal(closeFactor(Infinity), GROWTH_CONFIG.close.min)
  assert.equal(winFactor(null), GROWTH_CONFIG.win.base + GROWTH_CONFIG.win.defaultProbability * GROWTH_CONFIG.win.coef)
})

test('past-due close dates clamp daysToClose at zero (max urgency, no blow-up)', () => {
  const overdue = computeOpportunityState(
    { ...baseOpp, expected_close_date: new Date(NOW - 60 * DAY).toISOString().slice(0, 10) },
    [activityAt(NOW - 5 * DAY)], [], NOW)
  const dueToday = computeOpportunityState(
    { ...baseOpp, expected_close_date: new Date(NOW).toISOString().slice(0, 10) },
    [activityAt(NOW - 5 * DAY)], [], NOW)
  assert.ok(Math.abs(overdue.growthPerDay - dueToday.growthPerDay) < 0.01)
})

test('lastQualifyingActivityMs picks the max across activities and done tasks', () => {
  const ms = lastQualifyingActivityMs(
    [activityAt(NOW - 8 * DAY), activityAt(NOW - 3 * DAY)],
    [{ status: 'done', completed_at: new Date(NOW - 2 * DAY).toISOString() }],
  )
  assert.equal(ms, NOW - 2 * DAY)
  assert.equal(lastQualifyingActivityMs([], []), null)
})

test('no activity ever: anchor falls back to deal creation', () => {
  const state = computeOpportunityState(baseOpp, [], [], NOW)
  assert.ok(Math.abs(state.daysSinceLastActivity - 100) < 1e-9)
})
