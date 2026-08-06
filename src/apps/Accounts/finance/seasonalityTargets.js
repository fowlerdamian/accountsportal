// Pure seasonality-median target model — no UI, no I/O, no Supabase.
//
// From monthly revenue actuals, computes a per-calendar-month median across
// years, normalises to a seasonality index summing to 1, and allocates annual
// base/stretch totals across the twelve months. All edge cases are logged on
// the result, never silently smoothed: the incomplete current month is
// excluded, single-sample and zero-sample months are flagged, and outlier
// samples (robust MAD test) are reported but still included — the median is
// already robust to them and excluding data would be fabrication.

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function median(values) {
  if (!values.length) return 0
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

// Round to whole dollars, then push the residual into the single largest
// month so the twelve months sum to exactly `total`.
function allocate(total, indices) {
  const rounded = indices.map((ix) => Math.round(total * ix))
  const residual = total - rounded.reduce((a, b) => a + b, 0)
  if (residual !== 0) {
    let largest = 0
    for (let i = 1; i < 12; i++) if (rounded[i] > rounded[largest]) largest = i
    rounded[largest] += residual
  }
  return rounded
}

/**
 * @param {Array<{year:number, month:number, revenue:number}>} actuals
 *   Monthly revenue actuals (calendar month granularity). Must be actuals —
 *   never feed previously set targets in.
 * @param {object} [opts]
 * @param {number} [opts.baseTotal=2_000_000]
 * @param {number} [opts.stretchTotal=2_500_000]
 * @param {Date}   [opts.now=new Date()] Clock used to exclude the in-progress month.
 * @returns {{
 *   months: Array<{month:number, name:string, samples:Array<{year:number, revenue:number}>,
 *                  median:number, index:number, base:number, stretch:number}>,
 *   logs: string[], warnings: string[], cv: number, flat: boolean,
 *   sums: {index:number, base:number, stretch:number},
 * }}
 */
export function computeSeasonalityTargets(actuals, opts = {}) {
  const { baseTotal = 2_000_000, stretchTotal = 2_500_000, now = new Date() } = opts
  const logs = []
  const warnings = []

  const curYear = now.getFullYear()
  const curMonth = now.getMonth() + 1
  const lastDayOfCurMonth = new Date(curYear, curMonth, 0).getDate()
  const curMonthComplete = now.getDate() >= lastDayOfCurMonth

  // Group actuals by calendar month, excluding the in-progress month.
  const byMonth = Array.from({ length: 12 }, () => [])
  for (const a of actuals) {
    if (a.year === curYear && a.month === curMonth && !curMonthComplete) {
      logs.push(`Excluded in-progress month ${MONTH_NAMES[a.month - 1]} ${a.year} (incomplete: day ${now.getDate()} of ${lastDayOfCurMonth}) — revenue so far $${Math.round(a.revenue).toLocaleString()}`)
      continue
    }
    if (a.year > curYear || (a.year === curYear && a.month > curMonth)) continue // future rows are never actuals
    byMonth[a.month - 1].push({ year: a.year, revenue: a.revenue })
  }

  // Per-month median + explicit edge-case logging.
  const medians = byMonth.map((samples, i) => {
    const name = MONTH_NAMES[i]
    if (samples.length === 0) {
      warnings.push(`${name}: no actuals in any year — median is 0, month gets a 0 target. Fix the data rather than trusting this.`)
      return 0
    }
    if (samples.length === 1) {
      logs.push(`${name}: only one year of data (${samples[0].year}) — median equals that single observation`)
    }
    const values = samples.map((s) => s.revenue)
    const med = median(values)
    // Robust outlier report: |x − median| > 3 × 1.4826 × MAD. Logged, not excluded.
    const mad = median(values.map((v) => Math.abs(v - med)))
    if (mad > 0) {
      for (const s of samples) {
        if (Math.abs(s.revenue - med) > 3 * 1.4826 * mad) {
          logs.push(`${name} ${s.year}: outlier sample $${Math.round(s.revenue).toLocaleString()} vs median $${Math.round(med).toLocaleString()} — included (median is robust), flagged for review`)
        }
      }
    }
    return med
  })

  const medianSum = medians.reduce((a, b) => a + b, 0)
  if (medianSum <= 0) {
    throw new Error('seasonalityTargets: all monthly medians are zero — no usable actuals')
  }
  const indices = medians.map((m) => m / medianSum)

  const base = allocate(baseTotal, indices)
  const stretch = allocate(stretchTotal, indices)

  // Flat-spread guardrail: coefficient of variation of the monthly base targets.
  const mean = baseTotal / 12
  const variance = base.reduce((acc, v) => acc + (v - mean) ** 2, 0) / 12
  const cv = Math.sqrt(variance) / mean
  const flat = cv < 0.05
  if (flat) {
    warnings.push(`Flat-spread guardrail: coefficient of variation ${cv.toFixed(4)} < 0.05 — the computed targets are a near straight line, which is the failure mode this model replaces. Do not ship without review.`)
  }

  return {
    months: MONTH_NAMES.map((name, i) => ({
      month: i + 1, name,
      samples: byMonth[i],
      median: medians[i],
      index: indices[i],
      base: base[i],
      stretch: stretch[i],
    })),
    logs, warnings, cv, flat,
    sums: {
      index: indices.reduce((a, b) => a + b, 0),
      base: base.reduce((a, b) => a + b, 0),
      stretch: stretch.reduce((a, b) => a + b, 0),
    },
  }
}

// Standard normal CDF via the Abramowitz–Stegun 7.1.26 erf approximation
// (|error| < 1.5e-7 — far tighter than the 4-sample spread it's applied to).
function normCdf(z) {
  const x = Math.abs(z) / Math.SQRT2
  const t = 1 / (1 + 0.3275911 * x)
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)
  return 0.5 * (1 + (z < 0 ? -erf : erf))
}

/**
 * Rear-view year-end forecast: extrapolate the target year's completed months
 * using the ratio (full year ÷ same months) observed in each complete
 * historical year — i.e. cross-reference YTD with historical seasonality —
 * then estimate the chance of reaching `planTotal` from the spread of the
 * implied outcomes (normal approximation, sample std, n−1).
 *
 * @param {Array<{year:number, month:number, revenue:number}>} actuals
 * @param {{year:number, planTotal?:number, now?:Date}} opts
 * @returns {{
 *   forecast:number|null, probability:number|null, sigma:number|null,
 *   ytd:number, medianFactor:number|null, monthsUsed:number,
 *   factors:Array<{year:number, factor:number}>, logs:string[], warnings:string[],
 * }}
 */
export function computeRearViewForecast(actuals, opts) {
  const { year, planTotal = 2_000_000, now = new Date() } = opts
  const logs = []
  const warnings = []
  const empty = { forecast: null, probability: null, sigma: null, ytd: 0, medianFactor: null, monthsUsed: 0, factors: [], logs, warnings }

  const curYear = now.getFullYear()
  const curMonth = now.getMonth() + 1
  // Completed months of the target year only — the partial current month is
  // excluded from both sides of the ratio.
  const uptoMonth = year < curYear ? 13 : year > curYear ? 1 : curMonth
  const window = []
  for (let m = 1; m < uptoMonth; m++) window.push(m)
  if (!window.length) {
    warnings.push('No completed months in the target year yet — rear-view forecast unavailable')
    return empty
  }

  const byYear = new Map()
  for (const a of actuals) {
    if (!byYear.has(a.year)) byYear.set(a.year, new Map())
    byYear.get(a.year).set(a.month, a.revenue)
  }

  const ytd = window.reduce((s, m) => s + (byYear.get(year)?.get(m) ?? 0), 0)
  if (ytd <= 0) {
    warnings.push(`No actuals recorded for ${year}'s completed months — rear-view forecast unavailable`)
    return empty
  }

  const factors = []
  for (const y of [...byYear.keys()].sort()) {
    if (y >= year) continue
    const months = byYear.get(y)
    const complete = months.size >= 12 && window.every((m) => months.get(m) != null)
    if (!complete) { logs.push(`${y} skipped for rear-view factor (incomplete year)`); continue }
    const portion = window.reduce((s, m) => s + months.get(m), 0)
    if (portion <= 0) { logs.push(`${y} skipped for rear-view factor (zero revenue in window)`); continue }
    let total = 0
    for (let m = 1; m <= 12; m++) total += months.get(m) ?? 0
    factors.push({ year: y, factor: total / portion })
  }
  if (factors.length < 2) {
    warnings.push(`Only ${factors.length} complete historical year(s) — not enough to calibrate a rear-view forecast`)
    return { ...empty, ytd, factors, monthsUsed: window.length }
  }

  const fs = factors.map((f) => f.factor)
  const medianFactor = median(fs)
  const forecast = ytd * medianFactor
  const implied = fs.map((f) => ytd * f)
  const mean = implied.reduce((a, b) => a + b, 0) / implied.length
  const sigma = Math.sqrt(implied.reduce((a, v) => a + (v - mean) ** 2, 0) / (implied.length - 1))
  const probability = sigma > 0 ? 1 - normCdf((planTotal - forecast) / sigma) : (forecast >= planTotal ? 1 : 0)
  logs.push(`Rear-view: ${window.length} completed month(s) × factors [${fs.map((f) => f.toFixed(3)).join(', ')}] → median ×${medianFactor.toFixed(3)}, σ $${Math.round(sigma).toLocaleString()}`)
  return { forecast, probability, sigma, ytd, medianFactor, monthsUsed: window.length, factors, logs, warnings }
}

// Round `total` across the given index weights, residual to the largest slot.
function allocateOver(total, weights) {
  const weightSum = weights.reduce((a, b) => a + b, 0)
  if (weightSum <= 0) return weights.map(() => 0)
  const out = weights.map((w) => Math.round(total * (w / weightSum)))
  const residual = total - out.reduce((a, b) => a + b, 0)
  if (residual !== 0) {
    let largest = 0
    for (let i = 1; i < out.length; i++) if (out[i] > out[largest]) largest = i
    out[largest] += residual
  }
  return out
}

/**
 * Rolling reallocation for the target year: months that have COMPLETED lock to
 * their actuals; the remainder of the annual total is re-spread across the
 * months still to come, proportional to their seasonality indices, so
 * actuals-to-date + remaining targets always sum to exactly the annual total.
 *
 * @param {ReturnType<typeof computeSeasonalityTargets>} model
 * @param {Array<{year:number, month:number, revenue:number}>} actuals
 * @param {object} opts
 * @param {number} opts.year         Target year being planned.
 * @param {number} [opts.baseTotal=2_000_000]
 * @param {number} [opts.stretchTotal=2_500_000]
 * @param {Date}   [opts.now=new Date()]
 * @returns {{
 *   months: Array<{month:number, name:string, completed:boolean, actual:number|null,
 *                  index:number, base:number|null, stretch:number|null,
 *                  planBase:number, planStretch:number}>,
 *   ytdActual:number, logs:string[], warnings:string[],
 *   sums:{base:number, stretch:number},
 * }}
 */
export function applyRollingReallocation(model, actuals, opts) {
  const { year, baseTotal = 2_000_000, stretchTotal = 2_500_000, now = new Date() } = opts
  const logs = []
  const warnings = []

  const curYear = now.getFullYear()
  const curMonth = now.getMonth() + 1
  const lastDay = new Date(curYear, curMonth, 0).getDate()
  const curMonthComplete = now.getDate() >= lastDay

  // A month of the target year is "completed" once it is wholly in the past.
  const isCompleted = (m) => {
    if (year < curYear) return true
    if (year > curYear) return false
    return m < curMonth || (m === curMonth && curMonthComplete)
  }

  const actualFor = (m) => {
    const row = actuals.find((a) => a.year === year && a.month === m)
    return row ? row.revenue : null
  }

  const completed = []
  const remaining = []
  for (let m = 1; m <= 12; m++) (isCompleted(m) ? completed : remaining).push(m)

  let ytdActual = 0
  for (const m of completed) {
    const a = actualFor(m)
    if (a == null) {
      warnings.push(`${MONTH_NAMES[m - 1]} ${year} is completed but has no actual recorded — treated as $0 toward the year, check the sync`)
    } else {
      ytdActual += a
    }
  }
  ytdActual = Math.round(ytdActual)

  const remainingWeights = remaining.map((m) => model.months[m - 1].index)
  const weightSum = remainingWeights.reduce((a, b) => a + b, 0)
  if (remaining.length && weightSum <= 0) {
    warnings.push('All remaining months have a zero seasonality index — remainder cannot be allocated')
  }

  const spread = (total) => {
    const left = total - ytdActual
    if (left <= 0) {
      if (remaining.length) {
        warnings.push(`Annual total $${total.toLocaleString()} already met by actuals ($${ytdActual.toLocaleString()}) — remaining months set to $0`)
      }
      return remaining.map(() => 0)
    }
    return allocateOver(left, remainingWeights)
  }

  const baseRemaining = spread(baseTotal)
  const stretchRemaining = spread(stretchTotal)

  if (remaining.length && completed.length) {
    logs.push(`Rolling reallocation: ${completed.length} completed month(s) locked at $${ytdActual.toLocaleString()} actual; $${Math.max(0, baseTotal - ytdActual).toLocaleString()} base / $${Math.max(0, stretchTotal - ytdActual).toLocaleString()} stretch re-spread over ${remaining.length} remaining month(s)`)
  }

  const months = MONTH_NAMES.map((name, i) => {
    const m = i + 1
    const done = isCompleted(m)
    const ri = remaining.indexOf(m)
    return {
      month: m, name,
      completed: done,
      actual: actualFor(m),
      index: model.months[i].index,
      // Adjusted targets only exist for months still open; completed months
      // report null (their contribution is the actual itself).
      base: done ? null : baseRemaining[ri],
      stretch: done ? null : stretchRemaining[ri],
      // The static full-year plan, for comparison in the UI.
      planBase: model.months[i].base,
      planStretch: model.months[i].stretch,
    }
  })

  return {
    months, ytdActual, logs, warnings,
    sums: {
      base: ytdActual + baseRemaining.reduce((a, b) => a + b, 0),
      stretch: ytdActual + stretchRemaining.reduce((a, b) => a + b, 0),
    },
  }
}
