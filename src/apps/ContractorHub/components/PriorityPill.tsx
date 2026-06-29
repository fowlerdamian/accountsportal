import { cn } from "@guide/lib/utils";
import type { TaskPriority } from "@hub/hooks/use-hub-queries";

const CONFIG: Record<TaskPriority, { label: string; className: string }> = {
  low:    { label: "Low",    className: "bg-muted text-muted-foreground" },
  medium: { label: "Medium", className: "bg-muted/60 text-foreground/70 border border-border/50" },
  high:   { label: "High",   className: "bg-[rgba(var(--brand-accent-rgb),0.4)] text-[var(--brand-orange)] border border-[rgba(var(--brand-accent-rgb),0.4)]" },
  urgent: { label: "Urgent", className: "bg-[rgba(var(--brand-pink-rgb),0.4)] text-[var(--brand-pink)] border border-[rgba(var(--brand-pink-rgb),0.4)]" },
};

interface PriorityPillProps {
  priority:   TaskPriority;
  className?: string;
  size?:      "sm" | "default";
}

export function PriorityPill({ priority, className, size = "default" }: PriorityPillProps) {
  const config = CONFIG[priority];
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
