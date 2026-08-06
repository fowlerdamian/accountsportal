// ─────────────────────────────────────────────────────────────────────────────
// Opportunity Pressure — growth engine.
// Pure module: no React, no Supabase, no Date.now(). Every function takes an
// explicit reference timestamp (ms epoch). Plain ESM JS so the same file runs
// under Vite and under `node --test` with no build step.
//
// The activity register is the only source of truth for bubble size.
// daysSinceLastActivity derives from the most recent qualifying activity —
// never from a field on the opportunity. Open tasks never qualify; a task
// qualifies only once completed, measured from completed_at.
// ─────────────────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000

// All coefficients live here so tuning never touches logic.
export const GROWTH_CONFIG = {
  baseRatePerDay: 0.85,
  size:  { base: 0.45, coef: 0.62, pivotAmount: 25_000, min: 0.45, max: 2.0 },
  win:   { base: 0.35, coef: 1.45, defaultProbability: 0.5 },
  close: { numerator: 45, offsetDays: 20, min: 0.35, max: 2.25 },
  // Constant for every deal — deals differ in how fast they consume it,
  // never in how much they get.
  toleranceUnits: 46,
  geometry: {
    coreRadiusBase: 15,     // px at sizeFactor 1
    coreRadiusMin: 8,       // px floor so tiny deals stay clickable
    haloPerBloatUnit: 0.55, // px of halo per unit of bloat
    haloMax: 90,            // px cap so one dead deal can't swallow the field
  },
}

export function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v))
}

export function sizeFactor(amount, cfg = GROWTH_CONFIG) {
  const { base, coef, pivotAmount, min, max } = cfg.size
  if (!Number.isFinite(amount) || amount <= 0) return min
  return clamp(base + Math.log10(amount / pivotAmount) * coef, min, max)
}

export function winFactor(probability, cfg = GROWTH_CONFIG) {
  const { base, coef, defaultProbability } = cfg.win
  const p = Number.isFinite(probability) ? clamp(probability, 0, 1) : defaultProbability
  return base + p * coef
}

export function closeFactor(daysToClose, cfg = GROWTH_CONFIG) {
  const { numerator, offsetDays, min, max } = cfg.close
  // No close date → daysToClose Infinity → factor decays to the clamp floor.
  const d = Number.isFinite(daysToClose) ? Math.max(daysToClose, 0) : Infinity
  return clamp(numerator / (d + offsetDays), min, max)
}

function toMs(value) {
  if (value == null) return null
  const ms = typeof value === 'number' ? value : new Date(value).getTime()
  return Number.isFinite(ms) ? ms : null
}

/**
 * Most recent qualifying timestamp, or null when nothing has ever qualified.
 * Qualifying: any logged activity (occurred_at), or a task that is currently
 * complete (status 'done' with completed_at). An open task changes nothing;
 * un-completing a task removes its timestamp entirely so the state recomputes
 * from the next most recent qualifying activity — no intermediate state.
 */
export function lastQualifyingActivityMs(activities = [], tasks = []) {
  let latest = null
  for (const a of activities) {
    const ms = toMs(a?.occurred_at)
    if (ms != null && (latest == null || ms > latest)) latest = ms
  }
  for (const t of tasks) {
    if (!t || t.status !== 'done') continue
    const ms = toMs(t.completed_at)
    if (ms != null && (latest == null || ms > latest)) latest = ms
  }
  return latest
}

/**
 * Full geometry + state for one opportunity.
 *
 * @param {object} opportunity  Row from public.opportunities (amount,
 *   probability 0..1, expected_close_date, is_parked, hubspot_created_at,
 *   created_at).
 * @param {Array}  activities   Rows from public.opportunity_activities.
 * @param {Array}  tasks        Rows from staff_tasks linked to this opportunity.
 * @param {number} nowMs        Reference timestamp (ms epoch). Required.
 */
export function computeOpportunityState(opportunity, activities, tasks, nowMs, cfg = GROWTH_CONFIG) {
  if (!Number.isFinite(nowMs)) throw new Error('computeOpportunityState: nowMs must be a finite ms timestamp')

  const amount = opportunity.amount == null ? null : Number(opportunity.amount)
  const sf = sizeFactor(amount, cfg)
  const coreRadius = Math.max(cfg.geometry.coreRadiusMin, cfg.geometry.coreRadiusBase * sf)

  if (opportunity.is_parked) {
    return {
      parked: true,
      growthPerDay: 0,
      daysSinceLastActivity: 0,
      bloat: 0,
      health: 0,
      slackDays: Infinity,
      overTolerance: false,
      lastActivityMs: lastQualifyingActivityMs(activities, tasks),
      coreRadius,
      haloRadius: coreRadius,
    }
  }

  const closeMs = toMs(opportunity.expected_close_date)
  const daysToClose = closeMs == null ? Infinity : (closeMs - nowMs) / DAY_MS

  const probability = opportunity.probability == null ? null : Number(opportunity.probability)
  const growthPerDay = cfg.baseRatePerDay * sf * winFactor(probability, cfg) * closeFactor(daysToClose, cfg)

  // Anchor: last qualifying activity, else when the deal came into existence.
  const anchorMs = lastQualifyingActivityMs(activities, tasks)
    ?? toMs(opportunity.hubspot_created_at)
    ?? toMs(opportunity.created_at)
    ?? nowMs

  const daysSinceLastActivity = Math.max(0, (nowMs - anchorMs) / DAY_MS)
  const bloat = growthPerDay * daysSinceLastActivity
  const health = bloat / cfg.toleranceUnits
  const slackDays = (cfg.toleranceUnits - bloat) / growthPerDay

  return {
    parked: false,
    growthPerDay,
    daysSinceLastActivity,
    bloat,
    health,
    slackDays,
    overTolerance: bloat > cfg.toleranceUnits,
    lastActivityMs: anchorMs,
    coreRadius,
    haloRadius: coreRadius + Math.min(bloat * cfg.geometry.haloPerBloatUnit, cfg.geometry.haloMax),
  }
}
