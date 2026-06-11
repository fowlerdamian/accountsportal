import { useState, useMemo, useEffect } from "react";
import { Link } from "react-router-dom";
import { Inbox, ChevronUp, Plus } from "lucide-react";
import { cn } from "@guide/lib/utils";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@guide/components/ui/popover";
import { useAuth } from "../context/AuthContext.jsx";
import { useIsMobile } from "../hooks/useIsMobile.js";
import {
  useStaffTasks,
  useStaffProfiles,
  useStaffTasksRealtime,
  useAssignmentNotifications,
  type StaffTask,
} from "../apps/Tasks/hooks/use-task-queries";
import { scoreSort, quadrantOf, QUADRANT_LABEL } from "../apps/Tasks/lib/eisenhower";
import { TaskTile } from "../apps/Tasks/components/TaskTile";
import { TaskDrawer } from "../apps/Tasks/components/TaskDrawer";
import { QuadrantPill } from "../apps/Tasks/components/QuadrantPill";

// Persistent bottom dock visible on every authenticated portal page.
// Mounted at the root of App.jsx (NOT inside any sub-app's layout) so it
// stays put as the user switches between /accounts, /projects, /tasks, etc.

const DOCK_HEIGHT = 56;
const TOP_N       = 10;

function nameFor(
  profiles: { id: string; full_name: string | null; email: string | null }[],
  id:       string,
  selfId?:  string,
): string {
  if (id === selfId) return "Me";
  const p = profiles.find((x) => x.id === id);
  return p?.full_name ?? p?.email ?? id.slice(0, 8);
}

export function TaskDock() {
  const { user }  = useAuth();
  const userId    = user?.id ?? "";
  const isMobile  = useIsMobile();
  const [drawerTaskId, setDrawerTaskId] = useState<string | null>(null);

  // Keep the local cache fresh for every staff_tasks change.
  useStaffTasksRealtime();

  // Toast when someone else assigns me a task.
  useAssignmentNotifications(userId || undefined, (t) => {
    toast.message(`New task: ${t.title}`, {
      description: t.due_date ? `Due ${t.due_date}` : undefined,
      action: { label: "Open", onClick: () => setDrawerTaskId(t.id) },
    });
  });

  // Expose the dock's height as a CSS variable so layouts (Layout.jsx,
  // HubLayout.tsx, TasksLayout.tsx, Guide's AdminLayout, etc.) can subtract
  // it from their 100dvh shells to reserve space for the strip.
  useEffect(() => {
    if (!user) return;
    const root = document.documentElement;
    const prev = root.style.getPropertyValue("--task-dock-h");
    root.style.setProperty("--task-dock-h", `${DOCK_HEIGHT}px`);
    return () => { root.style.setProperty("--task-dock-h", prev); };
  }, [user]);

  const { data: tasks = [] }      = useStaffTasks({
    assignedTo: userId,
    statuses:   ["not_started", "in_progress", "blocked"],
  });
  const { data: profiles = [] }   = useStaffProfiles();

  const sorted: StaffTask[] = useMemo(() => [...tasks].sort(scoreSort), [tasks]);
  const topN    = sorted.slice(0, TOP_N);
  const overflow = sorted.slice(TOP_N);

  // Opens the global NewTaskModal (mounted by GlobalShortcuts) — same path the
  // "n" shortcut and the in-app New Task buttons use.
  const openNewTask = () => window.dispatchEvent(new CustomEvent("portal:new-task"));

  if (!user) return null;

  // Mobile: collapse to a single pill that opens a popover with the full list.
  if (isMobile) {
    return (
      <>
        <div
          data-ai-ignore
          className="fixed bottom-0 inset-x-0 z-30 flex items-center px-3"
          style={{
            height:     DOCK_HEIGHT,
            background: "var(--bg-elevated)",
            borderTop:  "1px solid var(--border-default)",
          }}
        >
          {sorted.length === 0 ? (
            <Link to="/tasks" className="text-xs text-muted-foreground flex items-center gap-2">
              <Inbox className="w-3.5 h-3.5" /> No active tasks
            </Link>
          ) : (
            <Popover>
              <PopoverTrigger asChild>
                <button className="flex items-center gap-2 text-xs px-3 py-1.5 rounded border border-border bg-background hover:bg-muted">
                  <Inbox className="w-3.5 h-3.5" />
                  <span>{sorted.length} active task{sorted.length === 1 ? "" : "s"}</span>
                  <ChevronUp className="w-3.5 h-3.5" />
                </button>
              </PopoverTrigger>
              <PopoverContent side="top" align="start" className="w-[300px] max-h-[60vh] overflow-y-auto p-2 space-y-1">
                {sorted.map((t) => (
                  <TaskTile
                    key={t.id}
                    task={t}
                    assigneeName={nameFor(profiles, t.assigned_to, userId)}
                    creatorName={nameFor(profiles, t.created_by, userId)}
                    onClick={() => setDrawerTaskId(t.id)}
                  />
                ))}
              </PopoverContent>
            </Popover>
          )}

          <button
            onClick={openNewTask}
            title="New task"
            aria-label="New task"
            className="ml-auto flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider px-3 py-1.5 rounded shrink-0"
            style={{
              color: "#f3ca0f",
              background: "rgba(243,202,15,0.06)",
              border: "1px solid rgba(243,202,15,0.4)",
            }}
          >
            <Plus className="w-3.5 h-3.5" />
            New
          </button>
        </div>

        <TaskDrawer
          taskId={drawerTaskId}
          open={drawerTaskId !== null}
          onClose={() => setDrawerTaskId(null)}
        />
      </>
    );
  }

  // Desktop: full horizontal strip of pills.
  return (
    <>
      <div
        data-ai-ignore
        className="fixed bottom-0 inset-x-0 z-30 flex items-center gap-2 px-3"
        style={{
          height:     DOCK_HEIGHT,
          background: "var(--bg-elevated)",
          borderTop:  "1px solid var(--border-default)",
        }}
      >
        <Link
          to="/tasks"
          title="Open Tasks app"
          className="flex items-center gap-1.5 px-2.5 h-9 rounded-md border border-border/60 text-xs text-muted-foreground hover:text-foreground hover:border-border transition-colors font-mono uppercase tracking-wider shrink-0"
        >
          <Inbox className="w-3.5 h-3.5" />
          Tasks
        </Link>

        <div className="flex items-center gap-1.5 overflow-x-auto flex-1 min-w-0 py-1">
          {topN.length === 0 ? (
            <span className="text-xs text-muted-foreground italic">
              No active tasks — <Link to="/tasks" className="underline hover:text-foreground">create one</Link>
            </span>
          ) : (
            topN.map((t) => (
              <TaskTile
                key={t.id}
                task={t}
                assigneeName={nameFor(profiles, t.assigned_to, userId)}
                onClick={() => setDrawerTaskId(t.id)}
                variant="dock"
                // Cap pill width so more tasks fit in the strip — the label
                // truncates with an ellipsis and the full title is on hover.
                className="max-w-[180px]"
              />
            ))
          )}
        </div>

        {overflow.length > 0 && (
          <Popover>
            <PopoverTrigger asChild>
              <button
                className="flex items-center gap-1 px-2.5 h-9 rounded-md border border-border/60 text-xs text-muted-foreground hover:text-foreground hover:border-border transition-colors shrink-0"
                title={`${overflow.length} more`}
              >
                +{overflow.length}
                <ChevronUp className="w-3.5 h-3.5" />
              </button>
            </PopoverTrigger>
            <PopoverContent side="top" align="end" className="w-[340px] max-h-[60vh] overflow-y-auto p-2 space-y-1.5">
              <div className="px-1 pb-1 flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Below the fold
                </span>
                <span className="text-[10px] text-muted-foreground">{overflow.length}</span>
              </div>
              {overflow.map((t) => (
                <div key={t.id} className="flex items-center gap-2">
                  <QuadrantPill quadrant={quadrantOf(t.urgency, t.importance)} size="sm" />
                  <TaskTile
                    task={t}
                    assigneeName={nameFor(profiles, t.assigned_to, userId)}
                    onClick={() => setDrawerTaskId(t.id)}
                    variant="dock"
                    className="flex-1"
                  />
                </div>
              ))}
            </PopoverContent>
          </Popover>
        )}

        <button
          onClick={openNewTask}
          title="New task [N]"
          className="flex items-center gap-1.5 px-2.5 h-9 rounded-md text-xs font-medium uppercase tracking-wider shrink-0 transition-colors"
          style={{
            color: "#f3ca0f",
            background: "rgba(243,202,15,0.06)",
            border: "1px solid rgba(243,202,15,0.4)",
          }}
        >
          <Plus className="w-3.5 h-3.5" />
          New Task
        </button>
      </div>

      <TaskDrawer
        taskId={drawerTaskId}
        open={drawerTaskId !== null}
        onClose={() => setDrawerTaskId(null)}
      />
    </>
  );
}
