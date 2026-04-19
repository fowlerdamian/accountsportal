import { useRef, useState } from "react";
import { Check, Loader2, Plus, ShoppingCart, X as XIcon } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@guide/lib/utils";
import {
  useProjectStages,
  useUpdateProjectStage,
  useTasks,
  useUpdateTask,
  useCreateTask,
  type ProjectStage,
  type Task,
  type TaskStatus,
} from "@hub/hooks/use-hub-queries";

// ── Task status bubble config ─────────────────────────────────

const BUBBLE: Record<TaskStatus, { label: string; bg: string; text: string; ring: string }> = {
  backlog:     { label: "To Do",       bg: "bg-zinc-800",     text: "text-zinc-300",  ring: "ring-zinc-600" },
  in_progress: { label: "In Progress", bg: "bg-blue-900/70",  text: "text-blue-200",  ring: "ring-blue-600" },
  review:      { label: "Stuck",       bg: "bg-red-900/70",   text: "text-red-200",   ring: "ring-red-600" },
  done:        { label: "Complete",    bg: "bg-green-900/70", text: "text-green-200", ring: "ring-green-600" },
};

const STATUS_CYCLE: TaskStatus[] = ["backlog", "in_progress", "review", "done"];

function nextStatus(s: TaskStatus): TaskStatus {
  return STATUS_CYCLE[(STATUS_CYCLE.indexOf(s) + 1) % STATUS_CYCLE.length];
}

// ── Status bubble ─────────────────────────────────────────────

function StatusBubble({ status, onClick }: { status: TaskStatus; onClick: () => void }) {
  const cfg = BUBBLE[status];
  return (
    <button
      onClick={e => { e.stopPropagation(); onClick(); }}
      className={cn(
        "px-3 py-1 rounded-full text-[11px] font-semibold ring-1 transition-all",
        "hover:brightness-125 active:scale-95 whitespace-nowrap shrink-0",
        cfg.bg, cfg.text, cfg.ring,
      )}
    >
      {cfg.label}
    </button>
  );
}

// ── Horizontal stage stepper ──────────────────────────────────

function StageStepper({
  stages,
  onJump,
  onToggleOrdered,
  activating,
}: {
  stages:           ProjectStage[];
  onJump:           (stage: ProjectStage) => void;
  onToggleOrdered:  (stage: ProjectStage) => void;
  activating:       boolean;
}) {
  const activeIdx = stages.findIndex(s => s.is_active);

  return (
    <div className="px-8 py-10">
      <div className="flex items-start">
        {stages.map((stage, i) => {
          const isCompleted = !stage.is_active && !!stage.end_date;
          const isActive    = stage.is_active;
          const isFuture    = !isActive && !isCompleted;
          const isLast      = i === stages.length - 1;
          const lineActive  = i < activeIdx || (isActive && i < stages.length - 1);
          const isClickable = !activating && !isActive;

          return (
            <div
              key={stage.id}
              className={cn("flex items-start", !isLast && "flex-1")}
            >
              {/* Node + label */}
              <div className="flex flex-col items-center gap-2 z-10">
                <div className="relative">
                  <button
                    onClick={() => isClickable && onJump(stage)}
                    disabled={activating || isActive}
                    title={
                      isActive    ? undefined
                      : isCompleted ? `Roll back to ${stage.name}`
                      : `Jump to ${stage.name}`
                    }
                    className={cn(
                      "w-12 h-12 rounded-full flex items-center justify-center border-2 text-sm font-bold transition-all duration-200",
                      isActive    && "border-primary bg-primary/15 text-primary scale-115 shadow-[0_0_24px_rgba(243,202,15,0.4)]",
                      isCompleted && "border-green-500 bg-green-500/15 text-green-400 cursor-pointer hover:bg-amber-500/15 hover:border-amber-500 hover:text-amber-400",
                      isFuture    && "border-border/30 bg-background text-muted-foreground/30",
                      isFuture && !activating && "hover:border-border/60 hover:text-muted-foreground/60 cursor-pointer",
                      activating  && !isActive && "opacity-40 cursor-not-allowed",
                    )}
                  >
                    {isCompleted
                      ? <Check className="w-5 h-5" />
                      : <span>{i + 1}</span>
                    }
                  </button>

                  {/* Prototype ordered badge */}
                  {stage.name === "Prototype" && (isActive || isCompleted) && (
                    <button
                      onClick={e => { e.stopPropagation(); onToggleOrdered(stage); }}
                      title={(stage.metadata?.ordered) ? "Mark as NOT ordered" : "Mark as ordered"}
                      className={cn(
                        "absolute -bottom-1 -right-1 w-5 h-5 rounded-full border-2 border-background flex items-center justify-center transition-colors",
                        stage.metadata?.ordered
                          ? "bg-green-500 text-white"
                          : "bg-red-500/80 text-white",
                      )}
                    >
                      {stage.metadata?.ordered
                        ? <Check className="w-2.5 h-2.5" />
                        : <XIcon className="w-2.5 h-2.5" />
                      }
                    </button>
                  )}
                </div>

                <div className="text-center min-w-[60px]">
                  <p className={cn(
                    "text-xs font-semibold",
                    isActive    && "text-primary",
                    isCompleted && "text-green-400",
                    isFuture    && "text-muted-foreground/30",
                  )}>
                    {stage.name}
                  </p>
                  {isActive && stage.name === "Prototype" && (
                    <p className={cn(
                      "text-[10px] font-semibold mt-0.5",
                      stage.metadata?.ordered ? "text-green-400" : "text-red-400",
                    )}>
                      {stage.metadata?.ordered ? "Ordered" : "Not ordered"}
                    </p>
                  )}
                  {isActive && stage.name !== "Prototype" && (
                    <p className="text-[10px] text-muted-foreground mt-0.5 font-mono">ACTIVE</p>
                  )}
                  {isCompleted && stage.end_date && (
                    <p className="text-[10px] text-green-400/50 mt-0.5">{stage.end_date}</p>
                  )}
                  {isCompleted && (
                    <p className="text-[10px] text-muted-foreground/30 mt-0.5">click to roll back</p>
                  )}
                </div>
              </div>

              {/* Connector line */}
              {!isLast && (
                <div className="flex-1 h-0.5 mt-6 mx-2 relative">
                  <div className="absolute inset-0 bg-border/20 rounded-full" />
                  <div
                    className={cn(
                      "absolute inset-y-0 left-0 rounded-full transition-all duration-500",
                      lineActive ? "bg-primary/50 right-0" : "bg-transparent w-0",
                    )}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Task row ──────────────────────────────────────────────────

function TaskRow({
  task,
  onStatus,
}: {
  task:     Task;
  onStatus: (id: string, s: TaskStatus) => void;
}) {
  return (
    <div className="flex items-center gap-3 px-5 py-3 border-b border-border/30 last:border-0 hover:bg-muted/10 transition-colors">
      {/* Status dot */}
      <div className={cn(
        "w-2 h-2 rounded-full shrink-0",
        task.status === "backlog"     && "bg-zinc-500",
        task.status === "in_progress" && "bg-blue-400",
        task.status === "review"      && "bg-red-400",
        task.status === "done"        && "bg-green-400",
      )} />

      <span className={cn(
        "flex-1 text-sm min-w-0",
        task.status === "done" && "line-through text-muted-foreground",
      )}>
        {task.title}
      </span>

      {task.due_date && (
        <span className="text-[11px] text-muted-foreground shrink-0 hidden sm:block font-mono">
          {task.due_date}
        </span>
      )}

      <StatusBubble
        status={task.status}
        onClick={() => onStatus(task.id, nextStatus(task.status))}
      />
    </div>
  );
}

// ── Main component ────────────────────────────────────────────

interface ProductStagesViewProps {
  projectId: string;
}

export function ProductStagesView({ projectId }: ProductStagesViewProps) {
  const { data: stages = [], isLoading: stagesLoading } = useProjectStages(projectId);
  const { data: tasks  = [], isLoading: tasksLoading  } = useTasks(projectId);
  const { mutateAsync: updateStage } = useUpdateProjectStage();
  const { mutateAsync: updateTask  } = useUpdateTask();
  const { mutateAsync: createTask  } = useCreateTask();

  const [activating,  setActivating]  = useState(false);
  const [addingTask,  setAddingTask]   = useState(false);
  const [newTitle,    setNewTitle]     = useState("");
  const [saving,      setSaving]       = useState(false);
  const addInputRef = useRef<HTMLInputElement>(null);

  async function handleJump(stage: ProjectStage) {
    setActivating(true);
    const today      = new Date().toISOString().split("T")[0];
    const current    = stages.find(s => s.is_active);
    const isRollback = !stage.is_active && !!stage.end_date;
    const isSkip     = !isRollback && current && stage.position > current.position + 1;

    try {
      if (isRollback) {
        // Deactivate current (clear end_date so it looks unfinished again)
        if (current) {
          await updateStage({ id: current.id, project_id: current.project_id, end_date: null, is_active: false });
        }
        // Clear end_date from all stages after target too
        const laterStages = stages.filter(s => s.position > stage.position);
        for (const s of laterStages) {
          await updateStage({ id: s.id, project_id: s.project_id, end_date: null, is_active: false });
        }
      } else {
        // Forward move — close current stage
        if (current) {
          await updateStage({ id: current.id, project_id: current.project_id, end_date: today, is_active: false });
        }
        // Fill in any skipped stages between current and target
        if (isSkip) {
          const skipped = stages.filter(s =>
            s.position > (current?.position ?? -1) && s.position < stage.position
          );
          for (const s of skipped) {
            await updateStage({
              id:         s.id,
              project_id: s.project_id,
              start_date: s.start_date ?? today,
              end_date:   today,
              is_active:  false,
            });
          }
        }
      }

      // Activate target stage
      await updateStage({
        id:         stage.id,
        project_id: stage.project_id,
        start_date: stage.start_date ?? today,
        end_date:   null,
        is_active:  true,
      });

      toast.success(isRollback ? `Rolled back to "${stage.name}"` : `Moved to "${stage.name}"`);
    } catch {
      toast.error("Failed to update stage");
    } finally {
      setActivating(false);
    }
  }

  async function handleToggleOrdered(stage: ProjectStage) {
    try {
      const nowOrdered = !stage.metadata?.ordered;
      await updateStage({
        id:         stage.id,
        project_id: stage.project_id,
        metadata:   { ...(stage.metadata ?? {}), ordered: nowOrdered },
      });
      toast.success(nowOrdered ? "Marked as ordered" : "Marked as not ordered");
    } catch {
      toast.error("Failed to update ordered status");
    }
  }

  async function handleStatus(taskId: string, newSt: TaskStatus) {
    try {
      await updateTask({ id: taskId, status: newSt });
    } catch {
      toast.error("Failed to update task");
    }
  }

  async function handleAddTask() {
    if (!newTitle.trim()) return;
    setSaving(true);
    try {
      await createTask({
        project_id: projectId,
        title:      newTitle.trim(),
        priority:   "medium",
        position:   tasks.length,
      });
      setNewTitle("");
      addInputRef.current?.focus();
    } catch {
      toast.error("Failed to add task");
    } finally {
      setSaving(false);
    }
  }

  if (stagesLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  const completed  = stages.filter(s => s.end_date && !s.is_active).length;
  const doneTasks  = tasks.filter(t => t.status === "done").length;
  const totalTasks = tasks.length;

  return (
    <div className="space-y-4">

      {/* ── Stage stepper ─────────────────────────────────── */}
      <div className="rounded-xl border bg-background overflow-hidden">
        <div className="px-5 py-3.5 border-b bg-muted/20 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Development Stages</h2>
          <span className="text-xs text-muted-foreground font-mono">
            {completed} / {stages.length} stages done
          </span>
        </div>

        {stages.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground text-sm">
            No stages found for this project.
          </div>
        ) : (
          <StageStepper stages={stages} onJump={handleJump} onToggleOrdered={handleToggleOrdered} activating={activating} />
        )}
      </div>

      {/* ── Task list ─────────────────────────────────────── */}
      <div className="rounded-xl border bg-background overflow-hidden">
        <div className="px-5 py-3.5 border-b bg-muted/20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold">Tasks</h2>
            {totalTasks > 0 && (
              <span className="text-xs text-muted-foreground font-mono">
                {doneTasks}/{totalTasks} done
              </span>
            )}
          </div>
          <button
            onClick={() => { setAddingTask(true); setTimeout(() => addInputRef.current?.focus(), 50); }}
            className="text-xs text-primary hover:underline flex items-center gap-1"
          >
            <Plus className="w-3.5 h-3.5" /> Add task
          </button>
        </div>

        {tasksLoading ? (
          <div className="p-6 flex justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-primary" />
          </div>
        ) : (
          <>
            {tasks.length === 0 && !addingTask && (
              <div className="p-6 text-center text-sm text-muted-foreground">
                No tasks yet.{" "}
                <button
                  className="text-primary hover:underline"
                  onClick={() => { setAddingTask(true); setTimeout(() => addInputRef.current?.focus(), 50); }}
                >
                  Add the first one
                </button>
              </div>
            )}

            {/* Status legend */}
            {tasks.length > 0 && (
              <div className="px-5 py-2 border-b border-border/20 flex items-center gap-4">
                {(["backlog", "in_progress", "review", "done"] as TaskStatus[]).map(s => (
                  <div key={s} className="flex items-center gap-1.5">
                    <div className={cn(
                      "w-1.5 h-1.5 rounded-full",
                      s === "backlog"     && "bg-zinc-500",
                      s === "in_progress" && "bg-blue-400",
                      s === "review"      && "bg-red-400",
                      s === "done"        && "bg-green-400",
                    )} />
                    <span className="text-[10px] text-muted-foreground">{BUBBLE[s].label}</span>
                  </div>
                ))}
                <span className="ml-auto text-[10px] text-muted-foreground">Click bubble to cycle status</span>
              </div>
            )}

            {tasks.map(task => (
              <TaskRow key={task.id} task={task} onStatus={handleStatus} />
            ))}

            {addingTask && (
              <div className="flex items-center gap-2 px-5 py-3 border-t border-border/30 bg-muted/10">
                <div className="w-2 h-2 rounded-full bg-zinc-600 shrink-0" />
                <input
                  ref={addInputRef}
                  value={newTitle}
                  onChange={e => setNewTitle(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter") handleAddTask();
                    if (e.key === "Escape") { setAddingTask(false); setNewTitle(""); }
                  }}
                  placeholder="Task title…"
                  className="flex-1 bg-transparent outline-none text-sm placeholder:text-muted-foreground/40"
                />
                <button
                  onClick={handleAddTask}
                  disabled={saving || !newTitle.trim()}
                  className="px-3 py-1 text-xs rounded bg-primary text-primary-foreground font-semibold disabled:opacity-40 flex items-center gap-1"
                >
                  {saving && <Loader2 className="w-3 h-3 animate-spin" />}
                  Add
                </button>
                <button
                  onClick={() => { setAddingTask(false); setNewTitle(""); }}
                  className="text-xs text-muted-foreground hover:text-foreground px-2"
                >
                  Cancel
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
