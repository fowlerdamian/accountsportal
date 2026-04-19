import { useState } from "react";
import { useNavigate } from "react-router-dom";
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
} from "@hub/hooks/use-hub-queries";

type ModalProjectType = "web" | "new_product" | "other";

interface NewProjectModalProps {
  open:    boolean;
  onClose: () => void;
}

export function NewProjectModal({ open, onClose }: NewProjectModalProps) {
  const navigate = useNavigate();
  const [name,          setName]          = useState("");
  const [description,   setDescription]   = useState("");
  const [type,          setType]          = useState<ModalProjectType>("web");
  const [budget,        setBudget]        = useState("");
  const [startDate,     setStartDate]     = useState("");
  const [dueDate,       setDueDate]       = useState("");
  const [priorityScore, setPriorityScore] = useState<number | null>(null);
  const [saving,        setSaving]        = useState(false);

  const { mutateAsync: createProject }      = useCreateProject();
  const { mutateAsync: createProjectStages } = useCreateProjectStages();

  function resetForm() {
    setName(""); setDescription(""); setType("web");
    setBudget(""); setStartDate(""); setDueDate(""); setPriorityScore(null);
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
        status:           "active",
        priority_score:   priorityScore,
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
      navigate(`/projects/list/${project.id}`);
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
            <div className="space-y-1.5 col-span-2">
              <Label>Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as ModalProjectType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="new_product">New Product</SelectItem>
                  <SelectItem value="web">Web</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
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
          <div className="space-y-1.5">
            <Label>Priority <span className="text-muted-foreground">(optional)</span></Label>
            <div className="flex items-center gap-1">
              {Array.from({ length: 10 }, (_, i) => i + 1).map(n => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setPriorityScore(priorityScore === n ? null : n)}
                  className={[
                    "w-7 h-7 rounded text-xs font-semibold border transition-colors",
                    priorityScore === n
                      ? n >= 8 ? "bg-green-500 text-white border-green-500"
                        : n >= 5 ? "bg-amber-500 text-white border-amber-500"
                        : "bg-red-500 text-white border-red-500"
                      : "border-border text-muted-foreground hover:bg-muted",
                  ].join(" ")}
                >
                  {n}
                </button>
              ))}
            </div>
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
