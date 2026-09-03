import { ReactNode } from "react";
import { cn } from "@guide/lib/utils";

interface StatsCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: ReactNode;
  trend?: string;
  className?: string;
  onClick?: () => void;
  /** Highlighted (e.g. the filter this tile represents is currently applied). */
  active?: boolean;
}

export function StatsCard({ title, value, subtitle, icon, trend, className, onClick, active }: StatsCardProps) {
  return (
    <div
      className={cn(
        "rounded-lg border bg-card p-4 h-full animate-fade-in transition-colors",
        onClick && "cursor-pointer select-none hover:border-primary/50 hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active && "border-primary bg-primary/5 ring-1 ring-primary/40",
        className,
      )}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-pressed={onClick && active !== undefined ? active : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-muted-foreground font-medium">{title}</p>
          <p className="text-2xl font-bold mt-1">{value}</p>
          {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
          {trend && <p className="text-xs text-success font-medium mt-1">{trend}</p>}
        </div>
        {icon && (
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary shrink-0">
            {icon}
          </div>
        )}
      </div>
    </div>
  );
}
