// Period maths for the Finance Dashboard.
// Snapshot grain is monthly (period_month = 'YYYY-MM-01'). Calendar-Year and
// Financial-Year views are sums over the underlying months. AU FY = 1 Jul→30 Jun;
// "FY26" spans Jul-2025 → Jun-2026 (labelled by the year it ends in).

export const GRAINS = [
  { key: 'month', label: 'Month' },
  { key: 'cy', label: 'Calendar Year' },
  { key: 'fy', label: 'Financial Year' },
]

// 'YYYY-MM-01' (or Date) → 'YYYY-MM'
export function toKey(d) {
  const s = typeof d === 'string' ? d : d.toISOString()
  return s.slice(0, 7)
}

export function ymParts(key) {
  const [y, m] = key.split('-').map(Number)
  return { y, m }
}

// Financial year that a given month belongs to. Returns the ending year (FY26 → 2026).
export function fyOf(key) {
  const { y, m } = ymParts(key)
  return m >= 7 ? y + 1 : y
}

export function fyLabel(fy) { return `FY${String(fy).slice(2)}` }

// The 12 month-keys of a financial year (Jul (fy-1) → Jun (fy)).
export function fyMonths(fy) {
  const out = []
  for (let m = 7; m <= 12; m++) out.push(`${fy - 1}-${String(m).padStart(2, '0')}`)
  for (let m = 1; m <= 6; m++) out.push(`${fy}-${String(m).padStart(2, '0')}`)
  return out
}

export function cyMonths(y) {
  return Array.from({ length: 12 }, (_, i) => `${y}-${String(i + 1).padStart(2, '0')}`)
}

export function prevMonthKey(key) {
  let { y, m } = ymParts(key)
  m -= 1
  if (m === 0) { m = 12; y -= 1 }
  return `${y}-${String(m).padStart(2, '0')}`
}

// Trailing n month-keys ending at (and including) `key`.
export function trailing(key, n) {
  const out = [key]
  let k = key
  for (let i = 1; i < n; i++) { k = prevMonthKey(k); out.unshift(k) }
  return out
}

// Build the selector options + month membership for a grain, given the set of
// month-keys that actually have snapshots.
export function buildOptions(grain, availableKeys) {
  const keys = [...availableKeys].sort()
  if (grain === 'month') {
    return keys.map((k) => ({ value: k, label: k }))
  }
  if (grain === 'cy') {
    const years = [...new Set(keys.map((k) => ymParts(k).y))].sort()
    return years.map((y) => ({ value: String(y), label: String(y) }))
  }
  // fy
  const fys = [...new Set(keys.map((k) => fyOf(k)))].sort()
  return fys.map((fy) => ({ value: String(fy), label: fyLabel(fy) }))
}

// Month-keys included in the currently-selected period.
export function periodKeys(grain, anchor) {
  if (grain === 'month') return [anchor]
  if (grain === 'cy') return cyMonths(Number(anchor))
  return fyMonths(Number(anchor))
}

// Month-keys of the previous comparable period (for period-over-period deltas).
export function prevPeriodKeys(grain, anchor) {
  if (grain === 'month') return [prevMonthKey(anchor)]
  if (grain === 'cy') return cyMonths(Number(anchor) - 1)
  return fyMonths(Number(anchor) - 1)
}

// Months to plot in the trend charts for the selected period.
export function chartKeys(grain, anchor) {
  if (grain === 'month') return trailing(anchor, 12)
  return periodKeys(grain, anchor)
}

// Aggregate base figures across months, then RE-DERIVE ratios/breakeven from the
// sums (never average percentages). `rows` is a map key → finance_snapshot row.
export function aggregate(keys, snapByKey) {
  const sum = { revenue: 0, cogs: 0, opex_ebitda: 0, variable_costs: 0, fixed_costs: 0, unmapped_count: 0, unmapped_amount: 0, months: 0 }
  for (const k of keys) {
    const r = snapByKey.get(k)
    if (!r) continue
    sum.months += 1
    sum.revenue += Number(r.revenue) || 0
    sum.cogs += Number(r.cogs) || 0
    sum.opex_ebitda += Number(r.opex_ebitda) || 0
    sum.variable_costs += Number(r.variable_costs) || 0
    sum.fixed_costs += Number(r.fixed_costs) || 0
    sum.unmapped_count += Number(r.unmapped_count) || 0
    sum.unmapped_amount += Number(r.unmapped_amount) || 0
  }
  const grossProfit = sum.revenue - sum.cogs
  const grossProfitPct = sum.revenue !== 0 ? grossProfit / sum.revenue : null
  const ebitda = grossProfit - sum.opex_ebitda
  const contribution = sum.revenue - sum.variable_costs
  const cmPct = sum.revenue !== 0 ? contribution / sum.revenue : null
  const breakeven = cmPct ? sum.fixed_costs / cmPct : null
  const pctToBreakeven = breakeven ? sum.revenue / breakeven : null
  const marginOfSafety = breakeven != null ? sum.revenue - breakeven : null
  return {
    revenue: sum.revenue, cogs: sum.cogs, grossProfit, grossProfitPct,
    opex: sum.opex_ebitda, ebitda, variableCosts: sum.variable_costs,
    fixedCosts: sum.fixed_costs, contribution, cmPct, breakeven,
    pctToBreakeven, marginOfSafety,
    unmappedCount: sum.unmapped_count, unmappedAmount: sum.unmapped_amount,
    months: sum.months,
  }
}
