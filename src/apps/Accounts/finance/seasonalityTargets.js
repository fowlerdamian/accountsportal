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
 * Rear-view year-end forecast via trend × seasonality decomposition.
 *
 * Raw (full-year ÷ same-months) ratios conflate growth with seasonality — in
 * a growing business H2 beats H1 partly because the business grew, and using
 * those ratios as estimates double-counts the trend. Instead:
 *   1. Fit a log-linear growth trend (OLS) across ALL monthly history.
 *   2. Seasonality = median deviation from that trend per calendar month —
 *      seasonality describes the SHAPE of the year, never the level.
 *   3. Forecast each remaining month = trend level × seasonal shape.
 *   4. Chance of reaching `planTotal` from the fit's residual noise (delta
 *      method on the log scale, months assumed independent).
 *
 * @param {Array<{year:number, month:number, revenue:number}>} actuals
 * @param {{year:number, planTotal?:number, now?:Date}} opts
 * @returns {{
 *   forecast:number|null, probability:number|null, sigma:number|null,
 *   ytd:number, monthsUsed:number, growthAnnual:number|null,
 *   remainderForecast:number|null, logs:string[], warnings:string[],
 * }}
 */
export function computeRearViewForecast(actuals, opts) {
  const { year, planTotal = 2_000_000, now = new Date() } = opts
  const logs = []
  const warnings = []
  const empty = { forecast: null, probability: null, sigma: null, ytd: 0, monthsUsed: 0, growthAnnual: null, remainderForecast: null, logs, warnings }

  const curYear = now.getFullYear()
  const curMonth = now.getMonth() + 1
  // Completed months of the target year; the partial current month is never
  // fitted or counted — it gets forecast like the rest of the remainder.
  const uptoMonth = year < curYear ? 13 : year > curYear ? 1 : curMonth
  if (uptoMonth <= 1) {
    warnings.push('No completed months in the target year yet — rear-view forecast unavailable')
    return empty
  }

  const series = actuals
    .filter((a) => a.year < year || (a.year === year && a.month < uptoMonth))
    .sort((x, y) => x.year - y.year || x.month - y.month)
  const usable = series.filter((a) => a.revenue > 0)
  if (usable.length < series.length) {
    logs.push(`${series.length - usable.length} non-positive month(s) excluded from the trend fit`)
  }
  if (usable.length < 24) {
    warnings.push(`Only ${usable.length} usable month(s) of history — need 24+ to separate trend from seasonality`)
    return empty
  }

  // 1. Log-linear trend: log(revenue) ~ a + b·t, t = months since first point.
  const t0 = usable[0].year * 12 + usable[0].month
  const pts = usable.map((p) => ({ t: p.year * 12 + p.month - t0, m: p.month, y: Math.log(p.revenue) }))
  const n = pts.length
  let sumT = 0; let sumY = 0; let sumTT = 0; let sumTY = 0
  for (const p of pts) { sumT += p.t; sumY += p.y; sumTT += p.t * p.t; sumTY += p.t * p.y }
  const b = (n * sumTY - sumT * sumY) / (n * sumTT - sumT * sumT)
  const a0 = (sumY - b * sumT) / n
  const growthAnnual = Math.exp(b * 12) - 1

  // 2. Seasonal shape: median residual from the trend per calendar month.
  const resByMonth = Array.from({ length: 12 }, () => [])
  for (const p of pts) resByMonth[p.m - 1].push(p.y - (a0 + b * p.t))
  const seasonal = resByMonth.map((rs, i) => {
    if (!rs.length) {
      warnings.push(`${MONTH_NAMES[i]}: no history for a seasonal index — assuming trend level`)
      return 0
    }
    return median(rs)
  })

  // Residual noise after trend + seasonality. Dof charge: 2 trend + 12 seasonal.
  const resid = pts.map((p) => p.y - (a0 + b * p.t) - seasonal[p.m - 1])
  const sdLog = Math.sqrt(resid.reduce((s, r) => s + r * r, 0) / Math.max(1, n - 14))

  let ytd = 0
  for (const a of series) if (a.year === year) ytd += a.revenue

  // 3–4. Forecast the remaining months and propagate the noise (delta method:
  // sd of exp(x) ≈ forecast × sd_log for small sd).
  let remainder = 0
  let varSum = 0
  for (let m = uptoMonth; m <= 12; m++) {
    const f = Math.exp(a0 + b * (year * 12 + m - t0) + seasonal[m - 1])
    remainder += f
    varSum += (f * sdLog) ** 2
  }
  const forecast = ytd + remainder
  const sigma = Math.sqrt(varSum)
  const probability = sigma > 0 ? 1 - normCdf((planTotal - forecast) / sigma) : (forecast >= planTotal ? 1 : 0)
  logs.push(`Rear-view: trend ${(growthAnnual * 100).toFixed(1)}%/yr over ${n} months, residual sd(log) ${sdLog.toFixed(3)} → remainder $${Math.round(remainder).toLocaleString()}, σ $${Math.round(sigma).toLocaleString()}`)
  return { forecast, probability, sigma, ytd, monthsUsed: uptoMonth - 1, growthAnnual, remainderForecast: remainder, logs, warnings }
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
