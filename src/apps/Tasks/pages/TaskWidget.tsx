// ─────────────────────────────────────────────────────────────────────────────
// Uber-simple pinned "desktop widget" view of the current user's open tasks.
// One line per task: title on the left, due date on the right. Rendered at
// /tasks/widget inside a borderless, always-on-top Edge app window (see
// tools/tasks-widget/). Reuses the portal auth session + staff_tasks realtime
// subscription, so it live-updates.
// ─────────────────────────────────────────────────────────────────────────────

import { useAuth } from "@portal/context/AuthContext";
import { RefreshCw } from "lucide-react";
import { cn } from "@guide/lib/utils";
import { formatDueChip, dueIntensity, QUADRANT_DOT_CLASS, QUADRANT_ACCENT_CLASS } from "../lib/color";
import { quadrantOf } from "../lib/eisenhower";
import {
  useStaffTasks,
  useStaffTasksRealtime,
  type StaffTaskStatus,
} from "../hooks/use-task-queries";

const OPEN_STATUSES: StaffTaskStatus[] = ["not_started", "in_progress", "blocked"];

export default function TaskWidget() {
  const { user } = useAuth();

  // Keep the list cache fresh over the websocket — same hook the dashboard uses.
  useStaffTasksRealtime();

  const { data: tasks = [], isLoading, isFetching, refetch } = useStaffTasks({
    assignedTo: user?.id,
    statuses:   OPEN_STATUSES,
  });

  return (
    <div className="flex h-screen w-screen flex-col bg-[var(--bg-base,#0b0d12)] text-foreground">
      {/* Drag handle / header. -webkit-app-region makes this strip the window's
          title bar so the whole widget is draggable. */}
      <header
        className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2 select-none"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      >
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="text-xs font-semibold tracking-wide uppercase text-muted-foreground">
            My Tasks
          </span>
          <span className="font-mono tabular-nums text-[11px] text-muted-foreground/70">
            {tasks.length}
          </span>
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          title="Refresh"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors shrink-0"
        >
          <RefreshCw className={"h-3.5 w-3.5 " + (isFetching ? "animate-spin" : "")} />
        </button>
      </header>

      {/* One line per task: title (left, truncated) + due date (right). */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">Loading…</p>
        ) : tasks.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">
            🎉 Nothing open — you're all clear.
          </p>
        ) : (
          <ul className="divide-y divide-border/40">
            {tasks.map((task) => {
              const quad = quadrantOf(task.urgency, task.importance);
              const di = task.due_date ? dueIntensity(task.due_date) : "none";
              return (
                <li
                  key={task.id}
                  className={cn(
                    "flex items-center gap-2.5 px-3 py-2 hover:bg-white/5",
                    QUADRANT_ACCENT_CLASS[quad],
                  )}
                >
                  <span className={cn("w-2 h-2 rounded-full shrink-0", QUADRANT_DOT_CLASS[quad])} />
                  <span className="flex-1 truncate text-sm" title={task.title}>
                    {task.title}
                  </span>
                  <span
                    className={cn(
                      "shrink-0 font-mono tabular-nums text-[11px]",
                      di === "overdue" ? "text-red-500 font-semibold animate-pulse"
                      : di === "today" ? "text-red-500 font-semibold"
                      : "text-muted-foreground",
                    )}
                  >
                    {task.due_date ? formatDueChip(task.due_date) : "—"}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
