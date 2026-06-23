// ─────────────────────────────────────────────────────────────────────────────
// Visual encoding for staff_tasks:
//   • background  = Eisenhower quadrant (reuses PriorityPill colours so the
//                    palette stays consistent across apps)
//   • border ring = due-date urgency (overdue / today / this week / later)
//
// Both signals visible at a glance on tiles + dock pills.
// ─────────────────────────────────────────────────────────────────────────────

import type { Quadrant } from "./eisenhower";

// Backgrounds — mirror PriorityPill exactly. See
// src/apps/ContractorHub/components/PriorityPill.tsx
export const QUADRANT_BG_CLASS: Record<Quadrant, string> = {
  do:       "bg-red-900/40 text-red-300 border border-red-800/40",
  schedule: "bg-blue-900/40 text-blue-300 border border-blue-800/40",
  delegate: "bg-amber-900/40 text-amber-300 border border-amber-800/40",
  drop:     "bg-muted text-muted-foreground border border-border/40",
};

// Small dot variant (used inside dock pills)
export const QUADRANT_DOT_CLASS: Record<Quadrant, string> = {
  do:       "bg-red-400",
  schedule: "bg-blue-400",
  delegate: "bg-amber-400",
  drop:     "bg-muted-foreground/60",
};

export type DueIntensity = "none" | "later" | "week" | "today" | "overdue";

function daysFromToday(dueDate: string): number {
  // YYYY-MM-DD comparisons in local time — collapse both to midnight.
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due   = new Date(dueDate + "T00:00:00");
  return Math.round((due.getTime() - today.getTime()) / 86_400_000);
}

export function dueIntensity(dueDate: string | null): DueIntensity {
  if (!dueDate) return "none";
  const d = daysFromToday(dueDate);
  if (d < 0) return "overdue";
  if (d === 0) return "today";
  if (d <= 7) return "week";
  return "later";
}

// Tailwind ring utility classes per intensity. Keep these in the source so
// the JIT compiler picks them up (don't string-concatenate at render time).
export const DUE_RING_CLASS: Record<DueIntensity, string> = {
  none:    "",
  later:   "",
  week:    "ring-1 ring-yellow-400/70",
  today:   "ring-2 ring-orange-400",
  overdue: "ring-2 ring-red-500",
};

export function dueRingClass(dueDate: string | null): string {
  return DUE_RING_CLASS[dueIntensity(dueDate)];
}

// Text colour for the due chip — overdue pops red, today orange, this week amber.
export const DUE_CHIP_CLASS: Record<DueIntensity, string> = {
  none:    "text-muted-foreground",
  later:   "text-muted-foreground",
  week:    "text-yellow-500",
  today:   "text-orange-400 font-semibold",
  overdue: "text-red-400 font-semibold",
};

export function dueChipClass(dueDate: string | null): string {
  return DUE_CHIP_CLASS[dueIntensity(dueDate)];
}

// Human-readable due chip text
export function formatDueChip(dueDate: string | null): string {
  if (!dueDate) return "";
  const d = daysFromToday(dueDate);
  if (d === 0)  return "Today";
  if (d === 1)  return "Tmrw";
  if (d === -1) return "1d late";
  if (d < 0)    return `${-d}d late`;
  if (d <= 7)   return `${d}d`;
  return dueDate.slice(5); // MM-DD
}
