import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@guide/components/ui/dialog";
import { Button } from "@guide/components/ui/button";
import { Input } from "@guide/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@guide/components/ui/select";
import { toast } from "sonner";
import {
  useProjects,
  useContractors,
  useCreateTask,
  type TaskPriority,
} from "@guide/hooks/use-hub-queries";

interface NewTaskModalProps {
  open:          boolean;
  onClose:       () => void;
  /** If provided, the project selector is pre-filled and hidden. */
  projectId?:    string | null;
}

export function NewTaskModal({ open, onClose, projectId }: NewTaskModalProps) {
  const [title,       setTitle]       = useState("");
  const [selProject,  setSelProject]  = useState(projectId ?? "");
  const [priority,    setPriority]    = useState<TaskPriority>("medium");
  const [assignedTo,  setAssignedTo]  = useState("");
  const [dueDate,     setDueDate]     = useState("");
  const [saving,      setSaving]      = useState(false);

  const { data: projects   = [] } = useProjects();
  const { data: contractors = [] } = useContractors();
  const { mutateAsync: createTask } = useCreateTask();

  function reset() {
    setTitle("");
    setSelProject(projectId ?? "");
    setPriority("medium");
    setAssignedTo("");
    setDueDate("");
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleSave() {
    const pid = selProject || projectId;
    if (!title.trim()) { toast.error("Task title is required"); return; }
    if (!pid)          { toast.error("Please select a project"); return; }

    setSaving(true);
    try {
      await createTask({
        project_id:  pid,
        title:       title.trim(),
        priority,
        assigned_to: assignedTo || null,
        due_date:    dueDate || null,
        status:      "backlog",
        position:    9999,
      });
      toast.success("Task created");
      handleClose();
    } catch (err: any) {
      toast.error(err.message ?? "Failed to create task");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New Task</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Title */}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Title *</label>
            <Input
              autoFocus
              placeholder="What needs to be done?"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSave()}
            />
          </div>

          {/* Project — hidden when caller already provides one */}
          {!projectId && (
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Project *</label>
              <Select value={selProject} onValueChange={setSelProject}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a project…" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Priority + Assignee row */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Priority</label>
              <Select value={priority} onValueChange={(v) => setPriority(v as TaskPriority)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Assignee</label>
              <Select value={assignedTo} onValueChange={setAssignedTo}>
                <SelectTrigger>
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Unassigned</SelectItem>
                  {contractors.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Due date */}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Due date</label>
            <Input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={handleClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Creating…" : "Create Task"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
