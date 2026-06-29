import { useState } from "react";
import { cn } from "@guide/lib/utils";
import { toast } from "sonner";
import { TaskTile } from "./TaskTile";
import {
  type StaffTask,
  type StaffTaskStatus,
  type StaffProfile,
  useUpdateStaffTask,
} from "../hooks/use-task-queries";

// HTML5 drag-drop kanban matching the pattern at
// src/apps/ContractorHub/pages/ProjectView.tsx lines 686-691 — opacity-40
// on the dragged card, border-t-2 border-t-primary on the drop target.

interface KanbanBoardProps {
  tasks:      StaffTask[];
  profiles:   StaffProfile[];
  myId?:      string;
  onOpenTask: (id: string) => void;
}

const COLUMNS: { key: StaffTaskStatus; label: string; tint: string }[] = [
  { key: "not_started", label: "Not Started", tint: "border-t-muted-foreground/40" },
  { key: "in_progress", label: "In Progress", tint: "border-t-[rgba(var(--brand-aqua-rgb),0.6)]" },
  { key: "blocked",     label: "Blocked",     tint: "border-t-[rgba(var(--brand-accent-rgb),0.6)]" },
  { key: "done",        label: "Done",        tint: "border-t-[rgba(var(--brand-aqua-rgb),0.6)]" },
];

function nameFor(profiles: StaffProfile[], id: string, selfId?: string): string {
  if (id === selfId) return "Me";
  const p = profiles.find((x) => x.id === id);
  return p?.full_name ?? p?.email ?? id.slice(0, 8);
}

export function KanbanBoard({ tasks, profiles, myId, onOpenTask }: KanbanBoardProps) {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [overCol,   setOverCol]   = useState<StaffTaskStatus | null>(null);
  const { mutateAsync: updateTask } = useUpdateStaffTask();

  async function handleDrop(target: StaffTaskStatus) {
    if (!draggedId) return;
    const t = tasks.find((x) => x.id === draggedId);
    setDraggedId(null);
    setOverCol(null);
    if (!t || t.status === target) return;

    // Don't let users force a task out of 'blocked' until its blocker is done —
    // but only when there IS a blocker. A task dragged into Blocked manually
    // (no blocked_by_task_id) must stay freely movable, or it's trapped forever.
    if (t.status === "blocked" && t.blocked_by_task_id && target !== "done") {
      toast.error("Resolve the blocker first");
      return;
    }
    try {
      await updateTask({ id: t.id, status: target });
    } catch {
      toast.error("Failed to move task");
    }
  }

  return (
    <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 items-start">
      {COLUMNS.map((col) => {
        const colTasks = tasks.filter((t) => t.status === col.key);
        const isOver   = overCol === col.key;
        return (
          <div
            key={col.key}
            onDragOver={(e) => { e.preventDefault(); setOverCol(col.key); }}
            onDragLeave={() => setOverCol((c) => (c === col.key ? null : c))}
            onDrop={() => handleDrop(col.key)}
            className={cn(
              "rounded-lg border border-t-2 bg-muted/20 flex flex-col gap-2 p-3 min-h-[140px]",
              col.tint,
              isOver && "border-t-primary ring-1 ring-primary/40",
            )}
          >
            <div className="flex items-center justify-between px-0.5 mb-1">
              <span className="text-xs font-semibold uppercase tracking-wide">{col.label}</span>
              <span className="text-[10px] text-muted-foreground">{colTasks.length}</span>
            </div>

            {colTasks.length === 0 ? (
              <div className="text-[11px] text-muted-foreground/60 px-1">Drop tasks here</div>
            ) : (
              colTasks.map((t) => (
                <div
                  key={t.id}
                  draggable
                  onDragStart={() => setDraggedId(t.id)}
                  onDragEnd={() => { setDraggedId(null); setOverCol(null); }}
                  className={cn("transition-opacity", draggedId === t.id && "opacity-40")}
                >
                  <TaskTile
                    task={t}
                    assigneeName={nameFor(profiles, t.assigned_to, myId)}
                    creatorName={nameFor(profiles, t.created_by, myId)}
                    onClick={() => onOpenTask(t.id)}
                  />
                </div>
              ))
            )}
          </div>
        );
      })}
    </div>
  );
}
