// ─────────────────────────────────────────────────────────────────────────────
// Eisenhower matrix helpers — quadrant from (urgency, importance), scoring,
// sort comparators. Keep this file pure (no React, no Supabase) so it can be
// imported anywhere including the dock that renders across the whole portal.
// ─────────────────────────────────────────────────────────────────────────────

export type Quadrant = "do" | "schedule" | "delegate" | "drop";

export interface Scoreable {
  urgency:    number | null;
  importance: number | null;
  due_date:   string | null;
}

/**
 * Classify a (urgency, importance) pair into the standard four quadrants.
 * Threshold: ≥ 3 on a 1-5 scale counts as "high" on that axis.
 *
 * - do:       urgent + important  (act now)
 * - schedule: important, not yet urgent (plan)
 * - delegate: urgent but not important (offload)
 * - drop:     neither (skip)
 *
 * Unscored axes default to the middle (3), which lands the task in 'do' —
 * surfaces it for triage rather than hiding it.
 */
export function quadrantOf(urgency: number | null, importance: number | null): Quadrant {
  const u = urgency    ?? 3;
  const i = importance ?? 3;
  if (i >= 3 && u >= 3) return "do";
  if (i >= 3)           return "schedule";
  if (u >= 3)           return "delegate";
  return "drop";
}

export const QUADRANT_LABEL: Record<Quadrant, string> = {
  do:       "Do",
  schedule: "Schedule",
  delegate: "Delegate",
  drop:     "Drop",
};

/**
 * Composite score for dock ordering — urgency × importance, descending.
 * Tasks score 0 if either axis is missing (so unscored tasks sink, but a
 * banner in the drawer prompts the user to score them).
 */
export function eisenhowerScore(t: Scoreable): number {
  if (t.urgency == null || t.importance == null) return 0;
  return t.urgency * t.importance;
}

/**
 * Sort comparator for the dock and the dashboard "by score" view.
 * Higher score first; tiebreak by earliest due date (nulls last).
 */
export function scoreSort(a: Scoreable, b: Scoreable): number {
  const sa = eisenhowerScore(a);
  const sb = eisenhowerScore(b);
  if (sb !== sa) return sb - sa;
  if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date);
  if (a.due_date) return -1;
  if (b.due_date) return 1;
  return 0;
}
