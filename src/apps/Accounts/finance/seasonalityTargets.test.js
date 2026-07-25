// Run: node --test src/apps/Accounts/finance/seasonalityTargets.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSeasonalityTargets, applyRollingReallocation } from './seasonalityTargets.js'

// Fixed clock: mid-July 2026 → July 2026 is in-progress and must be excluded.
const NOW = new Date(2026, 6, 15)

function seasonalActuals() {
  // Three full years with a real seasonal shape (peaks Nov, troughs Jan) and
  // awkward non-round values so rounding residuals actually occur.
  const shape = [70, 80, 90, 95, 100, 105, 115, 120, 130, 140, 160, 145]
  const out = []
  for (const year of [2023, 2024, 2025]) {
    shape.forEach((s, i) => out.push({ year, month: i + 1, revenue: s * 1000.37 + year - 2023 }))
  }
  return out
}

test('indices sum to 1', () => {
  const r = computeSeasonalityTargets(seasonalActuals(), { now: NOW })
  assert.ok(Math.abs(r.sums.index - 1) < 1e-9, `index sum ${r.sums.index}`)
})

test('rounding residual reconciles to exactly 2,000,000 and 2,500,000', () => {
  const r = computeSeasonalityTargets(seasonalActuals(), { now: NOW })
  assert.equal(r.sums.base, 2_000_000)
  assert.equal(r.sums.stretch, 2_500_000)
  for (const m of r.months) {
    assert.ok(Number.isInteger(m.base) && Number.isInteger(m.stretch), `${m.name} not whole dollars`)
  }
})

test('single-year month uses that observation and logs it', () => {
  const actuals = seasonalActuals().filter((a) => !(a.month === 2 && a.year !== 2024))
  const r = computeSeasonalityTargets(actuals, { now: NOW })
  const feb = r.months[1]
  assert.equal(feb.samples.length, 1)
  assert.equal(feb.median, feb.samples[0].revenue)
  assert.ok(r.logs.some((l) => l.startsWith('Feb: only one year of data')))
})

test('zero-data month gets 0 target, is warned, and totals still reconcile', () => {
  const actuals = seasonalActuals().filter((a) => a.month !== 6)
  const r = computeSeasonalityTargets(actuals, { now: NOW })
  const jun = r.months[5]
  assert.equal(jun.median, 0)
  assert.equal(jun.base, 0)
  assert.ok(r.warnings.some((w) => w.startsWith('Jun: no actuals')))
  assert.equal(r.sums.base, 2_000_000)
  assert.equal(r.sums.stretch, 2_500_000)
})

test('flat-spread guardrail fires on a straight line', () => {
  const flat = []
  for (const year of [2024, 2025]) {
    for (let m = 1; m <= 12; m++) flat.push({ year, month: m, revenue: 100000 })
  }
  const r = computeSeasonalityTargets(flat, { now: NOW })
  assert.equal(r.flat, true)
  assert.ok(r.cv < 0.05)
  assert.ok(r.warnings.some((w) => w.includes('Flat-spread guardrail')))
})

test('does not fire the guardrail on genuinely seasonal data', () => {
  const r = computeSeasonalityTargets(seasonalActuals(), { now: NOW })
  assert.equal(r.flat, false)
})

test('in-progress current month is excluded and logged', () => {
  const actuals = seasonalActuals()
  actuals.push({ year: 2026, month: 7, revenue: 12345 }) // partial July 2026
  const r = computeSeasonalityTargets(actuals, { now: NOW })
  const jul = r.months[6]
  assert.ok(!jul.samples.some((s) => s.year === 2026))
  assert.ok(r.logs.some((l) => l.startsWith('Excluded in-progress month Jul 2026')))
})

test('rolling reallocation: actuals + remaining targets sum to exactly the totals', () => {
  const actuals = seasonalActuals()
  // Target-year actuals for completed months Jan–Jun 2026 (July in progress).
  const cur = [111111.11, 122222.22, 93333.33, 144444.44, 105555.55, 136666.66]
  cur.forEach((v, i) => actuals.push({ year: 2026, month: i + 1, revenue: v }))
  const model = computeSeasonalityTargets(actuals, { now: NOW })
  const r = applyRollingReallocation(model, actuals, { year: 2026, now: NOW })
  assert.equal(r.sums.base, 2_000_000)
  assert.equal(r.sums.stretch, 2_500_000)
  for (const m of r.months) {
    if (m.completed) {
      assert.equal(m.base, null)
      assert.ok(m.actual != null)
    } else {
      assert.ok(Number.isInteger(m.base) && Number.isInteger(m.stretch), `${m.name} not whole dollars`)
    }
  }
  assert.ok(r.logs.some((l) => l.startsWith('Rolling reallocation: 6 completed')))
})

test('rolling reallocation: remaining months rise when the year is behind plan', () => {
  const actuals = seasonalActuals()
  for (let m = 1; m <= 6; m++) actuals.push({ year: 2026, month: m, revenue: 10000 }) // way behind
  const model = computeSeasonalityTargets(actuals, { now: NOW })
  const r = applyRollingReallocation(model, actuals, { year: 2026, now: NOW })
  for (const m of r.months) {
    if (!m.completed) assert.ok(m.base > m.planBase, `${m.name} should exceed its static plan`)
  }
})

test('rolling reallocation: over-achieved year zeroes remaining months and warns', () => {
  const actuals = seasonalActuals()
  for (let m = 1; m <= 6; m++) actuals.push({ year: 2026, month: m, revenue: 500000 }) // $3m YTD
  const model = computeSeasonalityTargets(actuals, { now: NOW })
  const r = applyRollingReallocation(model, actuals, { year: 2026, now: NOW })
  for (const m of r.months) {
    if (!m.completed) { assert.equal(m.base, 0); assert.equal(m.stretch, 0) }
  }
  assert.ok(r.warnings.some((w) => w.includes('already met')))
})

test('rolling reallocation: completed month missing its actual is warned, not fabricated', () => {
  const actuals = seasonalActuals()
  for (let m = 1; m <= 5; m++) actuals.push({ year: 2026, month: m, revenue: 100000 }) // June missing
  const model = computeSeasonalityTargets(actuals, { now: NOW })
  const r = applyRollingReallocation(model, actuals, { year: 2026, now: NOW })
  assert.equal(r.ytdActual, 500000)
  assert.ok(r.warnings.some((w) => w.startsWith('Jun 2026 is completed but has no actual')))
})

test('outlier sample is flagged but still included', () => {
  const actuals = seasonalActuals()
  actuals.push({ year: 2022, month: 3, revenue: 900000 }) // wild March
  const r = computeSeasonalityTargets(actuals, { now: NOW })
  const mar = r.months[2]
  assert.equal(mar.samples.length, 4)
  assert.ok(r.logs.some((l) => l.startsWith('Mar 2022: outlier sample')))
})
