import { cn } from "@guide/lib/utils";

interface FilterPillProps {
  active:    boolean;
  onClick:   () => void;
  children:  React.ReactNode;
  className?: string;
}

/**
 * Shared filter chip used by ProjectsList and the Tasks dashboard.
 * Lifted from ContractorHub/pages/ProjectsList.tsx so both surfaces
 * stay visually identical.
 */
export function FilterPill({ active, onClick, children, className }: FilterPillProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "px-3 py-0.5 rounded-full text-xs font-medium transition-colors border",
        active
          ? "bg-muted text-foreground border-border"
          : "text-muted-foreground border-transparent hover:border-border/50",
        className,
      )}
    >
      {children}
    </button>
  );
}
