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
  do:       "bg-[rgba(var(--brand-pink-rgb),0.4)] text-[var(--brand-pink)] border border-[rgba(var(--brand-pink-rgb),0.4)]",
  schedule: "bg-[rgba(var(--brand-aqua-rgb),0.4)] text-[var(--brand-blue)] border border-[rgba(var(--brand-aqua-rgb),0.4)]",
  delegate: "bg-[rgba(var(--brand-accent-rgb),0.4)] text-[var(--brand-orange)] border border-[rgba(var(--brand-accent-rgb),0.4)]",
  drop:     "bg-muted text-muted-foreground border border-border/40",
};

// Small dot variant (used inside dock pills)
export const QUADRANT_DOT_CLASS: Record<Quadrant, string> = {
  do:       "bg-[var(--brand-pink)]",
  schedule: "bg-[var(--brand-blue)]",
  delegate: "bg-[var(--brand-orange)]",
  drop:     "bg-muted-foreground/60",
};

// Left-edge accent — colour-codes the Eisenhower quadrant (priority).
// Used by the pinned desktop widget's compact task rows.
export const QUADRANT_ACCENT_CLASS: Record<Quadrant, string> = {
  do:       "border-l-4 border-l-[var(--brand-pink)]",
  schedule: "border-l-4 border-l-[var(--brand-blue)]",
  delegate: "border-l-4 border-l-[var(--brand-orange)]",
  drop:     "border-l-4 border-l-muted-foreground/40",
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
  week:    "ring-1 ring-[rgba(var(--brand-accent-rgb),0.7)]",
  today:   "ring-2 ring-[var(--brand-orange)]",
  overdue: "ring-2 ring-[var(--brand-pink)]",
};

export function dueRingClass(dueDate: string | null): string {
  return DUE_RING_CLASS[dueIntensity(dueDate)];
}

// Text colour for the due chip — overdue pops red, today orange, this week amber.
export const DUE_CHIP_CLASS: Record<DueIntensity, string> = {
  none:    "text-muted-foreground",
  later:   "text-muted-foreground",
  week:    "text-[var(--brand-orange)]",
  today:   "text-[var(--brand-orange)] font-semibold",
  overdue: "text-[var(--brand-pink)] font-semibold",
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
