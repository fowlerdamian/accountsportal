import { cn } from "../../../apps/Guide/lib/utils";
import { SCORE_BG } from "../lib/constants";

interface Props {
  score: number;
  size?: "sm" | "md";
}

export function LeadScoreBadge({ score, size = "md" }: Props) {
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded border font-mono font-semibold tabular-nums",
        SCORE_BG(score),
        size === "sm" ? "text-xs px-1.5 py-0.5" : "text-sm px-2 py-1"
      )}
    >
      {score}
    </span>
  );
}
