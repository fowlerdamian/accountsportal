import { cn } from "@guide/lib/utils";
import { QUADRANT_LABEL, type Quadrant } from "../lib/eisenhower";
import { QUADRANT_BG_CLASS } from "../lib/color";

interface QuadrantPillProps {
  quadrant:   Quadrant;
  size?:      "sm" | "default";
  className?: string;
}

/**
 * Eisenhower-quadrant chip. Visual sibling of PriorityPill — same shape,
 * size variants, and palette family.
 */
export function QuadrantPill({ quadrant, size = "default", className }: QuadrantPillProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full font-medium whitespace-nowrap",
        size === "sm" ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-0.5 text-xs",
        QUADRANT_BG_CLASS[quadrant],
        className,
      )}
    >
      {QUADRANT_LABEL[quadrant]}
    </span>
  );
}
