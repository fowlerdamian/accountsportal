import { useState } from "react";
import { Button } from "@guide/components/ui/button";
import { Input } from "@guide/components/ui/input";
import { Label } from "@guide/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@guide/components/ui/select";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@guide/contexts/AuthContext";
import { useLogTime, usePostActivity, useContractors } from "@guide/hooks/use-hub-queries";

interface LogTimeFormProps {
  projectId:     string;
  taskId?:       string;
  contractorId?: string; // pre-set for contractor users; shown as dropdown for staff
  onClose:       () => void;
}

export function LogTimeForm({ projectId, taskId, contractorId: presetId, onClose }: LogTimeFormProps) {
  const { user } = useAuth();
  const today    = new Date().toISOString().split("T")[0];

  const [hours,       setHours]       = useState("1");
  const [date,        setDate]        = useState(today);
  const [description, setDescription] = useState("");
  const [selectedCid, setSelectedCid] = useState(presetId ?? "");
  const [saving,      setSaving]      = useState(false);

  const { data: contractors = [] }   = useContractors();
  const { mutateAsync: logTime }     = useLogTime();
  const { mutateAsync: postActivity } = usePostActivity();

  const authorName = user?.user_metadata?.full_name ?? user?.email?.split("@")[0] ?? "Staff";
  const isPreset   = !!presetId;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const h = parseFloat(hours);
    if (!selectedCid) { toast.error("Select a contractor"); return; }
    if (isNaN(h) || h < 0.25 || h > 24) { toast.error("Hours must be between 0.25 and 24"); return; }

    setSaving(true);
    try {
      const entry = await logTime({
        contractor_id: selectedCid,
        project_id:    projectId,
        task_id:       taskId ?? null,
        hours:         h,
        date,
        description:   description.trim() || undefined,
      });

      const contractor = contractors.find((c) => c.id === selectedCid);
      if (user) {
        await postActivity({
          project_id:  projectId,
          task_id:     taskId ?? null,
          type:        "time_log",
          content:     `${contractor?.name ?? "Contractor"} logged ${h} hrs${taskId ? " on task" : ""}`,
          author_id:   user.id,
          author_name: authorName,
          metadata:    { hours: h, contractor_id: selectedCid },
        });
      }

      toast.success(`Logged ${h} hrs`);
      onClose();
    } catch (err: any) {
      toast.error(err.message ?? "Failed to log time");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border bg-muted/20 p-4 space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Log Time</p>
      <div className="grid grid-cols-2 gap-3">
        {!isPreset && (
          <div className="space-y-1 col-span-2">
            <Label className="text-xs">Contractor</Label>
            <Select value={selectedCid} onValueChange={setSelectedCid}>
              <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select..." /></SelectTrigger>
              <SelectContent>
                {contractors.filter((c) => c.status === "active").map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="space-y-1">
          <Label className="text-xs">Hours</Label>
          <Input
            type="number"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            min="0.25" max="24" step="0.25"
            className="h-8 text-sm"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Date</Label>
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="h-8 text-sm"
          />
        </div>
        <div className="space-y-1 col-span-2">
          <Label className="text-xs">Description (optional)</Label>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What was worked on..."
            className="h-8 text-sm"
          />
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
        <Button type="submit" size="sm" disabled={saving}>
          {saving && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
          Log Time
        </Button>
      </div>
    </form>
  );
}
