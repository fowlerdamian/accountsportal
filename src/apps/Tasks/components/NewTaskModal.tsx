import { useState, useEffect } from "react";
import { Loader2, Link2, Link2Off } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@guide/components/ui/dialog";
import { Button } from "@guide/components/ui/button";
import { Input } from "@guide/components/ui/input";
import { Label } from "@guide/components/ui/label";
import { Textarea } from "@guide/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@guide/components/ui/select";
import { DatePicker } from "@portal/components/DatePicker";
import { toast } from "sonner";
import { useAuth } from "../../../context/AuthContext.jsx";
import {
  useStaffProfiles,
  useCreateStaffTask,
  useAddDependency,
  type StaffProfile,
} from "../hooks/use-task-queries";
import { ScorePicker } from "./ScorePicker";
import { DependencyPicker, emptyDependency, type DependencyDraft } from "./DependencyPicker";
import { notifyTaskAssignee } from "../lib/notifyTaskChat";

interface NewTaskModalProps {
  open:    boolean;
  onClose: () => void;
}

export function NewTaskModal({ open, onClose }: NewTaskModalProps) {
  const { user } = useAuth();
  const userId  = user?.id ?? "";
  const myName  = user?.user_metadata?.full_name ?? user?.email?.split("@")[0] ?? "Someone";

  const [title,        setTitle]        = useState("");
  const [description,  setDescription]  = useState("");
  const [assignedTo,   setAssignedTo]   = useState(userId);
  const [dueDate,      setDueDate]      = useState("");
  const [urgency,      setUrgency]      = useState<number | null>(null);
  const [importance,   setImportance]   = useState<number | null>(null);
  const [withDep,      setWithDep]      = useState(false);
  const [dep,          setDep]          = useState<DependencyDraft>(emptyDependency());
  const [saving,       setSaving]       = useState(false);

  const { data: profiles = [] }            = useStaffProfiles();
  const { mutateAsync: createStaffTask }   = useCreateStaffTask();
  const { mutateAsync: addDependency }     = useAddDependency();

  // Default the assignee to the signed-in user whenever the modal opens.
  // `useState(userId)` only seeds on first mount; if user wasn't ready then
  // (or the user picked someone else last time the modal was open), this
  // syncs the picker back to "me" on each fresh open.
  useEffect(() => {
    if (open && userId) setAssignedTo(userId);
  }, [open, userId]);

  function reset() {
    setTitle(""); setDescription(""); setAssignedTo(userId); setDueDate("");
    setUrgency(null); setImportance(null);
    setWithDep(false); setDep(emptyDependency());
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleSave() {
    if (!title.trim())   { toast.error("Title is required"); return; }
    if (!assignedTo)     { toast.error("Pick an assignee"); return; }
    if (!userId)         { toast.error("Not signed in"); return; }
    if (withDep) {
      if (!dep.title.trim())  { toast.error("Describe what you need"); return; }
      if (!dep.assigned_to)   { toast.error("Pick who to wait on"); return; }
    }

    setSaving(true);
    try {
      const parent = await createStaffTask({
        title:        title.trim(),
        description:  description.trim() || null,
        assigned_to:  assignedTo,
        created_by:   userId,
        due_date:     dueDate || null,
        urgency:      urgency,
        importance:   importance,
        status:       "not_started",
      });

      if (withDep) {
        const depTask = await addDependency({
          parent_task_id:  parent.id,
          parent_due_date: parent.due_date,
          title:           dep.title.trim(),
          description:     dep.description.trim() || null,
          assigned_to:     dep.assigned_to,
          created_by:      userId,
          due_date:        dep.due_date || null,
          urgency:         dep.urgency ?? urgency,
          importance:      dep.importance ?? importance,
        });
        notifyTaskAssignee({
          task_id:      depTask.id,
          recipient_id: dep.assigned_to,
          event:        "dependency_assigned",
          task_title:   dep.title.trim(),
          actor_name:   myName,
        });
      } else if (assignedTo !== userId) {
        notifyTaskAssignee({
          task_id:      parent.id,
          recipient_id: assignedTo,
          event:        "assigned",
          task_title:   title.trim(),
          actor_name:   myName,
        });
      }

      toast.success(withDep ? "Task created and dependency assigned" : "Task created");
      handleClose();
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to create task");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New Task</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2 max-h-[70vh] overflow-y-auto pr-1">
          {/* Title */}
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Title *</Label>
            <Input
              autoFocus
              placeholder="What needs to be done?"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && !saving && handleSave()}
            />
          </div>

          {/* Description */}
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Description</Label>
            <Textarea
              placeholder="Optional details, links, context…"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {/* Assignee + Due date */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Assignee *</Label>
              <Select value={assignedTo} onValueChange={setAssignedTo}>
                <SelectTrigger><SelectValue placeholder="Pick a person…" /></SelectTrigger>
                <SelectContent>
                  {profiles.map((p: StaffProfile) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.id === userId ? "Me" : (p.full_name ?? p.email ?? p.id.slice(0, 8))}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Due date</Label>
              <DatePicker value={dueDate || null} onChange={(v) => setDueDate(v ?? "")} />
            </div>
          </div>

          {/* Score */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Priority score (Eisenhower)</Label>
            <ScorePicker
              urgency={urgency}
              importance={importance}
              onUrgency={setUrgency}
              onImportance={setImportance}
            />
          </div>

          {/* Dependency toggle — clearing state on toggle-off avoids zombie
              values reappearing if the user toggles back on. */}
          <div>
            <button
              type="button"
              onClick={() => {
                setWithDep((v) => {
                  if (v) setDep(emptyDependency());
                  return !v;
                });
              }}
              className="flex items-center gap-2 text-xs font-medium text-amber-400 hover:text-amber-300 transition-colors"
            >
              {withDep ? <Link2Off className="w-3.5 h-3.5" /> : <Link2 className="w-3.5 h-3.5" />}
              {withDep ? "Remove dependency" : "Waiting on someone first?"}
            </button>
          </div>

          {withDep && (
            <DependencyPicker
              value={dep}
              onChange={setDep}
              parentDue={dueDate || null}
              excludeUser={userId}
            />
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t">
          <Button variant="outline" onClick={handleClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {withDep ? "Create + Assign Dependency" : "Create Task"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
