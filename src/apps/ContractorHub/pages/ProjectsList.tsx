import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Plus, Loader2, Calendar, AlertCircle, Check, X as XIcon,
  Trash2, RotateCcw, Search, LayoutGrid, Columns3,
} from "lucide-react";
import { Button } from "@guide/components/ui/button";
import { Input } from "@guide/components/ui/input";
import { HubLayout } from "@hub/components/HubLayout";
import { ContractorAvatarGroup } from "@hub/components/ContractorAvatar";
import { NewProjectModal } from "@hub/components/NewProjectModal";
import { toast } from "sonner";
import {
  useProjects,
  useDeletedProjects,
  useProjectContractors,
  useProjectBudgetSummary,
  useActiveStages,
  useRestoreProject,
  usePermanentDeleteProject,
  NEW_PRODUCT_STAGES,
  type Project,
  type ProjectStage,
  type ProjectStatus,
} from "@hub/hooks/use-hub-queries";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@guide/integrations/supabase/client";
import { cn } from "@guide/lib/utils";

// ── Stage colour map ──────────────────────────────────────────

const STAGE_COLORS = [
  { border: "border-l-violet-500", dot: "bg-violet-400", text: "text-violet-400" },
  { border: "border-l-blue-500",   dot: "bg-blue-400",   text: "text-blue-400" },
  { border: "border-l-cyan-500",   dot: "bg-cyan-400",   text: "text-cyan-400" },
  { border: "border-l-amber-500",  dot: "bg-amber-400",  text: "text-amber-400" },
  { border: "border-l-green-500",  dot: "bg-green-400",  text: "text-green-400" },
];

function stageColor(stageName: string) {
  const idx = NEW_PRODUCT_STAGES.indexOf(stageName as any);
  return STAGE_COLORS[idx >= 0 ? idx : STAGE_COLORS.length - 1];
}

// ── Kanban columns ────────────────────────────────────────────

const KANBAN_COLS: { status: ProjectStatus; label: string; color: string }[] = [
  { status: "planning",  label: "Planning",  color: "border-t-violet-500" },
  { status: "active",    label: "Active",    color: "border-t-blue-500" },
  { status: "on_hold",   label: "On Hold",   color: "border-t-amber-500" },
  { status: "complete",  label: "Complete",  color: "border-t-green-500" },
];

// ── Project card (grid) ───────────────────────────────────────

function ProjectCard({ project, activeStage }: { project: Project; activeStage: ProjectStage | undefined }) {
  const navigate                   = useNavigate();
  const { data: contractors = [] } = useProjectContractors(project.id);
  const { data: budget }           = useProjectBudgetSummary(project.id);
  const today                      = new Date().toISOString().split("T")[0];
  const isOverdue                  = project.due_date && project.due_date < today;
  const isProduct                  = project.type === "new_product";
  const stageIdx                   = activeStage ? NEW_PRODUCT_STAGES.indexOf(activeStage.name as any) : -1;
  const color                      = activeStage ? stageColor(activeStage.name) : STAGE_COLORS[0];
  const burnPct                    = budget?.budget_allocated
    ? Math.min((budget.budget_spent / budget.budget_allocated) * 100, 100)
    : 0;
  const borderClass = isProduct
    ? (activeStage ? color.border : "border-l-zinc-600")
    : "border-l-zinc-600";

  return (
    <div
      onClick={() => navigate(`/projects/list/${project.id}`)}
      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(`/projects/list/${project.id}`); } }}
      tabIndex={0} role="button" aria-label={`Open project ${project.name}`}
      className={cn(
        "rounded-lg border border-l-4 bg-background px-5 py-4 flex flex-col gap-2.5 cursor-pointer",
        "hover:bg-muted/20 transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none",
        borderClass,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold text-sm leading-snug">{project.name}</h3>
        <div className="flex items-center gap-1.5 shrink-0">
          {project.priority_score != null && (
            <span className={cn(
              "text-[10px] font-bold px-1.5 py-0.5 rounded tabular-nums",
              project.priority_score >= 8 ? "bg-green-500/20 text-green-400"
                : project.priority_score >= 5 ? "bg-amber-500/20 text-amber-400"
                : "bg-red-500/20 text-red-400",
            )}>
              {project.priority_score}/10
            </span>
          )}
          {isProduct && activeStage && (
            <div className="flex items-center gap-1">
              <span className={cn("text-[11px] font-semibold", color.text)}>{activeStage.name}</span>
              {activeStage.name === "Prototype" && (
                <span className={cn("w-4 h-4 rounded-full flex items-center justify-center", activeStage.metadata?.ordered ? "bg-green-500" : "bg-red-500/80")}>
                  {activeStage.metadata?.ordered ? <Check className="w-2.5 h-2.5 text-white" /> : <XIcon className="w-2.5 h-2.5 text-white" />}
                </span>
              )}
            </div>
          )}
          {!isProduct && (
            <span className="text-[10px] text-muted-foreground/50 uppercase tracking-wide">
              {project.type === "web" ? "Web" : "Other"}
            </span>
          )}
        </div>
      </div>
      {contractors.length > 0 && <ContractorAvatarGroup contractors={contractors} size="sm" />}
      {isProduct && (
        <div className="flex items-center gap-1.5">
          {NEW_PRODUCT_STAGES.map((s, i) => (
            <div key={s} className={cn("h-1 flex-1 rounded-full transition-colors",
              i < stageIdx && "bg-green-500/50",
              i === stageIdx && color.dot,
              i > stageIdx && "bg-muted",
            )} />
          ))}
        </div>
      )}
      {!isProduct && budget?.budget_allocated != null && (
        <div className="space-y-1 opacity-60">
          <div className="h-1 rounded-full bg-muted overflow-hidden">
            <div className={cn("h-full rounded-full", burnPct >= 100 ? "bg-red-500" : burnPct >= 80 ? "bg-amber-500" : "bg-primary/60")} style={{ width: `${burnPct}%` }} />
          </div>
          <div className="flex justify-between text-[10px] text-muted-foreground/60">
            <span>${Number(budget.budget_spent).toFixed(0)} spent</span>
            <span>${Number(budget.budget_allocated).toLocaleString()}</span>
          </div>
        </div>
      )}
      <div className="flex items-center justify-between mt-auto">
        {project.due_date ? (
          <div className={cn("flex items-center gap-1 text-[11px]", isOverdue ? "text-red-400" : "text-muted-foreground/60")}>
            {isOverdue && <AlertCircle className="w-3 h-3" />}
            <Calendar className="w-3 h-3" />
            {project.due_date}
          </div>
        ) : <span />}
        {isProduct && <span className="text-[10px] text-muted-foreground/50">Stage {Math.max(stageIdx + 1, 1)} of {NEW_PRODUCT_STAGES.length}</span>}
      </div>
    </div>
  );
}

// ── Kanban card (compact) ─────────────────────────────────────

function KanbanCard({ project, activeStage }: { project: Project; activeStage: ProjectStage | undefined }) {
  const navigate                   = useNavigate();
  const { data: contractors = [] } = useProjectContractors(project.id);
  const today                      = new Date().toISOString().split("T")[0];
  const isOverdue                  = project.due_date && project.due_date < today;
  const isProduct                  = project.type === "new_product";
  const color                      = activeStage ? stageColor(activeStage.name) : STAGE_COLORS[0];

  return (
    <div
      onClick={() => navigate(`/projects/list/${project.id}`)}
      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(`/projects/list/${project.id}`); } }}
      tabIndex={0} role="button"
      className="rounded-md border bg-background px-3 py-2.5 flex flex-col gap-1.5 cursor-pointer hover:bg-muted/20 transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
    >
      <div className="flex items-start justify-between gap-1.5">
        <span className="text-xs font-medium leading-snug">{project.name}</span>
        {project.priority_score != null && (
          <span className={cn("text-[9px] font-bold px-1 py-0.5 rounded shrink-0 tabular-nums",
            project.priority_score >= 8 ? "bg-green-500/20 text-green-400"
              : project.priority_score >= 5 ? "bg-amber-500/20 text-amber-400"
              : "bg-red-500/20 text-red-400",
          )}>
            {project.priority_score}
          </span>
        )}
      </div>
      {isProduct && activeStage && (
        <span className={cn("text-[10px] font-semibold", color.text)}>{activeStage.name}</span>
      )}
      <div className="flex items-center justify-between">
        {contractors.length > 0 && <ContractorAvatarGroup contractors={contractors} size="sm" />}
        {project.due_date && (
          <span className={cn("text-[10px] flex items-center gap-0.5", isOverdue ? "text-red-400" : "text-muted-foreground/50")}>
            {isOverdue && <AlertCircle className="w-2.5 h-2.5" />}
            <Calendar className="w-2.5 h-2.5" />
            {project.due_date}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Filter pill ───────────────────────────────────────────────

function FilterPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "px-3 py-0.5 rounded-full text-xs font-medium transition-colors border",
        active ? "bg-muted text-foreground border-border" : "text-muted-foreground border-transparent hover:border-border/50",
      )}
    >
      {children}
    </button>
  );
}

// ── Types ─────────────────────────────────────────────────────

type TypeFilter     = "all" | "new_product" | "web" | "other";
type PriorityFilter = "all" | "high" | "med" | "low" | "none";
type DateFilter     = "all" | "30d" | "90d" | "365d";
type ViewMode       = "grid" | "kanban";

// ── Page ─────────────────────────────────────────────────────

export default function ProjectsList() {
  const [newOpen,         setNewOpen]         = useState(false);
  const [view,            setView]            = useState<ViewMode>("grid");
  const [search,          setSearch]          = useState("");
  const [typeFilter,      setTypeFilter]      = useState<TypeFilter>("all");
  const [stageFilter,     setStageFilter]     = useState<string>("all");
  const [priorityFilter,  setPriorityFilter]  = useState<PriorityFilter>("all");
  const [dateFilter,      setDateFilter]      = useState<DateFilter>("all");
  const [showBin,         setShowBin]         = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const { data: projects = [],       isLoading }         = useProjects();
  const { data: deletedProjects = [] }                   = useDeletedProjects();
  const { data: activeStages = [],   isLoading: stagesLoading } = useActiveStages();
  const { mutateAsync: restoreProject }                  = useRestoreProject();
  const { mutateAsync: permanentDelete }                 = usePermanentDeleteProject();

  const qc = useQueryClient();
  useEffect(() => {
    const channel = supabase
      .channel("hub_projects_list_rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "projects" },
          () => { qc.invalidateQueries({ queryKey: ["hub_projects"] }); qc.invalidateQueries({ queryKey: ["hub_projects_deleted"] }); })
      .on("postgres_changes", { event: "*", schema: "public", table: "project_stages" },
          () => qc.invalidateQueries({ queryKey: ["hub_active_stages"] }))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [qc]);

  const activeStageByProject = Object.fromEntries(activeStages.map(s => [s.project_id, s]));
  const productProjects      = projects.filter(p => p.type === "new_product");
  const showStageFilter      = typeFilter === "new_product" || typeFilter === "all";

  // ── Filtering pipeline ────────────────────────────────────────

  const cutoff = dateFilter !== "all"
    ? new Date(Date.now() - parseInt(dateFilter) * 24 * 60 * 60 * 1000).toISOString()
    : null;

  const filtered = projects
    .filter(p => typeFilter === "all" || (typeFilter === "other" ? p.type !== "new_product" && p.type !== "web" : p.type === typeFilter))
    .filter(p => {
      if (stageFilter === "all") return true;
      if (p.type !== "new_product") return true;
      return activeStageByProject[p.id]?.name === stageFilter;
    })
    .filter(p => {
      if (priorityFilter === "all")  return true;
      if (priorityFilter === "none") return p.priority_score == null;
      if (priorityFilter === "high") return p.priority_score != null && p.priority_score >= 8;
      if (priorityFilter === "med")  return p.priority_score != null && p.priority_score >= 5 && p.priority_score < 8;
      if (priorityFilter === "low")  return p.priority_score != null && p.priority_score < 5;
      return true;
    })
    .filter(p => !cutoff || p.created_at >= cutoff)
    .filter(p => !search.trim() || p.name.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => (b.priority_score ?? -1) - (a.priority_score ?? -1));

  if (isLoading || stagesLoading) {
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
      <div className="space-y-4 animate-fade-in">

        {/* ── Header row ── */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Search */}
          <div className="relative flex-1 min-w-[160px] max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search projects…"
              className="pl-8 h-8 text-xs"
            />
          </div>

          {/* Type pills */}
          <div className="flex items-center gap-1 flex-wrap">
            <FilterPill active={typeFilter === "all"} onClick={() => { setTypeFilter("all"); setStageFilter("all"); }}>
              All <span className="ml-1 opacity-50">{projects.length}</span>
            </FilterPill>
            <FilterPill active={typeFilter === "new_product"} onClick={() => { setTypeFilter("new_product"); setStageFilter("all"); }}>
              Products <span className="ml-1 opacity-50">{projects.filter(p => p.type === "new_product").length}</span>
            </FilterPill>
            <FilterPill active={typeFilter === "web"} onClick={() => { setTypeFilter("web"); setStageFilter("all"); }}>
              Web <span className="ml-1 opacity-50">{projects.filter(p => p.type === "web").length}</span>
            </FilterPill>
            <FilterPill active={typeFilter === "other"} onClick={() => { setTypeFilter("other"); setStageFilter("all"); }}>
              Other <span className="ml-1 opacity-50">{projects.filter(p => p.type !== "new_product" && p.type !== "web").length}</span>
            </FilterPill>
          </div>

          {/* Right side */}
          <div className="ml-auto flex items-center gap-2">
            {/* Bin */}
            <button
              onClick={() => setShowBin(v => !v)}
              className={cn(
                "px-3 py-0.5 rounded-full text-xs font-medium transition-colors border flex items-center gap-1",
                showBin ? "bg-muted text-foreground border-border" : "text-muted-foreground border-transparent hover:border-border/50",
              )}
            >
              <Trash2 className="w-3 h-3 opacity-60" />
              Bin
              {deletedProjects.length > 0 && <span className="ml-0.5 opacity-50">{deletedProjects.length}</span>}
            </button>

            {/* View toggle */}
            <div className="flex items-center rounded-md border overflow-hidden">
              <button
                onClick={() => setView("grid")}
                className={cn("p-1.5 transition-colors", view === "grid" ? "bg-muted" : "hover:bg-muted/50")}
                title="Grid view"
              >
                <LayoutGrid className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setView("kanban")}
                className={cn("p-1.5 transition-colors", view === "kanban" ? "bg-muted" : "hover:bg-muted/50")}
                title="Kanban view"
              >
                <Columns3 className="w-3.5 h-3.5" />
              </button>
            </div>

            <Button size="sm" onClick={() => setNewOpen(true)}>
              <Plus className="w-3.5 h-3.5 mr-1.5" />
              New Project
            </Button>
          </div>
        </div>

        {/* ── Filter row 2: priority · date · stage ── */}
        {!showBin && (
          <div className="flex items-center gap-3 flex-wrap text-[11px]">
            {/* Priority */}
            <div className="flex items-center gap-1">
              <span className="text-muted-foreground/50 mr-0.5">Priority</span>
              {(["all", "high", "med", "low", "none"] as PriorityFilter[]).map(f => (
                <FilterPill key={f} active={priorityFilter === f} onClick={() => setPriorityFilter(f)}>
                  {f === "all" ? "All" : f === "high" ? "High" : f === "med" ? "Med" : f === "low" ? "Low" : "Unscored"}
                </FilterPill>
              ))}
            </div>

            <div className="w-px h-4 bg-border/50" />

            {/* Date created */}
            <div className="flex items-center gap-1">
              <span className="text-muted-foreground/50 mr-0.5">Created</span>
              {(["all", "30d", "90d", "365d"] as DateFilter[]).map(f => (
                <FilterPill key={f} active={dateFilter === f} onClick={() => setDateFilter(f)}>
                  {f === "all" ? "All time" : f === "30d" ? "30d" : f === "90d" ? "90d" : "1y"}
                </FilterPill>
              ))}
            </div>

            {/* Stage sub-filter */}
            {showStageFilter && productProjects.length > 0 && (
              <>
                <div className="w-px h-4 bg-border/50" />
                <div className="flex items-center gap-1">
                  <span className="text-muted-foreground/50 mr-0.5">Stage</span>
                  <FilterPill active={stageFilter === "all"} onClick={() => setStageFilter("all")}>All</FilterPill>
                  {NEW_PRODUCT_STAGES.map((s, i) => {
                    const count = productProjects.filter(p => activeStageByProject[p.id]?.name === s).length;
                    return (
                      <button
                        key={s}
                        onClick={() => setStageFilter(s)}
                        className={cn(
                          "px-3 py-0.5 rounded-full text-xs font-medium transition-colors border flex items-center gap-1",
                          stageFilter === s ? "bg-muted text-foreground border-border" : "text-muted-foreground border-transparent hover:border-border/50",
                        )}
                      >
                        <span className={cn("w-1.5 h-1.5 rounded-full", STAGE_COLORS[i].dot)} />
                        {s}
                        <span className="opacity-50">{count}</span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Grid view ── */}
        {!showBin && view === "grid" && (
          filtered.length === 0 ? (
            <div className="rounded-lg border border-dashed p-10 text-center">
              <p className="text-muted-foreground text-sm">No projects found.</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => setNewOpen(true)}>
                <Plus className="w-3.5 h-3.5 mr-1.5" />Create one
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {filtered.map(p => (
                <ProjectCard key={p.id} project={p} activeStage={activeStageByProject[p.id]} />
              ))}
            </div>
          )
        )}

        {/* ── Kanban view ── */}
        {!showBin && view === "kanban" && (
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 items-start">
            {KANBAN_COLS.map(col => {
              const colProjects = filtered.filter(p => p.status === col.status);
              return (
                <div key={col.status} className={cn("rounded-lg border border-t-2 bg-muted/20 flex flex-col gap-2 p-3", col.color)}>
                  <div className="flex items-center justify-between px-0.5 mb-1">
                    <span className="text-xs font-semibold">{col.label}</span>
                    <span className="text-[10px] text-muted-foreground">{colProjects.length}</span>
                  </div>
                  {colProjects.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground/40 text-center py-4">Empty</p>
                  ) : (
                    colProjects.map(p => (
                      <KanbanCard key={p.id} project={p} activeStage={activeStageByProject[p.id]} />
                    ))
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ── Recycle bin ── */}
        {showBin && (
          <>
            <p className="text-xs text-muted-foreground">Projects are permanently deleted after 15 days.</p>
            {deletedProjects.length === 0 ? (
              <div className="rounded-lg border border-dashed p-10 text-center">
                <Trash2 className="w-8 h-8 mx-auto mb-3 text-muted-foreground/30" />
                <p className="text-muted-foreground text-sm">Recycle bin is empty.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {deletedProjects.map(p => {
                  const deletedAt = new Date(p.deleted_at!);
                  const expiresAt = new Date(deletedAt.getTime() + 15 * 24 * 60 * 60 * 1000);
                  const daysLeft  = Math.max(0, Math.ceil((expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
                  return (
                    <div key={p.id} className="flex items-center gap-3 rounded-lg border bg-background px-4 py-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{p.name}</p>
                        <p className="text-[11px] text-muted-foreground/60">
                          Deleted {deletedAt.toLocaleDateString()} · {daysLeft}d left
                        </p>
                      </div>
                      <Button size="sm" variant="outline" onClick={async () => { await restoreProject(p.id); toast.success(`"${p.name}" restored`); }}>
                        <RotateCcw className="w-3.5 h-3.5 mr-1.5" />Restore
                      </Button>
                      {confirmDeleteId === p.id ? (
                        <div className="flex items-center gap-1.5">
                          <Button size="sm" variant="destructive" className="h-7 px-2 text-xs"
                            onClick={async () => { setConfirmDeleteId(null); await permanentDelete({ id: p.id, drive_folder_id: p.drive_folder_id }); toast.success("Project permanently deleted"); }}>
                            Delete
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setConfirmDeleteId(null)}>Cancel</Button>
                        </div>
                      ) : (
                        <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-red-400 hover:bg-red-400/10" onClick={() => setConfirmDeleteId(p.id)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      <NewProjectModal open={newOpen} onClose={() => setNewOpen(false)} />
    </HubLayout>
  );
}
