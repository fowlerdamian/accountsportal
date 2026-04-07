import { cn } from "@guide/lib/utils";
import type { ContractorSource } from "@guide/hooks/use-hub-queries";

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
          "bg-blue-900/40 text-blue-300 border border-blue-800/40",
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
