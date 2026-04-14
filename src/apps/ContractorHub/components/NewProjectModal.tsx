import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@guide/components/ui/dialog";
import { Button } from "@guide/components/ui/button";
import { Input } from "@guide/components/ui/input";
import { Label } from "@guide/components/ui/label";
import { Textarea } from "@guide/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@guide/components/ui/select";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  useCreateProject,
  useCreateProjectStages,
  NEW_PRODUCT_STAGES,
  type ProjectStatus,
} from "@hub/hooks/use-hub-queries";

type ModalProjectType = "web" | "new_product";

interface NewProjectModalProps {
  open:    boolean;
  onClose: () => void;
}

export function NewProjectModal({ open, onClose }: NewProjectModalProps) {
  const [name,        setName]        = useState("");
  const [description, setDescription] = useState("");
  const [type,        setType]        = useState<ModalProjectType>("web");
  const [status,      setStatus]      = useState<ProjectStatus>("planning");
  const [budget,      setBudget]      = useState("");
  const [startDate,   setStartDate]   = useState("");
  const [dueDate,     setDueDate]     = useState("");
  const [saving,      setSaving]      = useState(false);

  const { mutateAsync: createProject }      = useCreateProject();
  const { mutateAsync: createProjectStages } = useCreateProjectStages();

  function resetForm() {
    setName(""); setDescription(""); setType("web");
    setStatus("planning"); setBudget(""); setStartDate(""); setDueDate("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { toast.error("Project name is required"); return; }
    setSaving(true);
    try {
      const project = await createProject({
        name:             name.trim(),
        description:      description.trim() || null,
        type,
        status,
        budget_allocated: (type === "web" && budget) ? Number(budget) : null,
        start_date:       startDate || null,
        due_date:         (type === "web" && dueDate) ? dueDate : null,
      });

      // Auto-create stages for new product projects
      if (type === "new_product") {
        const today = new Date().toISOString().split("T")[0];
        await createProjectStages({
          projectId: project.id,
          stages: NEW_PRODUCT_STAGES.map((stageName, i) => ({
            project_id: project.id,
            name:       stageName,
            position:   i,
            start_date: i === 0 ? today : null,
            end_date:   null,
            is_active:  i === 0,
          })),
        });
      }

      toast.success("Project created");
      resetForm();
      onClose();
    } catch (err: any) {
      toast.error(err.message ?? "Failed to create project");
    } finally {
      setSaving(false);
    }
  }

  const isNewProduct = type === "new_product";

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { resetForm(); onClose(); } }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New Project</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <Label>Name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Project name" autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional overview..." rows={2} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as ModalProjectType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="web">Web</SelectItem>
                  <SelectItem value="new_product">New Product</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as ProjectStatus)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="planning">Planning</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="on_hold">On Hold</SelectItem>
                  <SelectItem value="complete">Complete</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {!isNewProduct && (
              <>
                <div className="space-y-1.5">
                  <Label>Budget ($)</Label>
                  <Input type="number" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="0" min="0" step="100" />
                </div>
                <div className="space-y-1.5">
                  <Label>Start Date</Label>
                  <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                </div>
                <div className="space-y-1.5 col-span-2">
                  <Label>Due Date</Label>
                  <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                </div>
              </>
            )}

            {isNewProduct && (
              <div className="space-y-1.5 col-span-2 rounded-md border bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground">
                  Stages will be created automatically: {NEW_PRODUCT_STAGES.join(" → ")}
                </p>
              </div>
            )}
          </div>
          <div className="flex gap-2 pt-2 justify-end">
            <Button type="button" variant="outline" onClick={() => { resetForm(); onClose(); }}>Cancel</Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Create Project
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
