// ─────────────────────────────────────────────────────────────────────────────
// Compact, chrome-free "desktop widget" view of the current user's open tasks.
// Rendered at /tasks/widget and meant to be loaded inside a pinned, always-on-top
// Edge app window (see tools/tasks-widget/ launcher). Reuses the same auth
// session, TaskTile, and realtime subscription as the full Tasks dashboard, so it
// live-updates and supports the inline stage/quadrant cycling.
// ─────────────────────────────────────────────────────────────────────────────

import { useMemo } from "react";
import { useAuth } from "@portal/context/AuthContext";
import { RefreshCw, ExternalLink } from "lucide-react";
import { TaskTile } from "../components/TaskTile";
import {
  useStaffTasks,
  useStaffProfiles,
  useStaffTasksRealtime,
  type StaffTaskStatus,
} from "../hooks/use-task-queries";

const OPEN_STATUSES: StaffTaskStatus[] = ["not_started", "in_progress", "blocked"];

export default function TaskWidget() {
  const { user } = useAuth();
  const userId = user?.id;

  // Keep the list cache fresh over the websocket — same hook the dashboard uses.
  useStaffTasksRealtime();

  const { data: tasks = [], isLoading, isFetching, refetch } = useStaffTasks({
    assignedTo: userId,
    statuses:   OPEN_STATUSES,
  });
  const { data: profiles = [] } = useStaffProfiles();

  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of profiles) m.set(p.id, p.full_name || p.email || "Unknown");
    return m;
  }, [profiles]);

  return (
    <div className="flex h-screen w-screen flex-col bg-[var(--bg-base,#0b0d12)] text-foreground">
      {/* Drag handle / header. -webkit-app-region lets the launcher treat this
          strip as the window's title bar so the whole widget is draggable. */}
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
        <div
          className="flex items-center gap-1 shrink-0"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          <button
            type="button"
            onClick={() => refetch()}
            title="Refresh"
            className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
          >
            <RefreshCw className={"h-3.5 w-3.5 " + (isFetching ? "animate-spin" : "")} />
          </button>
          <a
            href="/tasks"
            target="_blank"
            rel="noreferrer"
            title="Open full Tasks app"
            className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </header>

      {/* Scrollable task list */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {isLoading ? (
          <p className="px-1 py-6 text-center text-xs text-muted-foreground">Loading…</p>
        ) : tasks.length === 0 ? (
          <p className="px-1 py-6 text-center text-xs text-muted-foreground">
            🎉 Nothing open — you're all clear.
          </p>
        ) : (
          tasks.map((task) => (
            <TaskTile
              key={task.id}
              task={task}
              assigneeName={nameById.get(task.assigned_to) || "Unknown"}
              creatorName={nameById.get(task.created_by)}
              // In the widget, opening the drawer isn't available — send the
              // user to the full app focused on this task instead.
              onClick={() => window.open(`/tasks?task=${task.id}`, "_blank", "noreferrer")}
            />
          ))
        )}
      </div>
    </div>
  );
}
