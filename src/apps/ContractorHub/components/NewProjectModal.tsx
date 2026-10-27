import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@guide/components/ui/dialog";
import { Button } from "@guide/components/ui/button";
import { Input } from "@guide/components/ui/input";
import { Label } from "@guide/components/ui/label";
import { Textarea } from "@guide/components/ui/textarea";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import {
  useCreateProject,
  useCreateProjectStages,
  NEW_PRODUCT_STAGES,
} from "@hub/hooks/use-hub-queries";
import { PriorityScorecardModal } from "@hub/components/PriorityScorecardModal";
import { localToday } from "@portal/lib/dates";

// R&D is strictly new products: every project is new_product with the stage pipeline.

interface NewProjectModalProps {
  open:    boolean;
  onClose: () => void;
}

export function NewProjectModal({ open, onClose }: NewProjectModalProps) {
  const navigate = useNavigate();
  const [name,          setName]          = useState("");
  const [description,   setDescription]   = useState("");
  const [priorityScore,  setPriorityScore]  = useState<number | null>(null);
  const [scorecardOpen,  setScorecardOpen]  = useState(false);
  const [saving,         setSaving]         = useState(false);

  const { mutateAsync: createProject }      = useCreateProject();
  const { mutateAsync: createProjectStages } = useCreateProjectStages();

  function resetForm() {
    setName(""); setDescription(""); setPriorityScore(null); setScorecardOpen(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { toast.error("Project name is required"); return; }
    setSaving(true);
    try {
      const project = await createProject({
        name:             name.trim(),
        description:      description.trim() || null,
        type:             "new_product",
        status:           "active",
        priority_score:   priorityScore,
        budget_allocated: null,
        start_date:       null,
        due_date:         null,
      });

      // Every project gets the product stage pipeline
      {
        const today = localToday();
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

  return (
    <>
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
          <div className="rounded-md border bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground">
              Stages will be created automatically: {NEW_PRODUCT_STAGES.join(" → ")}
            </p>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>Priority <span className="text-muted-foreground">(optional)</span></Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs px-2 gap-1"
                onClick={() => setScorecardOpen(true)}
              >
                <Sparkles className="w-3 h-3" />
                {priorityScore !== null ? "Re-score" : "Score it"}
              </Button>
            </div>
            <div className="flex items-center gap-1">
              {Array.from({ length: 10 }, (_, i) => i + 1).map(n => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setPriorityScore(priorityScore === n ? null : n)}
                  className={[
                    "w-7 h-7 rounded text-xs font-semibold border transition-colors",
                    priorityScore === n
                      ? n >= 8 ? "bg-[var(--brand-aqua)] text-white border-[var(--brand-aqua)]"
                        : n >= 5 ? "bg-[var(--brand-orange)] text-white border-[var(--brand-orange)]"
                        : "bg-[var(--brand-pink)] text-white border-[var(--brand-pink)]"
                      : "border-border text-muted-foreground hover:bg-muted",
                  ].join(" ")}
                >
                  {n}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">Use the scorecard for a guided score, or pick manually above.</p>
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

    <PriorityScorecardModal
      open={scorecardOpen}
      onClose={() => setScorecardOpen(false)}
      onComplete={(score) => { setPriorityScore(score); setScorecardOpen(false); }}
    />
    </>
  );
}
