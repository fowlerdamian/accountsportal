import { useState } from "react";
import { X, Plus, Clock, Paperclip, ChevronRight } from "lucide-react";
import { cn } from "@guide/lib/utils";
import { toast } from "sonner";
import { useAuth } from "@guide/contexts/AuthContext";
import {
  useTasks,
  useTimeEntries,
  useFiles,
  useUpdateTask,
  useCreateTask,
  usePostActivity,
  type Task,
} from "@guide/hooks/use-hub-queries";
import { StatusPill, TASK_STATUS_ORDER, nextTaskStatus } from "./StatusPill";
import { PriorityPill } from "./PriorityPill";
import { ContractorAvatar } from "./ContractorAvatar";

interface TaskDrawerProps {
  task:      Task | null;
  open:      boolean;
  onClose:   () => void;
}

export function TaskDrawer({ task, open, onClose }: TaskDrawerProps) {
  const { user } = useAuth();
  const [editingDesc, setEditingDesc] = useState(false);
  const [descValue, setDescValue]     = useState("");

  const { data: allTasks = [] }       = useTasks(task?.project_id);
  const { data: timeEntries = [] }    = useTimeEntries({ taskId: task?.id });
  const { data: files = [] }          = useFiles({ taskId: task?.id });
  const { mutateAsync: updateTask }   = useUpdateTask();
  const { mutateAsync: createTask }   = useCreateTask();
  const { mutateAsync: postActivity } = usePostActivity();

  const subtasks = allTasks.filter((t) => t.parent_task_id === task?.id);

  const authorName = user?.user_metadata?.full_name
    ?? user?.email?.split("@")[0]
    ?? "Staff";

  if (!task) return null;

  async function handleStatusClick() {
    try {
      const next = nextTaskStatus(task!.status);
      await updateTask({ id: task!.id, status: next });
      if (task!.project_id && user) {
        await postActivity({
          project_id:  task!.project_id,
          task_id:     task!.id,
          type:        "status_change",
          content:     `${authorName} moved "${task!.title}" to ${next.replace("_", " ")}`,
          author_id:   user.id,
          author_name: authorName,
          metadata:    { from: task!.status, to: next },
        });
      }
    } catch {
      toast.error("Failed to update status");
    }
  }

  async function handleDescSave() {
    try {
      await updateTask({ id: task!.id, description: descValue });
      setEditingDesc(false);
      toast.success("Description saved");
    } catch {
      toast.error("Failed to save description");
    }
  }

  function startEditDesc() {
    setDescValue(task!.description ?? "");
    setEditingDesc(true);
  }

  const totalHours = timeEntries.reduce((s, e) => s + (e.hours ?? 0), 0);

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/30"
          onClick={onClose}
        />
      )}

      {/* Drawer */}
      <div
        className={cn(
          "fixed top-0 right-0 h-full z-40",
          "w-full sm:w-[420px]",
          "bg-background border-l shadow-2xl",
          "flex flex-col",
          "transition-transform duration-300 ease-out",
          open ? "translate-x-0" : "translate-x-full",
        )}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b shrink-0 gap-3">
          <div className="flex-1 min-w-0">
            <h2 className="font-semibold text-base leading-snug">{task.title}</h2>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <button onClick={handleStatusClick} title="Click to advance status">
                <StatusPill status={task.status} size="sm" className="cursor-pointer hover:opacity-80 transition-opacity" />
              </button>
              <PriorityPill priority={task.priority} size="sm" />
              {task.due_date && (
                <span className={cn(
                  "text-xs",
                  new Date(task.due_date) < new Date() && task.status !== "done"
                    ? "text-red-400"
                    : "text-muted-foreground"
                )}>
                  Due {task.due_date}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">

          {/* Assignee */}
          {task.contractors && (
            <div className="flex items-center gap-2">
              <ContractorAvatar name={task.contractors.name} size="sm" />
              <span className="text-sm text-muted-foreground">{task.contractors.name}</span>
            </div>
          )}

          {/* Description */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Description
            </h3>
            {editingDesc ? (
              <div className="space-y-2">
                <textarea
                  value={descValue}
                  onChange={(e) => setDescValue(e.target.value)}
                  rows={5}
                  autoFocus
                  className={cn(
                    "w-full resize-none rounded-lg border bg-muted/30 px-3 py-2.5",
                    "text-sm outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30",
                  )}
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleDescSave}
                    className="px-3 py-1.5 rounded text-xs bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setEditingDesc(false)}
                    className="px-3 py-1.5 rounded text-xs hover:bg-muted transition-colors text-muted-foreground"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={startEditDesc}
                className={cn(
                  "w-full text-left rounded-lg px-3 py-2.5 text-sm",
                  "border border-dashed border-border/50 hover:border-border",
                  "text-muted-foreground hover:text-foreground transition-colors",
                  "min-h-[60px]",
                )}
              >
                {task.description || "Add a description..."}
              </button>
            )}
          </div>

          {/* Subtasks */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Subtasks ({subtasks.length})
              </h3>
            </div>
            {subtasks.length === 0 ? (
              <p className="text-xs text-muted-foreground/60">No subtasks</p>
            ) : (
              <ul className="space-y-1">
                {subtasks.map((sub) => (
                  <li key={sub.id} className="flex items-center gap-2 py-1">
                    <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />
                    <span className={cn(
                      "text-sm flex-1 truncate",
                      sub.status === "done" && "line-through text-muted-foreground",
                    )}>
                      {sub.title}
                    </span>
                    <StatusPill status={sub.status} size="sm" />
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Time entries */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Time Logged
              </h3>
              {timeEntries.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  ({totalHours.toFixed(1)} hrs)
                </span>
              )}
            </div>
            {timeEntries.length === 0 ? (
              <p className="text-xs text-muted-foreground/60">No time logged on this task</p>
            ) : (
              <ul className="space-y-1.5">
                {timeEntries.map((entry) => (
                  <li key={entry.id} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <Clock className="w-3 h-3 text-muted-foreground shrink-0" />
                      <span className="text-muted-foreground">{entry.date}</span>
                      {entry.description && (
                        <span className="text-foreground/70 truncate max-w-[160px]">
                          {entry.description}
                        </span>
                      )}
                    </div>
                    <span className="font-medium tabular-nums">{entry.hours}h</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Files */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Files
              </h3>
            </div>
            {files.length === 0 ? (
              <p className="text-xs text-muted-foreground/60">No files attached</p>
            ) : (
              <ul className="space-y-1.5">
                {files.map((file) => (
                  <li key={file.id}>
                    <a
                      href={file.file_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 text-xs hover:text-primary transition-colors"
                    >
                      <Paperclip className="w-3 h-3 text-muted-foreground shrink-0" />
                      <span className="truncate">{file.filename}</span>
                      <span className="text-muted-foreground shrink-0">
                        {(file.file_size / 1024).toFixed(0)}kb
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
