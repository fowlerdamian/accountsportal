import { useMemo, useState } from "react";
import { Search, Loader2, Plus, LayoutGrid, Columns3, Grid2x2 } from "lucide-react";
import { Input } from "@guide/components/ui/input";
import { Button } from "@guide/components/ui/button";
import { cn } from "@guide/lib/utils";
import { FilterPill } from "@portal/components/FilterPill";
import { useAuth } from "../../../context/AuthContext.jsx";
import {
  useStaffTasks,
  useStaffProfiles,
  type StaffTask,
  type StaffTaskStatus,
  type StaffProfile,
} from "../hooks/use-task-queries";
import { quadrantOf, scoreSort, type Quadrant, QUADRANT_LABEL } from "../lib/eisenhower";
import { TaskTile } from "../components/TaskTile";
import { KanbanBoard } from "../components/KanbanBoard";
import { EisenhowerMatrix } from "../components/EisenhowerMatrix";
import { useTasksUi } from "../components/TasksLayout";

type ViewMode = "grid" | "kanban" | "matrix";

type Scope     = "mine" | "assigned_by_me" | "involving_me" | "all";
type DueWindow = "overdue" | "today" | "week" | "later" | "done" | "none";

function dueWindow(t: StaffTask): DueWindow {
  if (t.status === "done") return "done";
  if (!t.due_date) return "none";
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due   = new Date(t.due_date + "T00:00:00");
  const days  = Math.round((due.getTime() - today.getTime()) / 86_400_000);
  if (days < 0)  return "overdue";
  if (days === 0) return "today";
  if (days <= 7) return "week";
  return "later";
}

const WINDOW_ORDER: DueWindow[] = ["overdue", "today", "week", "later", "none", "done"];
const WINDOW_LABEL: Record<DueWindow, string> = {
  overdue: "Overdue",
  today:   "Today",
  week:    "This Week",
  later:   "Later",
  none:    "No Due Date",
  done:    "Done",
};

function nameFor(profiles: StaffProfile[], id: string, selfId?: string): string {
  if (id === selfId) return "Me";
  const p = profiles.find((x) => x.id === id);
  return p?.full_name ?? p?.email ?? id.slice(0, 8);
}

export function TasksDashboard() {
  const { user }      = useAuth();
  const userId        = user?.id ?? "";
  const { openNewTask, openDrawer } = useTasksUi();

  const [view,          setView]          = useState<ViewMode>("grid");
  const [scope,         setScope]         = useState<Scope>("mine");
  const [search,        setSearch]        = useState("");
  const [statusFilter,  setStatusFilter]  = useState<StaffTaskStatus | "all">("all");
  const [quadFilter,    setQuadFilter]    = useState<Quadrant | "all">("all");
  const [showDone,      setShowDone]      = useState(false);

  const queryParams = scope === "mine"
    ? { assignedTo: userId }
    : scope === "assigned_by_me"
      ? { createdBy: userId }
      : scope === "involving_me"
        ? { involving:  userId }
        : {};

  const { data: rawTasks = [], isLoading } = useStaffTasks(queryParams);
  const { data: profiles = [] }            = useStaffProfiles();

  // "Assigned by me" = tasks I created for *someone else*; drop the ones I
  // kept for myself so this scope only shows work I've delegated out.
  const tasks = useMemo(
    () => (scope === "assigned_by_me"
      ? rawTasks.filter((t) => t.assigned_to !== userId)
      : rawTasks),
    [rawTasks, scope, userId],
  );

  const filtered = useMemo(() => {
    return tasks
      .filter((t) => statusFilter === "all" || t.status === statusFilter)
      .filter((t) => quadFilter === "all" || quadrantOf(t.urgency, t.importance) === quadFilter)
      .filter((t) => !search.trim() || t.title.toLowerCase().includes(search.trim().toLowerCase()))
      .filter((t) => showDone || t.status !== "done");
  }, [tasks, statusFilter, quadFilter, search, showDone]);

  // Group by due-window, sort within each by Eisenhower score
  const groups = useMemo(() => {
    const g: Record<DueWindow, StaffTask[]> = { overdue: [], today: [], week: [], later: [], none: [], done: [] };
    for (const t of filtered) g[dueWindow(t)].push(t);
    for (const k of Object.keys(g) as DueWindow[]) g[k].sort(scoreSort);
    return g;
  }, [filtered]);

  const counts = {
    all:   tasks.length,
    not_started: tasks.filter((t) => t.status === "not_started").length,
    in_progress: tasks.filter((t) => t.status === "in_progress").length,
    blocked:     tasks.filter((t) => t.status === "blocked").length,
    done:        tasks.filter((t) => t.status === "done").length,
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-fade-in">

      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Search */}
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tasks…"
            className="pl-8 h-8 text-xs"
          />
        </div>

        {/* Scope */}
        <div className="flex items-center gap-1 flex-wrap">
          <FilterPill active={scope === "mine"} onClick={() => setScope("mine")}>Mine</FilterPill>
          <FilterPill active={scope === "assigned_by_me"} onClick={() => setScope("assigned_by_me")}>Assigned by me</FilterPill>
          <FilterPill active={scope === "involving_me"} onClick={() => setScope("involving_me")}>Involving me</FilterPill>
          <FilterPill active={scope === "all"} onClick={() => setScope("all")}>Everyone</FilterPill>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <FilterPill active={showDone} onClick={() => setShowDone((v) => !v)}>
            Show Done <span className="ml-1 opacity-50">{counts.done}</span>
          </FilterPill>

          {/* View toggle — mirrors ProjectsList.tsx grid/kanban switch */}
          <div className="flex items-center rounded-md border overflow-hidden">
            <button
              onClick={() => setView("grid")}
              className={cn("p-1.5 transition-colors", view === "grid" ? "bg-muted" : "hover:bg-muted/50")}
              title="Grid view"
              aria-label="Grid view"
            >
              <LayoutGrid className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setView("kanban")}
              className={cn("p-1.5 transition-colors", view === "kanban" ? "bg-muted" : "hover:bg-muted/50")}
              title="Kanban view"
              aria-label="Kanban view"
            >
              <Columns3 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setView("matrix")}
              className={cn("p-1.5 transition-colors", view === "matrix" ? "bg-muted" : "hover:bg-muted/50")}
              title="Eisenhower matrix view"
              aria-label="Matrix view"
            >
              <Grid2x2 className="w-3.5 h-3.5" />
            </button>
          </div>

          <Button size="sm" onClick={openNewTask}>
            <Plus className="w-3.5 h-3.5 mr-1.5" />
            New Task
          </Button>
        </div>
      </div>

      {/* Status + quadrant chips */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] text-muted-foreground/60 mr-0.5">Status</span>
        <FilterPill active={statusFilter === "all"} onClick={() => setStatusFilter("all")}>
          All <span className="ml-1 opacity-50">{counts.all}</span>
        </FilterPill>
        <FilterPill active={statusFilter === "not_started"} onClick={() => setStatusFilter("not_started")}>
          Not Started <span className="ml-1 opacity-50">{counts.not_started}</span>
        </FilterPill>
        <FilterPill active={statusFilter === "in_progress"} onClick={() => setStatusFilter("in_progress")}>
          In Progress <span className="ml-1 opacity-50">{counts.in_progress}</span>
        </FilterPill>
        <FilterPill active={statusFilter === "blocked"} onClick={() => setStatusFilter("blocked")}>
          Blocked <span className="ml-1 opacity-50">{counts.blocked}</span>
        </FilterPill>

        <span className="text-[11px] text-muted-foreground/60 ml-3 mr-0.5">Quadrant</span>
        {(["all", "do", "schedule", "delegate", "drop"] as (Quadrant | "all")[]).map((q) => (
          <FilterPill key={q} active={quadFilter === q} onClick={() => setQuadFilter(q)}>
            {q === "all" ? "All" : QUADRANT_LABEL[q]}
          </FilterPill>
        ))}
      </div>

      {/* Body — switches between grid / kanban / matrix views */}
      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <p className="text-muted-foreground text-sm">No tasks match.</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={openNewTask}>
            <Plus className="w-3.5 h-3.5 mr-1.5" />Create one
          </Button>
        </div>
      ) : view === "kanban" ? (
        <KanbanBoard
          tasks={filtered}
          profiles={profiles}
          myId={userId}
          onOpenTask={openDrawer}
        />
      ) : view === "matrix" ? (
        <EisenhowerMatrix
          tasks={filtered}
          profiles={profiles}
          myId={userId}
          onOpenTask={openDrawer}
        />
      ) : (
        WINDOW_ORDER.map((win) => {
          const list = groups[win];
          if (list.length === 0) return null;
          return (
            <section key={win} className="space-y-2">
              <h2 className={cn(
                "text-xs font-semibold uppercase tracking-wider",
                win === "overdue" ? "text-[var(--brand-pink)]"
                  : win === "today" ? "text-[var(--brand-orange)]"
                  : "text-muted-foreground",
              )}>
                {WINDOW_LABEL[win]} <span className="opacity-50">· {list.length}</span>
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5">
                {list.map((t) => (
                  <TaskTile
                    key={t.id}
                    task={t}
                    assigneeName={nameFor(profiles, t.assigned_to, userId)}
                    creatorName={nameFor(profiles, t.created_by, userId)}
                    onClick={() => openDrawer(t.id)}
                  />
                ))}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}
