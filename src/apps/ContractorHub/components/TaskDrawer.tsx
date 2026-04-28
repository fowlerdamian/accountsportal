import { useState } from "react";
import { X, Clock, Paperclip, ChevronRight, Trash2 } from "lucide-react";
import { cn } from "@guide/lib/utils";
import { toast } from "sonner";
import { useAuth } from "@guide/contexts/AuthContext";
import {
  useTasks,
  useTimeEntries,
  useFiles,
  useUpdateTask,
  useCreateTask,
  useDeleteTask,
  usePostActivity,
  useProject,
  type Task,
} from "@hub/hooks/use-hub-queries";
import { notifyTaskStatusChanged } from "@hub/lib/notifyHubChat";
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
  const [editingDesc,   setEditingDesc]   = useState(false);
  const [descValue,     setDescValue]     = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { data: project }             = useProject(task?.project_id);
  const { data: allTasks = [] }       = useTasks(task?.project_id);
  const { data: timeEntries = [] }    = useTimeEntries({ taskId: task?.id });
  const { data: files = [] }          = useFiles({ taskId: task?.id });
  const { mutateAsync: updateTask }   = useUpdateTask();
  const { mutateAsync: createTask }   = useCreateTask();
  const { mutateAsync: deleteTask }   = useDeleteTask();
  const { mutateAsync: postActivity } = usePostActivity();

  // Use the live version from the query cache so status updates reflect immediately
  const liveTask = allTasks.find(t => t.id === task?.id) ?? task!;
  const subtasks = allTasks.filter((t) => t.parent_task_id === task?.id);

  const authorName = user?.user_metadata?.full_name
    ?? user?.email?.split("@")[0]
    ?? "Staff";

  if (!task) return null;

  async function handleStatusClick() {
    try {
      const next = nextTaskStatus(liveTask.status);
      await updateTask({ id: liveTask.id, status: next });
      if (liveTask.project_id && user) {
        await postActivity({
          project_id:  liveTask.project_id,
          task_id:     liveTask.id,
          type:        "status_change",
          content:     `${authorName} moved "${liveTask.title}" to ${next.replace("_", " ")}`,
          author_id:   user.id,
          author_name: authorName,
          metadata:    { from: liveTask.status, to: next },
        });
        notifyTaskStatusChanged({
          task_title:   liveTask.title,
          status:       next,
          author:       authorName,
          project_name: project?.name ?? "",
          project_id:   liveTask.project_id,
        });
      }
    } catch {
      toast.error("Failed to update status");
    }
  }

  async function handleDescSave() {
    try {
      await updateTask({ id: liveTask.id, description: descValue });
      setEditingDesc(false);
      toast.success("Description saved");
    } catch {
      toast.error("Failed to save description");
    }
  }

  function startEditDesc() {
    setDescValue(liveTask.description ?? "");
    setEditingDesc(true);
  }

  async function handleDelete() {
    try {
      await deleteTask({ id: liveTask.id, project_id: liveTask.project_id });
      toast.success("Task deleted");
      setConfirmDelete(false);
      onClose();
    } catch {
      toast.error("Failed to delete task");
    }
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
            <h2 className="font-semibold text-base leading-snug">{liveTask.title}</h2>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <button onClick={handleStatusClick} title="Click to advance status">
                <StatusPill status={liveTask.status} size="sm" className="cursor-pointer hover:opacity-80 transition-opacity" />
              </button>
              <PriorityPill priority={liveTask.priority} size="sm" />
              {liveTask.due_date && (
                <span className={cn(
                  "text-xs",
                  new Date(liveTask.due_date) < new Date() && liveTask.status !== "done"
                    ? "text-red-400"
                    : "text-muted-foreground"
                )}>
                  Due {liveTask.due_date}
                </span>
              )}
            </div>
          </div>
          {confirmDelete ? (
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-xs text-muted-foreground">Delete?</span>
              <button
                onClick={handleDelete}
                className="px-2 py-1 rounded text-xs bg-red-500 text-white hover:bg-red-600 transition-colors"
              >
                Yes
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="px-2 py-1 rounded text-xs border hover:bg-muted transition-colors"
              >
                No
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={() => setConfirmDelete(true)}
                className="p-1.5 rounded hover:bg-red-50 text-muted-foreground hover:text-red-500 transition-colors"
                title="Delete task"
              >
                <Trash2 className="w-4 h-4" />
              </button>
              <button
                onClick={onClose}
                className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">

          {/* Assignee */}
          {liveTask.contractors && (
            <div className="flex items-center gap-2">
              <ContractorAvatar name={liveTask.contractors.name} size="sm" />
              <span className="text-sm text-muted-foreground">{liveTask.contractors.name}</span>
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
                {liveTask.description || "Add a description..."}
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
                        {file.file_size != null ? `${(file.file_size / 1024).toFixed(0)}kb` : ""}
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
