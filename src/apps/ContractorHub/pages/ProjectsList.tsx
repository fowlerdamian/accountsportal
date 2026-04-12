import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Loader2, Calendar } from "lucide-react";
import { Button } from "@guide/components/ui/button";
import { HubLayout } from "@hub/components/HubLayout";
import { StatusPill } from "@hub/components/StatusPill";
import { ContractorAvatarGroup } from "@hub/components/ContractorAvatar";
import { NewProjectModal } from "@hub/components/NewProjectModal";
import {
  useProjects,
  useProjectContractors,
  useProjectBudgetSummary,
  type Project,
  type ProjectStatus,
} from "@hub/hooks/use-hub-queries";
import { cn } from "@guide/lib/utils";

// ── Project card ─────────────────────────────────────────────

function ProjectCard({ project }: { project: Project }) {
  const navigate                        = useNavigate();
  const { data: contractors = [] }      = useProjectContractors(project.id);
  const { data: budget }                = useProjectBudgetSummary(project.id);
  const today                           = new Date().toISOString().split("T")[0];
  const isOverdue                       = project.due_date && project.due_date < today && project.status !== "complete";

  const burnPct = budget?.budget_allocated
    ? Math.min((budget.budget_spent / budget.budget_allocated) * 100, 100)
    : 0;

  const TYPE_LABELS: Record<string, string> = { product: "Product", website: "Website", other: "Other" };

  return (
    <div
      className="rounded-lg border bg-background p-5 flex flex-col gap-3 cursor-pointer hover:border-primary/40 transition-colors animate-fade-in focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
      onClick={() => navigate(`/projects/list/${project.id}`)}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/projects/list/${project.id}`); } }}
      tabIndex={0}
      role="button"
      aria-label={`Open project ${project.name}`}
    >
      {/* Top row */}
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold text-base leading-snug">{project.name}</h3>
        <span className="text-[11px] font-medium px-2 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
          {TYPE_LABELS[project.type] ?? project.type}
        </span>
      </div>

      {/* Contractor avatars */}
      {contractors.length > 0 && (
        <ContractorAvatarGroup contractors={contractors} size="sm" />
      )}

      {/* Budget bar */}
      {budget?.budget_allocated != null && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>${Number(budget.budget_spent).toFixed(0)} spent</span>
            <span
              className={cn(burnPct >= 80 && "text-amber-400", burnPct >= 100 && "text-red-400")}
            >
              ${Number(budget.budget_allocated).toLocaleString()} budget
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                burnPct >= 100 ? "bg-red-500" : burnPct >= 80 ? "bg-amber-500" : "bg-primary",
              )}
              style={{ width: `${burnPct}%` }}
            />
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between mt-auto pt-1">
        <StatusPill status={project.status} size="sm" />
        {project.due_date && (
          <div className={cn("flex items-center gap-1 text-xs", isOverdue ? "text-red-400" : "text-muted-foreground")}>
            <Calendar className="w-3 h-3" />
            {project.due_date}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Grouped section ──────────────────────────────────────────

const STATUS_ORDER: ProjectStatus[] = ["active", "planning", "on_hold", "complete"];
const STATUS_LABELS: Record<ProjectStatus, string> = {
  active:   "Active",
  planning: "Planning",
  on_hold:  "On Hold",
  complete: "Complete",
};

// ── Page ─────────────────────────────────────────────────────

export default function ProjectsList() {
  const [newOpen, setNewOpen] = useState(false);
  const { data: projects = [], isLoading } = useProjects();

  const grouped = STATUS_ORDER.reduce((acc, s) => {
    acc[s] = projects.filter((p) => p.status === s);
    return acc;
  }, {} as Record<ProjectStatus, Project[]>);

  if (isLoading) {
    return (
      <HubLayout>
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </HubLayout>
    );
  }

  return (
    <HubLayout>
      <div className="space-y-8 animate-fade-in">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Projects</h1>
            <p className="text-muted-foreground text-sm">{projects.length} project{projects.length !== 1 ? "s" : ""}</p>
          </div>
          <Button onClick={() => setNewOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            New Project
          </Button>
        </div>

        {projects.length === 0 && (
          <div className="rounded-lg border border-dashed p-12 text-center">
            <p className="text-muted-foreground text-sm">No projects yet.</p>
            <Button variant="outline" className="mt-3" onClick={() => setNewOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />Create your first project
            </Button>
          </div>
        )}

        {STATUS_ORDER.map((status) => {
          const group = grouped[status];
          if (!group.length) return null;
          return (
            <section key={status}>
              <div className="flex items-center gap-3 mb-3">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {STATUS_LABELS[status]}
                </h2>
                <span className="text-xs text-muted-foreground/60">({group.length})</span>
                <div className="flex-1 h-px bg-border/50" />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {group.map((p) => <ProjectCard key={p.id} project={p} />)}
              </div>
            </section>
          );
        })}
      </div>

      <NewProjectModal open={newOpen} onClose={() => setNewOpen(false)} />
    </HubLayout>
  );
}
