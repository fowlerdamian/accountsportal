import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@guide/components/ui/dialog";
import { Button } from "@guide/components/ui/button";
import { toast } from "sonner";
import { useAuth } from "../../../context/AuthContext.jsx";
import {
  useStaffProfiles,
  useStaffTask,
  useUpdateStaffTask,
} from "../hooks/use-task-queries";
import { notifyTaskAssignee } from "../lib/notifyTaskChat";
import { QuadrantPill } from "./QuadrantPill";
import { UserAvatar } from "./UserAvatar";

// Global popup fired whenever a task lands in the Delegate quadrant
// (portal:delegate-prompt event from use-task-queries). Delegate = urgent
// but not important — the whole point of the quadrant is that someone else
// should do it, so ask who straight away. Mounted once next to TaskDock.

export function DelegatePromptDialog() {
  const { user } = useAuth();
  const userId   = user?.id ?? "";
  const myName   = user?.user_metadata?.full_name ?? user?.email?.split("@")[0] ?? "Someone";

  const [taskId, setTaskId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const handler = (e: Event) => {
      const id = (e as CustomEvent<{ taskId?: string }>).detail?.taskId;
      if (id) setTaskId(id);
    };
    window.addEventListener("portal:delegate-prompt", handler);
    return () => window.removeEventListener("portal:delegate-prompt", handler);
  }, []);

  const { data: task }          = useStaffTask(taskId ?? undefined);
  const { data: profiles = [] } = useStaffProfiles();
  const { mutateAsync: updateTask } = useUpdateStaffTask();

  const candidates = profiles.filter((p) => p.id !== task?.assigned_to);
  const currentName =
    profiles.find((p) => p.id === task?.assigned_to)?.full_name ?? "the current assignee";

  async function delegateTo(recipientId: string) {
    if (!task || saving) return;
    setSaving(true);
    try {
      await updateTask({ id: task.id, assigned_to: recipientId });
      const recipient = profiles.find((p) => p.id === recipientId);
      toast.success(`Delegated to ${recipient?.full_name ?? recipient?.email ?? "them"}`);
      if (recipientId !== userId) {
        notifyTaskAssignee({
          task_id:      task.id,
          recipient_id: recipientId,
          event:        "assigned",
          task_title:   task.title,
          actor_name:   myName,
        });
      }
      setTaskId(null);
    } catch {
      toast.error("Failed to reassign task");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={taskId !== null} onOpenChange={(open) => { if (!open) setTaskId(null); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <QuadrantPill quadrant="delegate" size="sm" />
            This is a delegate task
          </DialogTitle>
          <DialogDescription>
            {task ? <span className="font-medium text-foreground">“{task.title}”</span> : "This task"}
            {" "}is urgent but not important — exactly what the Delegate quadrant is for.
            Who should it be delegated to?
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1 max-h-[40vh] overflow-y-auto">
          {candidates.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2">No one else to delegate to.</p>
          ) : (
            candidates.map((p) => (
              <button
                key={p.id}
                disabled={saving}
                onClick={() => delegateTo(p.id)}
                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md border border-transparent hover:border-border hover:bg-muted/50 transition-colors text-left disabled:opacity-50"
              >
                <UserAvatar name={p.full_name ?? p.email ?? "?"} size="xs" />
                <span className="text-sm">{p.full_name ?? p.email}</span>
                {saving && <Loader2 className="w-3.5 h-3.5 animate-spin ml-auto" />}
              </button>
            ))
          )}
        </div>

        <Button variant="outline" size="sm" disabled={saving} onClick={() => setTaskId(null)}>
          Keep it with {task?.assigned_to === userId ? "me" : currentName}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
