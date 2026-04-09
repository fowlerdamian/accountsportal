import { cn } from "@guide/lib/utils";
import type { TaskStatus, ProjectStatus } from "@hub/hooks/use-hub-queries";

type AnyStatus = TaskStatus | ProjectStatus;

const TASK_CONFIG: Record<TaskStatus, { label: string; className: string }> = {
  backlog:     { label: "Backlog",      className: "bg-muted text-muted-foreground" },
  in_progress: { label: "In Progress",  className: "bg-blue-900/40 text-blue-300 border border-blue-800/40" },
  review:      { label: "Review",       className: "bg-amber-900/40 text-amber-300 border border-amber-800/40" },
  done:        { label: "Done",         className: "bg-green-900/40 text-green-300 border border-green-800/40" },
};

const PROJECT_CONFIG: Record<ProjectStatus, { label: string; className: string }> = {
  planning:  { label: "Planning",   className: "bg-muted text-muted-foreground" },
  active:    { label: "Active",     className: "bg-blue-900/40 text-blue-300 border border-blue-800/40" },
  on_hold:   { label: "On Hold",    className: "bg-amber-900/40 text-amber-300 border border-amber-800/40" },
  complete:  { label: "Complete",   className: "bg-green-900/40 text-green-300 border border-green-800/40" },
};

const TASK_STATUSES   = new Set<string>(Object.keys(TASK_CONFIG));
const PROJECT_STATUSES = new Set<string>(Object.keys(PROJECT_CONFIG));

interface StatusPillProps {
  status:    AnyStatus;
  className?: string;
  size?:     "sm" | "default";
}

export function StatusPill({ status, className, size = "default" }: StatusPillProps) {
  const config = TASK_STATUSES.has(status)
    ? TASK_CONFIG[status as TaskStatus]
    : PROJECT_STATUSES.has(status)
      ? PROJECT_CONFIG[status as ProjectStatus]
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
