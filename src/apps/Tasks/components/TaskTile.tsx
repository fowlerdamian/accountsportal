import { useRef } from "react";
import { cn } from "@guide/lib/utils";
import { Link2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { StatusPill, nextStaffTaskStatus } from "@hub/components/StatusPill";
import { QuadrantPill } from "./QuadrantPill";
import { UserAvatar } from "./UserAvatar";
import { quadrantOf, type Quadrant } from "../lib/eisenhower";
import { dueRingClass, formatDueChip, dueChipClass, QUADRANT_BG_CLASS, QUADRANT_ACCENT_CLASS } from "../lib/color";
import { useUpdateStaffTask, type StaffTask } from "../hooks/use-task-queries";

// Eisenhower cycle. Each quadrant maps to a representative (urgency, importance)
// pair that's plainly inside that quadrant — clicking the pill repeatedly walks
// these four points around the matrix.
const QUAD_ORDER: Quadrant[] = ["do", "schedule", "delegate", "drop"];
const QUAD_SCORES: Record<Quadrant, { urgency: number; importance: number }> = {
  do:       { urgency: 4, importance: 4 },
  schedule: { urgency: 2, importance: 4 },
  delegate: { urgency: 4, importance: 2 },
  drop:     { urgency: 2, importance: 2 },
};

interface TaskTileProps {
  task:          StaffTask;
  assigneeName:  string;
  /** Shown as "from {name}" on the tile when the creator isn't the assignee. */
  creatorName?:  string;
  onClick:       () => void;
  /**
   * Compact horizontal variant used inside the bottom dock.
   * Full tile variant used in the dashboard tile grid.
   */
  variant?:      "tile" | "dock";
  className?:    string;
}

export function TaskTile({ task, assigneeName, creatorName, onClick, variant = "tile", className }: TaskTileProps) {
  const quad     = quadrantOf(task.urgency, task.importance);
  const ringCls  = dueRingClass(task.due_date);
  const unscored = task.urgency == null || task.importance == null;
  const { mutateAsync: updateTask } = useUpdateStaffTask();
  // Guards rapid double-clicks: a second click before the cache refreshes
  // would compute "next" from the STALE value and re-send the same target.
  const cycleBusy = useRef(false);

  async function cycleQuadrant(e: React.MouseEvent | React.KeyboardEvent) {
    e.stopPropagation();
    e.preventDefault();
    if (cycleBusy.current) return;
    cycleBusy.current = true;
    const next   = QUAD_ORDER[(QUAD_ORDER.indexOf(quad) + 1) % QUAD_ORDER.length];
    const scores = QUAD_SCORES[next];
    try { await updateTask({ id: task.id, urgency: scores.urgency, importance: scores.importance }); }
    catch { toast.error("Failed to change quadrant"); }
    finally { cycleBusy.current = false; }
  }

  async function cycleStage(e: React.MouseEvent | React.KeyboardEvent) {
    e.stopPropagation();
    e.preventDefault();
    if (task.status === "blocked") {
      toast.error("Blocked — resolve the blocker first");
      return;
    }
    if (cycleBusy.current) return;
    cycleBusy.current = true;
    try { await updateTask({ id: task.id, status: nextStaffTaskStatus(task.status) }); }
    catch { toast.error("Failed to change stage"); }
    finally { cycleBusy.current = false; }
  }

  if (variant === "dock") {
    // Dock labels use ONLY the AI summary (generated to fit). No title fallback,
    // no hard truncation — if the summary hasn't been generated yet, show a
    // neutral placeholder (full title is still available on hover via title attr).
    const label = task.ai_summary?.trim() || '…';
    return (
      <button
        onClick={onClick}
        title={task.title}
        className={cn(
          "group flex items-center gap-1.5 h-9 px-2.5 rounded-md shrink-0",
          // Pill tinted by Eisenhower quadrant (priority); ring flags due/overdue.
          QUADRANT_BG_CLASS[quad],
          "hover:opacity-90 transition-opacity text-left",
          ringCls,
          className,
        )}
      >
        <span className="text-xs truncate min-w-0">{label}</span>
        {task.due_date && (
          <span className={cn("font-mono tabular-nums text-[10px] shrink-0", dueChipClass(task.due_date))}>
            {formatDueChip(task.due_date)}
          </span>
        )}
      </button>
    );
  }

  // Tile variant uses `role="button"` div so we can nest real <button>
  // pills inside without invalid button-in-button HTML. The pills cycle
  // their own state and stopPropagation so the parent click (open drawer)
  // doesn't also fire.
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }}
      className={cn(
        "group w-full text-left rounded-lg border bg-[var(--bg-elevated)] cursor-pointer",
        // Left edge colour-codes the Eisenhower quadrant (priority).
        QUADRANT_ACCENT_CLASS[quad],
        "p-3 space-y-2 hover:border-border transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
        ringCls,
        className,
      )}
    >
      {/* Title row */}
      <div className="flex items-start gap-2">
        <span className="text-sm font-medium flex-1 leading-snug line-clamp-2">{task.title}</span>
        <button
          type="button"
          onClick={cycleQuadrant}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") cycleQuadrant(e); }}
          title="Click to cycle quadrant"
          className="rounded-full hover:ring-2 hover:ring-ring/40 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <QuadrantPill quadrant={quad} size="sm" />
        </button>
      </div>

      {/* Description preview */}
      {task.description && (
        <p className="text-xs text-muted-foreground line-clamp-2">{task.description}</p>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between gap-2 pt-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <UserAvatar name={assigneeName} size="xs" />
          <span className="text-[11px] text-muted-foreground truncate">{assigneeName}</span>
          {creatorName && task.created_by !== task.assigned_to && (
            <span className="text-[11px] text-muted-foreground/60 truncate" title={`Created by ${creatorName}`}>
              · from {creatorName}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {unscored && <AlertTriangle className="w-3 h-3 text-amber-400" />}
          {task.blocked_by_task_id && task.status === "blocked" && <Link2 className="w-3 h-3 text-amber-400" />}
          {task.due_date && (
            <span className={cn("font-mono tabular-nums text-[10px]", dueChipClass(task.due_date))}>
              {formatDueChip(task.due_date)}
            </span>
          )}
          <button
            type="button"
            onClick={cycleStage}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") cycleStage(e); }}
            title="Click to cycle stage"
            className="rounded-full hover:ring-2 hover:ring-ring/40 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <StatusPill status={task.status} staff size="sm" />
          </button>
        </div>
      </div>
    </div>
  );
}
