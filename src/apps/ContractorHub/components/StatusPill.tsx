import { cn } from "@guide/lib/utils";
import type { TaskStatus, ProjectStatus } from "@hub/hooks/use-hub-queries";

// Statuses for the staff_tasks app (separate table; reuses the same visual
// vocabulary as Contractor Hub tasks).
export type StaffTaskStatus = "not_started" | "in_progress" | "blocked" | "done";

type AnyStatus = TaskStatus | ProjectStatus | StaffTaskStatus;

const TASK_CONFIG: Record<TaskStatus, { label: string; className: string }> = {
  backlog:     { label: "To Do",        className: "bg-muted text-muted-foreground" },
  in_progress: { label: "In Progress",  className: "bg-[rgba(var(--brand-aqua-rgb),0.4)] text-[var(--brand-blue)] border border-[rgba(var(--brand-aqua-rgb),0.4)]" },
  review:      { label: "Stuck",        className: "bg-[rgba(var(--brand-pink-rgb),0.4)] text-[var(--brand-pink)] border border-[rgba(var(--brand-pink-rgb),0.4)]" },
  done:        { label: "Complete",     className: "bg-[rgba(var(--brand-aqua-rgb),0.4)] text-[var(--brand-aqua)] border border-[rgba(var(--brand-aqua-rgb),0.4)]" },
};

const PROJECT_CONFIG: Record<ProjectStatus, { label: string; className: string }> = {
  planning:  { label: "Planning",   className: "bg-muted text-muted-foreground" },
  active:    { label: "Active",     className: "bg-[rgba(var(--brand-aqua-rgb),0.4)] text-[var(--brand-blue)] border border-[rgba(var(--brand-aqua-rgb),0.4)]" },
  on_hold:   { label: "On Hold",    className: "bg-[rgba(var(--brand-accent-rgb),0.4)] text-[var(--brand-orange)] border border-[rgba(var(--brand-accent-rgb),0.4)]" },
  complete:  { label: "Complete",   className: "bg-[rgba(var(--brand-aqua-rgb),0.4)] text-[var(--brand-aqua)] border border-[rgba(var(--brand-aqua-rgb),0.4)]" },
  archived:  { label: "Archived",   className: "bg-muted/40 text-muted-foreground/70 border border-border/40" },
};

// staff_tasks: map "not_started"→muted, "blocked"→amber (reuses on_hold/review hues), "done"→green
const STAFF_TASK_CONFIG: Record<StaffTaskStatus, { label: string; className: string }> = {
  not_started: { label: "Not Started", className: "bg-muted text-muted-foreground" },
  in_progress: { label: "In Progress", className: "bg-[rgba(var(--brand-aqua-rgb),0.4)] text-[var(--brand-blue)] border border-[rgba(var(--brand-aqua-rgb),0.4)]" },
  blocked:     { label: "Blocked",     className: "bg-[rgba(var(--brand-accent-rgb),0.4)] text-[var(--brand-orange)] border border-[rgba(var(--brand-accent-rgb),0.4)]" },
  done:        { label: "Done",        className: "bg-[rgba(var(--brand-aqua-rgb),0.4)] text-[var(--brand-aqua)] border border-[rgba(var(--brand-aqua-rgb),0.4)]" },
};

const TASK_STATUSES        = new Set<string>(Object.keys(TASK_CONFIG));
const PROJECT_STATUSES     = new Set<string>(Object.keys(PROJECT_CONFIG));
const STAFF_TASK_STATUSES  = new Set<string>(Object.keys(STAFF_TASK_CONFIG));

interface StatusPillProps {
  status:    AnyStatus;
  /** When true, prefer the staff_tasks vocabulary on overlapping keys (in_progress, done). */
  staff?:    boolean;
  className?: string;
  size?:     "sm" | "default";
}

export function StatusPill({ status, staff, className, size = "default" }: StatusPillProps) {
  const config = staff && STAFF_TASK_STATUSES.has(status)
    ? STAFF_TASK_CONFIG[status as StaffTaskStatus]
    : TASK_STATUSES.has(status)
      ? TASK_CONFIG[status as TaskStatus]
      : PROJECT_STATUSES.has(status)
        ? PROJECT_CONFIG[status as ProjectStatus]
        : STAFF_TASK_STATUSES.has(status)
          ? STAFF_TASK_CONFIG[status as StaffTaskStatus]
          : null;

  if (!config) return null;

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full font-medium whitespace-nowrap",
        size === "sm" ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-0.5 text-xs",
        config.className,
        className,
      )}
    >
      {config.label}
    </span>
  );
}

// Ordered arrays for cycling through statuses
export const TASK_STATUS_ORDER: TaskStatus[] = ["backlog", "in_progress", "review", "done"];

export function nextTaskStatus(current: TaskStatus): TaskStatus {
  const idx = TASK_STATUS_ORDER.indexOf(current);
  return TASK_STATUS_ORDER[(idx + 1) % TASK_STATUS_ORDER.length];
}

// staff_tasks cycle (skips 'blocked' — that's set automatically by adding a dependency)
export const STAFF_TASK_STATUS_ORDER: StaffTaskStatus[] = ["not_started", "in_progress", "done"];

export function nextStaffTaskStatus(current: StaffTaskStatus): StaffTaskStatus {
  // From 'blocked' a click advances to 'in_progress' (manual unblock without resolving the dep).
  if (current === "blocked") return "in_progress";
  const idx = STAFF_TASK_STATUS_ORDER.indexOf(current);
  return STAFF_TASK_STATUS_ORDER[(idx + 1) % STAFF_TASK_STATUS_ORDER.length];
}
