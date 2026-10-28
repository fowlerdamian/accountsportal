import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Layers, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@guide/components/ui/dialog";
import { Button } from "@guide/components/ui/button";
import { Input } from "@guide/components/ui/input";
import { Label } from "@guide/components/ui/label";
import { supabase } from "@guide/integrations/supabase/client";
import { cn } from "@guide/lib/utils";
import { MATERIAL_SUGGESTIONS, FINISH_SUGGESTIONS } from "@hub/lib/materials";

// Chip under the project name → popup to set the project's Material & Finish.
// They feed the title block of every drawing made from this project's STEP files;
// saving redraws the existing ones (set_project_material).
export function MaterialFinishChip({ projectId, material, finish }: {
  projectId: string;
  material:  string | null;
  finish:    string | null;
}) {
  const qc = useQueryClient();
  const [open, setOpen]       = useState(false);
  const [mat, setMat]         = useState("");
  const [fin, setFin]         = useState("");
  const [saving, setSaving]   = useState(false);
  const missing = !material || !finish;

  function openDialog() {
    setMat(material ?? "");
    setFin(finish ?? "");
    setOpen(true);
  }

  async function save() {
    setSaving(true);
    try {
      const { data, error } = await supabase.rpc("set_project_material" as any, {
        p_project: projectId, p_material: mat, p_finish: fin,
      });
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ["hub_project", projectId] });
      qc.invalidateQueries({ queryKey: ["hub_projects"] });
      const redrawn = (data as number) ?? 0;
      toast.success(redrawn > 0 ? `Saved — redrawing ${redrawn} drawing${redrawn > 1 ? "s" : ""}` : "Material & finish saved");
      setOpen(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't save material & finish");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        title="Material & finish for this project's drawings"
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs transition-colors",
          missing
            ? "border-[rgba(var(--brand-accent-rgb),0.5)] text-[var(--brand-accent)] hover:bg-[rgba(var(--brand-accent-rgb),0.08)]"
            : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/30",
        )}
      >
        <Layers className="w-3 h-3" />
        {missing ? "Set material & finish" : `${material} · ${finish}`}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Material &amp; finish</DialogTitle>
          </DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); save(); }} className="space-y-4 mt-1">
            <div className="space-y-1.5">
              <Label htmlFor="pf-material">Material</Label>
              <Input id="pf-material" list="pf-material-list" value={mat} onChange={(e) => setMat(e.target.value)}
                placeholder="e.g. 3mm Mild Steel" autoFocus />
              <datalist id="pf-material-list">{MATERIAL_SUGGESTIONS.map((m) => <option key={m} value={m} />)}</datalist>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pf-finish">Finish</Label>
              <Input id="pf-finish" list="pf-finish-list" value={fin} onChange={(e) => setFin(e.target.value)}
                placeholder="e.g. Black Textured PC" />
              <datalist id="pf-finish-list">{FINISH_SUGGESTIONS.map((f) => <option key={f} value={f} />)}</datalist>
            </div>
            <p className="text-xs text-muted-foreground">Used in the title block of this project's drawings. Saving redraws them.</p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" size="sm" disabled={saving}>
                {saving && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}Save
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
