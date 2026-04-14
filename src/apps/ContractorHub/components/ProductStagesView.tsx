import { useState } from "react";
import { CheckCircle2, Circle, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@guide/components/ui/button";
import { Input } from "@guide/components/ui/input";
import { toast } from "sonner";
import { cn } from "@guide/lib/utils";
import {
  useProjectStages,
  useUpdateProjectStage,
  type ProjectStage,
} from "@hub/hooks/use-hub-queries";

interface ProductStagesViewProps {
  projectId: string;
}

// ── Individual stage row ──────────────────────────────────────

function StageRow({
  stage,
  isLast,
  onStartNext,
  starting,
}: {
  stage:      ProjectStage;
  isLast:     boolean;
  onStartNext: () => void;
  starting:   boolean;
}) {
  const { mutateAsync: updateStage } = useUpdateProjectStage();
  const [editingStart, setEditingStart] = useState(false);
  const [editingEnd,   setEditingEnd]   = useState(false);
  const [startVal,     setStartVal]     = useState(stage.start_date ?? "");
  const [endVal,       setEndVal]       = useState(stage.end_date   ?? "");

  const isCompleted = !stage.is_active && !!stage.end_date;
  const isFuture    = !stage.is_active && !stage.end_date && !stage.start_date;

  async function saveDate(field: "start_date" | "end_date", value: string) {
    try {
      await updateStage({
        id:         stage.id,
        project_id: stage.project_id,
        [field]:    value || null,
      });
    } catch {
      toast.error("Failed to save date");
    }
  }

  return (
    <div className="flex gap-4">
      {/* Timeline connector */}
      <div className="flex flex-col items-center">
        <div className={cn(
          "w-8 h-8 rounded-full flex items-center justify-center shrink-0 border-2 transition-colors",
          isCompleted
            ? "bg-green-500/20 border-green-500 text-green-500"
            : stage.is_active
              ? "bg-primary/10 border-primary text-primary"
              : "bg-muted border-border text-muted-foreground",
        )}>
          {isCompleted
            ? <CheckCircle2 className="w-4 h-4" />
            : stage.is_active
              ? <ChevronRight className="w-4 h-4" />
              : <Circle className="w-4 h-4 opacity-40" />
          }
        </div>
        {!isLast && (
          <div className={cn(
            "w-0.5 flex-1 mt-1 min-h-[2rem]",
            isCompleted ? "bg-green-500/30" : "bg-border/50",
          )} />
        )}
      </div>

      {/* Stage card */}
      <div className={cn(
        "flex-1 pb-6 rounded-lg border p-4 mb-2 transition-colors",
        isCompleted
          ? "bg-green-500/5 border-green-500/20"
          : stage.is_active
            ? "bg-primary/5 border-primary/30"
            : "bg-background border-border/50 opacity-60",
      )}>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h3 className={cn(
              "font-semibold text-sm",
              isFuture && "text-muted-foreground",
            )}>
              {stage.name}
            </h3>
            <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground flex-wrap">
              {/* Start date */}
              <span>
                <span className="uppercase tracking-wider mr-1">Start:</span>
                {editingStart ? (
                  <input
                    type="date"
                    value={startVal}
                    autoFocus
                    onChange={e => setStartVal(e.target.value)}
                    onBlur={() => { setEditingStart(false); saveDate("start_date", startVal); }}
                    onKeyDown={e => { if (e.key === "Enter" || e.key === "Escape") { setEditingStart(false); saveDate("start_date", startVal); }}}
                    className="bg-transparent border-b border-primary/50 outline-none"
                  />
                ) : (
                  <span
                    className={cn("cursor-pointer hover:text-foreground transition-colors", !stage.start_date && "italic")}
                    onClick={() => { setStartVal(stage.start_date ?? ""); setEditingStart(true); }}
                    title="Click to edit"
                  >
                    {stage.start_date ?? "not set"}
                  </span>
                )}
              </span>

              {/* End date — only show if started */}
              {(stage.start_date || stage.is_active || isCompleted) && (
                <span>
                  <span className="uppercase tracking-wider mr-1">End:</span>
                  {editingEnd ? (
                    <input
                      type="date"
                      value={endVal}
                      autoFocus
                      onChange={e => setEndVal(e.target.value)}
                      onBlur={() => { setEditingEnd(false); saveDate("end_date", endVal); }}
                      onKeyDown={e => { if (e.key === "Enter" || e.key === "Escape") { setEditingEnd(false); saveDate("end_date", endVal); }}}
                      className="bg-transparent border-b border-primary/50 outline-none"
                    />
                  ) : (
                    <span
                      className={cn("cursor-pointer hover:text-foreground transition-colors", !stage.end_date && "italic")}
                      onClick={() => { setEndVal(stage.end_date ?? ""); setEditingEnd(true); }}
                      title="Click to edit"
                    >
                      {stage.end_date ?? (stage.is_active ? "in progress" : "—")}
                    </span>
                  )}
                </span>
              )}
            </div>
          </div>

          {/* Active stage action */}
          {stage.is_active && !isLast && (
            <Button
              size="sm"
              onClick={onStartNext}
              disabled={starting}
              className="shrink-0"
            >
              {starting && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
              Start Next Stage
            </Button>
          )}

          {/* Badge */}
          {isCompleted && (
            <span className="text-[10px] font-semibold uppercase tracking-wider text-green-600 bg-green-500/10 px-2 py-0.5 rounded-full shrink-0">
              Complete
            </span>
          )}
          {stage.is_active && (
            <span className="text-[10px] font-semibold uppercase tracking-wider text-primary bg-primary/10 px-2 py-0.5 rounded-full shrink-0">
              Active
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────

export function ProductStagesView({ projectId }: ProductStagesViewProps) {
  const { data: stages = [], isLoading } = useProjectStages(projectId);
  const { mutateAsync: updateStage }     = useUpdateProjectStage();
  const [starting, setStarting]          = useState(false);

  async function handleStartNext(currentStage: ProjectStage) {
    const nextStage = stages.find(s => s.position === currentStage.position + 1);
    if (!nextStage) return;

    const today = new Date().toISOString().split("T")[0];
    setStarting(true);
    try {
      await updateStage({
        id:         currentStage.id,
        project_id: currentStage.project_id,
        end_date:   today,
        is_active:  false,
      });
      await updateStage({
        id:         nextStage.id,
        project_id: nextStage.project_id,
        start_date: today,
        is_active:  true,
      });
      toast.success(`Started: ${nextStage.name}`);
    } catch {
      toast.error("Failed to advance stage");
    } finally {
      setStarting(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  if (stages.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground text-sm">
        No stages found for this project.
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-background overflow-hidden">
      <div className="px-5 py-3 border-b bg-muted/30">
        <h2 className="text-sm font-semibold">Product Stages</h2>
      </div>
      <div className="p-5">
        {stages.map((stage, i) => (
          <StageRow
            key={stage.id}
            stage={stage}
            isLast={i === stages.length - 1}
            onStartNext={() => handleStartNext(stage)}
            starting={starting}
          />
        ))}
      </div>
    </div>
  );
}
