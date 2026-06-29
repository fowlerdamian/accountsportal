import { cn } from "@guide/lib/utils";
import type { ContractorSource } from "@hub/hooks/use-hub-queries";

interface SourceBadgeProps {
  source:     ContractorSource;
  className?: string;
}

export function SourceBadge({ source, className }: SourceBadgeProps) {
  if (source === "upwork") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold",
          "bg-[rgba(var(--brand-aqua-rgb),0.4)] text-[var(--brand-blue)] border border-[rgba(var(--brand-aqua-rgb),0.4)]",
          className,
        )}
      >
        Upwork
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium",
        "bg-muted text-muted-foreground",
        className,
      )}
    >
      Direct
    </span>
  );
}
