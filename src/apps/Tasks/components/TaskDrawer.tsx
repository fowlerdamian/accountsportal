import { useState, useMemo, useEffect, useRef } from "react";
import { X, Trash2, AlertTriangle, Link2, Send, Loader2 } from "lucide-react";
import { cn } from "@guide/lib/utils";
import { Button } from "@guide/components/ui/button";
import { Textarea } from "@guide/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@guide/components/ui/select";
import { toast } from "sonner";
import { useAuth } from "../../../context/AuthContext.jsx";
import {
  useStaffTask,
  useStaffTasks,
  useUpdateStaffTask,
  useDeleteStaffTask,
  useAddDependency,
  useStaffProfiles,
  useThreadComments,
  useAddTaskComment,
  type StaffTask,
  type StaffTaskStatus,
} from "../hooks/use-task-queries";
import { quadrantOf, QUADRANT_LABEL } from "../lib/eisenhower";
import { dueRingClass, formatDueChip, QUADRANT_DOT_CLASS } from "../lib/color";
import { StatusPill } from "@hub/components/StatusPill";

// All four stages a task can be in — used by the stage selector.
const STAGES: { key: StaffTaskStatus; label: string }[] = [
  { key: "not_started", label: "Not Started" },
  { key: "in_progress", label: "In Progress" },
  { key: "blocked",     label: "Blocked"     },
  { key: "done",        label: "Done"        },
];
import { QuadrantPill } from "./QuadrantPill";
import { ScorePicker } from "./ScorePicker";
import { UserAvatar } from "./UserAvatar";
import { DependencyPicker, emptyDependency, type DependencyDraft } from "./DependencyPicker";
import { MentionTextarea, CommentBody } from "./MentionTextarea";
import { notifyTaskAssignee } from "../lib/notifyTaskChat";
import { processMentions } from "../../../utils/mentionTasks";

interface TaskDrawerProps {
  taskId: string | null;
  open:   boolean;
  onClose: () => void;
}

function nameFor(profiles: { id: string; full_name: string | null; email: string | null }[], id: string, selfId?: string): string {
  if (id === selfId) return "Me";
  const p = profiles.find((x) => x.id === id);
  return p?.full_name ?? p?.email ?? id.slice(0, 8);
}

export function TaskDrawer({ taskId, open, onClose }: TaskDrawerProps) {
  const { user } = useAuth();
  const userId   = user?.id ?? "";
  const myName   = user?.user_metadata?.full_name ?? user?.email?.split("@")[0] ?? "Someone";

  const { data: task }              = useStaffTask(taskId ?? undefined);
  const { data: allTasks = [] }     = useStaffTasks({});
  const { data: profiles = [] }     = useStaffProfiles();
  const { mutateAsync: updateTask } = useUpdateStaffTask();
  const { mutateAsync: deleteTask } = useDeleteStaffTask();
  const { mutateAsync: addDependency } = useAddDependency();
  const { mutateAsync: addComment } = useAddTaskComment();

  const [editingDesc,   setEditingDesc]   = useState(false);
  const [descValue,     setDescValue]     = useState("");
  const [editingScore,  setEditingScore]  = useState(false);
  const [scratchUrg,    setScratchUrg]    = useState<number | null>(null);
  const [scratchImp,    setScratchImp]    = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [addDepOpen,    setAddDepOpen]    = useState(false);
  const [depDraft,      setDepDraft]      = useState<DependencyDraft>(emptyDependency());
  const [savingDep,     setSavingDep]     = useState(false);
  const [commentBody,   setCommentBody]   = useState("");
  const [commentMentions, setCommentMentions] = useState<string[]>([]);
  const [postingComment, setPostingComment] = useState(false);
  // Local working copy of status_notes so typing doesn't fire a DB update on every keystroke.
  const [notesDraft,    setNotesDraft]    = useState<string>("");
  const [notesDirty,    setNotesDirty]    = useState(false);

  // Pull the live row from the list cache so status flips reflect instantly.
  const liveTask: StaffTask | undefined = useMemo(
    () => allTasks.find((t) => t.id === taskId) ?? task,
    [allTasks, task, taskId],
  );

  const blocker = useMemo(
    () => liveTask?.blocked_by_task_id ? allTasks.find((t) => t.id === liveTask.blocked_by_task_id) : null,
    [allTasks, liveTask],
  );

  const dependencies = useMemo(
    () => liveTask ? allTasks.filter((t) => t.parent_task_id === liveTask.id) : [],
    [allTasks, liveTask],
  );

  // The whole dependency "family" — the root task plus every dependency under
  // it. Comments are pulled across all of them so a comment left on a
  // dependency surfaces on the original/parent task (and vice-versa).
  const familyIds = useMemo(() => {
    if (!liveTask) return [] as string[];
    const rootId = liveTask.parent_task_id ?? liveTask.id;
    const ids = new Set<string>([rootId, liveTask.id]);
    for (const t of allTasks) if (t.parent_task_id === rootId) ids.add(t.id);
    return Array.from(ids);
  }, [allTasks, liveTask]);

  const { data: comments = [] } = useThreadComments(familyIds);

  // Title lookup so cross-task comments can be labelled with their source task.
  const titleById = useMemo(
    () => Object.fromEntries(allTasks.map((t) => [t.id, t.title] as const)),
    [allTasks],
  );

  // Notes draft lifecycle. The draft is OWNED by one task id at a time:
  //  - switching to a different task always reloads the draft from that task's
  //    row (dropping any unsaved draft from the previous task — never carry a
  //    draft across tasks, it would save under the wrong row);
  //  - while on the same task, server refreshes only sync in when the user
  //    hasn't touched the field (preserves in-flight edits).
  // MUST sit before the early return below — hook order must stay stable.
  const draftOwnerRef = useRef<string | null>(null);
  useEffect(() => {
    if (!taskId || !liveTask || liveTask.id !== taskId) return;
    if (draftOwnerRef.current !== taskId) {
      draftOwnerRef.current = taskId;
      setNotesDirty(false);
      setNotesDraft(liveTask.status_notes ?? "");
      return;
    }
    if (!notesDirty) setNotesDraft(liveTask.status_notes ?? "");
  }, [taskId, liveTask?.id, liveTask?.status_notes, notesDirty]);

  // Autosave: persist the note ~1.2s after the user stops typing (blur and the
  // Save button also save). The timer is cancelled if the draft changes again,
  // the task switches, or the drawer unmounts.
  useEffect(() => {
    if (!notesDirty) return;
    const id = setTimeout(() => { void saveStatusNotes(); }, 1200);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notesDraft, notesDirty]);

  if (!taskId || !liveTask) {
    return open ? (
      <div className="fixed inset-0 z-30 bg-black/30" onClick={onClose} />
    ) : null;
  }

  const quad        = quadrantOf(liveTask.urgency, liveTask.importance);
  const unscored    = liveTask.urgency == null || liveTask.importance == null;
  const isAssignee  = liveTask.assigned_to === userId;
  const isCreator   = liveTask.created_by  === userId;
  const canMutate   = isAssignee || isCreator;

  async function setStage(next: StaffTaskStatus) {
    if (!liveTask || !canMutate || next === liveTask.status) return;
    try {
      await updateTask({ id: liveTask.id, status: next });
    } catch {
      toast.error("Failed to update stage");
    }
  }

  async function handleReassign(next: string) {
    if (!liveTask || !canMutate || next === liveTask.assigned_to) return;
    try {
      await updateTask({ id: liveTask.id, assigned_to: next });
      toast.success(`Assigned to ${nameFor(profiles, next, userId)}`);
      // Ping the new assignee via their Google Chat webhook — skip self.
      if (next !== userId) {
        notifyTaskAssignee({
          task_id:      liveTask.id,
          recipient_id: next,
          event:        "assigned",
          task_title:   liveTask.title,
          actor_name:   myName,
        });
      }
    } catch {
      toast.error("Failed to reassign");
    }
  }

  async function saveStatusNotes() {
    if (!liveTask || !canMutate || !notesDirty) return;
    const next = notesDraft.trim() || null;
    if (next === (liveTask.status_notes ?? null)) {
      setNotesDirty(false);
      return;
    }
    try {
      await updateTask({ id: liveTask.id, status_notes: next });
      setNotesDirty(false);
    } catch {
      toast.error("Failed to save stage notes");
    }
  }

  async function handleDescSave() {
    if (!liveTask) return;
    try {
      await updateTask({ id: liveTask.id, description: descValue });
      setEditingDesc(false);
      toast.success("Saved");
    } catch {
      toast.error("Failed to save");
    }
  }

  function startEditDesc() {
    setDescValue(liveTask?.description ?? "");
    setEditingDesc(true);
  }

  function startEditScore() {
    setScratchUrg(liveTask?.urgency ?? null);
    setScratchImp(liveTask?.importance ?? null);
    setEditingScore(true);
  }

  async function handleScoreSave() {
    if (!liveTask) return;
    try {
      await updateTask({ id: liveTask.id, urgency: scratchUrg, importance: scratchImp });
      setEditingScore(false);
      toast.success("Score updated");
    } catch {
      toast.error("Failed to save");
    }
  }

  async function handleDelete() {
    if (!liveTask) return;
    try {
      await deleteTask(liveTask.id);
      toast.success("Task deleted");
      setConfirmDelete(false);
      onClose();
    } catch {
      toast.error("Failed to delete");
    }
  }

  async function handleSaveDependency() {
    if (!liveTask) return;
    if (!depDraft.title.trim())  { toast.error("Describe what you need"); return; }
    if (!depDraft.assigned_to)   { toast.error("Pick who to wait on"); return; }
    setSavingDep(true);
    try {
      const dep = await addDependency({
        parent_task_id:  liveTask.id,
        parent_due_date: liveTask.due_date,
        title:           depDraft.title.trim(),
        description:     depDraft.description.trim() || null,
        assigned_to:     depDraft.assigned_to,
        created_by:      userId,
        due_date:        depDraft.due_date || null,
        urgency:         depDraft.urgency ?? liveTask.urgency,
        importance:      depDraft.importance ?? liveTask.importance,
      });
      notifyTaskAssignee({
        task_id:      dep.id,
        recipient_id: depDraft.assigned_to,
        event:        "dependency_assigned",
        task_title:   depDraft.title.trim(),
        actor_name:   myName,
      });
      toast.success("Dependency created");
      setAddDepOpen(false);
      setDepDraft(emptyDependency());
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to add dependency");
    } finally {
      setSavingDep(false);
    }
  }

  async function handlePostComment() {
    if (!liveTask || !commentBody.trim() || !userId) return;
    const body     = commentBody.trim();
    // Only keep mentions whose @-name is still present in the body (handles
    // backspace-after-insert cases).
    const stillMentioned = commentMentions.filter((id) => {
      const p = profiles.find((x) => x.id === id);
      if (!p) return false;
      const name = p.id === userId ? "Me" : (p.full_name ?? p.email ?? "");
      return name && body.includes(`@${name}`);
    });

    setPostingComment(true);
    try {
      await addComment({ task_id: liveTask.id, author_id: userId, body, mentions: stillMentioned });
      // Ping every mentioned profile via their personal Google Chat webhook.
      // Skip self-mentions.
      for (const recipientId of stillMentioned) {
        if (recipientId === userId) continue;
        notifyTaskAssignee({
          task_id:      liveTask.id,
          recipient_id: recipientId,
          event:        "comment",
          task_title:   liveTask.title,
          actor_name:   myName,
          comment_body: body,
        });
      }
      // Universal @mention → staff task pipeline (fire-and-forget). Runs on
      // top of the comment ping above — the mentioned person also gets a task
      // with context pulled from this comment and the screen.
      processMentions(body, {
        label: `Comment on task "${liveTask.title}"`,
        url:   `/tasks?task=${liveTask.id}`,
      }).then((created) => {
        for (const t of created) toast.success(`Task created for ${t.assignee}: ${t.title}`);
      });

      setCommentBody("");
      setCommentMentions([]);
    } catch {
      toast.error("Failed to post comment");
    } finally {
      setPostingComment(false);
    }
  }

  return (
    <>
      {/* Backdrop — also flushes any dirty status_notes so the user
          doesn't lose unsaved text by clicking away. */}
      {open && <div className="fixed inset-0 z-30 bg-black/30" onClick={() => { saveStatusNotes(); onClose(); }} />}

      <div
        className={cn(
          "fixed top-0 right-0 h-full z-40",
          "w-full sm:w-[460px]",
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
              <StatusPill status={liveTask.status} staff size="sm" />
              <QuadrantPill quadrant={quad} size="sm" />
              {liveTask.due_date && (
                <span className={cn(
                  "text-xs px-1.5 py-0.5 rounded",
                  dueRingClass(liveTask.due_date),
                  new Date(liveTask.due_date) < new Date(new Date().setHours(0, 0, 0, 0)) && liveTask.status !== "done"
                    ? "text-red-400"
                    : "text-muted-foreground",
                )}>
                  Due {liveTask.due_date} <span className="opacity-70">· {formatDueChip(liveTask.due_date)}</span>
                </span>
              )}
            </div>
          </div>

          {confirmDelete ? (
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-xs text-muted-foreground">Delete?</span>
              <button onClick={handleDelete}
                className="px-2 py-1 rounded text-xs bg-red-500 text-white hover:bg-red-600 transition-colors">Yes</button>
              <button onClick={() => setConfirmDelete(false)}
                className="px-2 py-1 rounded text-xs border hover:bg-muted transition-colors">No</button>
            </div>
          ) : (
            <div className="flex items-center gap-1 shrink-0">
              {isCreator && (
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="p-1.5 rounded hover:bg-red-50 text-muted-foreground hover:text-red-500 transition-colors"
                  title="Delete task"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
              <button onClick={() => { saveStatusNotes(); onClose(); }}
                className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {/* Scoring banner if unscored */}
        {unscored && canMutate && !editingScore && (
          <button
            onClick={startEditScore}
            className="mx-5 mt-3 flex items-center gap-2 rounded-md border border-amber-800/40 bg-amber-950/30 px-3 py-2 text-xs text-amber-200 hover:bg-amber-950/50 transition-colors"
          >
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            Score this task — sets its place on the Eisenhower matrix and in the dock.
          </button>
        )}

        {/* Blocked-by chip — only while still blocked. Once the blocker is
            marked Done the DB trigger flips this task back to 'not_started',
            so the chip must clear too (otherwise it looks like unblock failed). */}
        {liveTask.status === "blocked" && liveTask.blocked_by_task_id && blocker && (
          <div className="mx-5 mt-3 flex items-start gap-2 rounded-md border border-amber-800/40 bg-amber-950/20 px-3 py-2">
            <Link2 className="w-3.5 h-3.5 text-amber-300 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0 text-xs">
              <div className="text-amber-200 font-medium truncate">Blocked by: {blocker.title}</div>
              <div className="text-muted-foreground mt-0.5">
                Auto-unblocks when that task is marked Done.
              </div>
            </div>
            <StatusPill status={blocker.status} staff size="sm" />
          </div>
        )}

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">

          {/* Assignee / Creator */}
          <div className="flex items-center gap-4 text-sm">
            <div className="flex items-center gap-2 min-w-0">
              <UserAvatar name={nameFor(profiles, liveTask.assigned_to, userId)} size="sm" />
              <div className="leading-tight min-w-0">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Assigned</div>
                {canMutate ? (
                  <Select value={liveTask.assigned_to} onValueChange={handleReassign}>
                    <SelectTrigger className="h-6 px-1.5 py-0 -ml-1.5 border-none bg-transparent text-sm text-foreground/90 hover:bg-muted/50 focus:ring-0 shadow-none gap-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {profiles.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.id === userId ? "Me" : (p.full_name ?? p.email ?? p.id.slice(0, 8))}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="text-foreground/90">{nameFor(profiles, liveTask.assigned_to, userId)}</div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 ml-auto shrink-0">
              <div className="text-right leading-tight">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Created by</div>
                <div className="text-foreground/70 text-xs">{nameFor(profiles, liveTask.created_by, userId)}</div>
              </div>
            </div>
          </div>

          {/* Stage — four-button selector + notes-on-current-stage textarea */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Stage
            </h3>
            <div className="grid grid-cols-4 gap-1">
              {STAGES.map((s) => {
                const active = s.key === liveTask.status;
                return (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => setStage(s.key)}
                    disabled={!canMutate}
                    className={cn(
                      "px-2 py-1.5 rounded text-[11px] font-medium border transition-colors",
                      active
                        ? s.key === "not_started" ? "bg-muted text-foreground border-border"
                        : s.key === "in_progress" ? "bg-blue-900/40 text-blue-300 border-blue-800/40"
                        : s.key === "blocked"     ? "bg-amber-900/40 text-amber-300 border-amber-800/40"
                        :                            "bg-green-900/40 text-green-300 border-green-800/40"
                        : "text-muted-foreground border-transparent hover:bg-muted/50 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50",
                    )}
                  >
                    {s.label}
                  </button>
                );
              })}
            </div>

            <div className="mt-3">
              <label className="text-[10px] uppercase tracking-wide text-muted-foreground/80 font-medium">
                Notes on current stage
              </label>
              <Textarea
                value={notesDraft}
                onChange={(e) => { setNotesDraft(e.target.value); setNotesDirty(true); }}
                onBlur={saveStatusNotes}
                placeholder={canMutate ? "e.g. waiting on supplier reply, sign-off pending, etc." : "—"}
                rows={2}
                disabled={!canMutate}
                className="resize-none text-sm mt-1"
              />
              {notesDirty && (
                <div className="flex items-center justify-between mt-1">
                  <p className="text-[10px] text-muted-foreground/70">Unsaved — autosaves as you type</p>
                  <button
                    type="button"
                    onClick={() => void saveStatusNotes()}
                    className="text-[10px] font-medium text-primary hover:underline"
                  >
                    Save note
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Description */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Description
            </h3>
            {editingDesc ? (
              <div className="space-y-2">
                <Textarea
                  value={descValue}
                  onChange={(e) => setDescValue(e.target.value)}
                  rows={5}
                  autoFocus
                  className="resize-none"
                />
                <div className="flex gap-2">
                  <button onClick={handleDescSave}
                    className="px-3 py-1.5 rounded text-xs bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">Save</button>
                  <button onClick={() => setEditingDesc(false)}
                    className="px-3 py-1.5 rounded text-xs hover:bg-muted transition-colors text-muted-foreground">Cancel</button>
                </div>
              </div>
            ) : (
              <button
                onClick={canMutate ? startEditDesc : undefined}
                disabled={!canMutate}
                className={cn(
                  "w-full text-left rounded-lg px-3 py-2.5 text-sm min-h-[60px]",
                  "border border-dashed border-border/50",
                  canMutate && "hover:border-border text-muted-foreground hover:text-foreground transition-colors",
                  !canMutate && "text-muted-foreground cursor-default",
                )}
              >
                {liveTask.description || (canMutate ? "Add a description…" : "—")}
              </button>
            )}
          </div>

          {/* Score */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Score</h3>
              {canMutate && !editingScore && (
                <button
                  onClick={startEditScore}
                  className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  Edit
                </button>
              )}
            </div>
            {editingScore ? (
              <div className="space-y-2">
                <ScorePicker
                  urgency={scratchUrg}
                  importance={scratchImp}
                  onUrgency={setScratchUrg}
                  onImportance={setScratchImp}
                />
                <div className="flex gap-2">
                  <Button size="sm" onClick={handleScoreSave}>Save</Button>
                  <Button size="sm" variant="outline" onClick={() => setEditingScore(false)}>Cancel</Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3 text-sm">
                <span className={cn("w-2 h-2 rounded-full", QUADRANT_DOT_CLASS[quad])} />
                <span className="text-foreground/90">{QUADRANT_LABEL[quad]}</span>
                <span className="font-mono tabular-nums text-muted-foreground">
                  U {liveTask.urgency ?? "—"} × I {liveTask.importance ?? "—"}
                </span>
              </div>
            )}
          </div>

          {/* Dependencies */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Dependencies ({dependencies.length})
              </h3>
              {canMutate && !addDepOpen && (
                <button
                  onClick={() => setAddDepOpen(true)}
                  className="text-[11px] text-amber-400 hover:text-amber-300 transition-colors"
                >
                  + Add dependency
                </button>
              )}
            </div>

            {dependencies.length === 0 && !addDepOpen ? (
              <p className="text-xs text-muted-foreground/60">No dependencies</p>
            ) : (
              <ul className="space-y-1">
                {dependencies.map((d) => (
                  <li key={d.id} className="flex items-center gap-2 py-1 text-sm">
                    <Link2 className="w-3 h-3 text-muted-foreground shrink-0" />
                    <span className={cn(
                      "flex-1 truncate",
                      d.status === "done" && "line-through text-muted-foreground",
                    )}>
                      {d.title}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {nameFor(profiles, d.assigned_to, userId)}
                    </span>
                    <StatusPill status={d.status} staff size="sm" />
                  </li>
                ))}
              </ul>
            )}

            {addDepOpen && (
              <div className="mt-3 space-y-3">
                <DependencyPicker
                  value={depDraft}
                  onChange={setDepDraft}
                  parentDue={liveTask.due_date}
                  excludeUser={userId}
                />
                <div className="flex gap-2">
                  <Button size="sm" onClick={handleSaveDependency} disabled={savingDep}>
                    {savingDep && <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />}
                    Create
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => { setAddDepOpen(false); setDepDraft(emptyDependency()); }}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* Comments */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Comments ({comments.length})
            </h3>
            {comments.length === 0 ? (
              <p className="text-xs text-muted-foreground/60">No comments yet</p>
            ) : (
              <ul className="space-y-2.5 mb-3">
                {comments.map((c) => {
                  // Comments carried over from a related task in the dependency
                  // family — label which task they were posted on.
                  const fromOther = c.task_id !== liveTask.id;
                  return (
                  <li key={c.id} className="flex gap-2 text-sm">
                    <UserAvatar name={nameFor(profiles, c.author_id, userId)} size="xs" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium">{nameFor(profiles, c.author_id, userId)}</span>
                        <span className="text-[10px] text-muted-foreground">{c.created_at.slice(0, 10)}</span>
                      </div>
                      {fromOther && (
                        <div className="flex items-center gap-1 text-[10px] text-amber-400/80 mt-0.5">
                          <Link2 className="w-2.5 h-2.5 shrink-0" />
                          <span className="truncate">on: {titleById[c.task_id] ?? "related task"}</span>
                        </div>
                      )}
                      <CommentBody body={c.body} />
                    </div>
                  </li>
                  );
                })}
              </ul>
            )}

            <div className="flex items-end gap-2">
              <div className="flex-1 min-w-0">
                <MentionTextarea
                  value={commentBody}
                  onChange={setCommentBody}
                  mentionIds={commentMentions}
                  onMentionIds={setCommentMentions}
                  profiles={profiles}
                  selfId={userId}
                  placeholder="Add a comment… type @ to mention someone"
                  rows={2}
                />
                <p className="text-[10px] text-muted-foreground/70 mt-1">
                  Type <span className="font-mono">@</span> to mention — they'll get a Google Chat ping with this comment.
                </p>
              </div>
              <Button
                size="sm"
                onClick={handlePostComment}
                disabled={!commentBody.trim() || postingComment}
              >
                {postingComment ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
