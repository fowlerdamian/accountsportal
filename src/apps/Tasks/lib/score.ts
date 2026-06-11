// Daily task score — client-side mirror of api/task-score-report.js so the
// Reporting tab shows the same number the 5pm Google Chat message will.
//
//   • Delivery (6 pts) — share of tasks due that day that got done (6 if nothing due)
//   • Backlog  (4 pts) — starts at 4, minus 1 per overdue open task
//   • Bonus            — +1 per extra completion that day beyond due-today items (cap 10)

import type { StaffTask } from "../hooks/use-task-queries";

export interface DayStats {
  dueTodayTotal: number;
  dueTodayDone:  number;
  overdue:       number;
  doneToday:     number;
}

export function scoreFor(s: DayStats): number {
  const delivery = s.dueTodayTotal > 0 ? 6 * (s.dueTodayDone / s.dueTodayTotal) : 6;
  const backlog  = Math.max(0, 4 - s.overdue);
  const bonus    = Math.max(0, s.doneToday - s.dueTodayDone);
  return Math.max(0, Math.min(10, Math.round(delivery + backlog + bonus)));
}

/** Local "yyyy-MM-dd" for a timestamptz (null-safe). */
export function localDay(ts: string | null): string | null {
  if (!ts) return null;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Retrospective stats for a given day. Reconstruction rules:
 *   • only tasks created on/before the day exist for it
 *   • a task counts done by the day if completed_at falls on/before it
 *   • overdue = due before the day and not yet completed by it
 * Tasks reopened after completion keep their last completed_at, so history is
 * a close approximation rather than a perfect snapshot.
 */
export function statsForDay(tasks: StaffTask[], day: string): DayStats {
  const s: DayStats = { dueTodayTotal: 0, dueTodayDone: 0, overdue: 0, doneToday: 0 };
  for (const t of tasks) {
    const created = localDay(t.created_at);
    if (created && created > day) continue;
    const doneDay = t.status === "done" ? localDay(t.completed_at) : null;
    if (doneDay === day) s.doneToday++;
    if (t.due_date === day) {
      s.dueTodayTotal++;
      if (doneDay && doneDay <= day) s.dueTodayDone++;
    }
    if (t.due_date && t.due_date < day && (!doneDay || doneDay > day)) s.overdue++;
  }
  return s;
}

/** Last `n` local days, oldest first, as "yyyy-MM-dd". */
export function lastNDays(n: number): string[] {
  const out: string[] = [];
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  for (let i = n - 1; i >= 0; i--) {
    out.push(localDay(new Date(d.getTime() - i * 86_400_000).toISOString())!);
  }
  return out;
}
