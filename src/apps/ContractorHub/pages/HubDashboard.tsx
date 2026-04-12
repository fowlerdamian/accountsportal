import { useQuery } from "@tanstack/react-query";
import { Loader2, FolderOpen, AlertTriangle, Clock, TrendingUp } from "lucide-react";
import { HubLayout } from "@hub/components/HubLayout";
import { StatsCard } from "@guide/components/admin/StatsCard";
import { ActivityFeed } from "@hub/components/ActivityFeed";
import { StatusPill } from "@hub/components/StatusPill";
import { useAuth } from "@guide/contexts/AuthContext";
import {
  useHubDashboardMetrics,
  useDashboardActivity,
  useMyContractorProfile,
  useTimeEntries,
  type Task,
} from "@hub/hooks/use-hub-queries";
import { supabase } from "@guide/integrations/supabase/client";
import { cn } from "@guide/lib/utils";
import { useNavigate } from "react-router-dom";

// ── Contractor "My Work" view ────────────────────────────────

function ContractorDashboard({ contractorId }: { contractorId: string }) {
  const navigate = useNavigate();

  // Tasks assigned to this contractor, not done
  const { data: tasks = [], isLoading: tasksLoading } = useQuery({
    queryKey: ["hub_my_tasks", contractorId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tasks")
        .select("*, projects(id, name)")
        .eq("assigned_to", contractorId)
        .neq("status", "done")
        .order("due_date", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return data as (Task & { projects: { id: string; name: string } | null })[];
    },
  });

  // Time entries this week
  const now  = new Date();
  const day  = now.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const mon  = new Date(now);
  mon.setDate(now.getDate() + diff);
  const monday = mon.toISOString().split("T")[0];

  const { data: weekEntries = [] } = useTimeEntries({ contractorId });
  const weekHours = weekEntries
    .filter((e) => e.date >= monday)
    .reduce((s, e) => s + (e.hours ?? 0), 0);

  // Group tasks by project
  const byProject = new Map<string, { name: string; tasks: typeof tasks }>();
  for (const t of tasks) {
    const pid  = t.projects?.id ?? "unknown";
    const pname = t.projects?.name ?? "Unknown project";
    if (!byProject.has(pid)) byProject.set(pid, { name: pname, tasks: [] });
    byProject.get(pid)!.tasks.push(t);
  }

  const today = new Date().toISOString().split("T")[0];

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold">My Work</h1>
        <p className="text-muted-foreground text-sm">Your assigned tasks and this week's activity</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <StatsCard title="Open Tasks" value={tasks.length} icon={<Clock className="w-5 h-5" />} />
        <StatsCard title="Hours This Week" value={weekHours.toFixed(1)} icon={<TrendingUp className="w-5 h-5" />} />
      </div>

      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
          Assigned Tasks
        </h2>
        {tasksLoading ? (
          <Loader2 className="w-5 h-5 animate-spin text-primary" />
        ) : byProject.size === 0 ? (
          <p className="text-sm text-muted-foreground">No open tasks assigned to you.</p>
        ) : (
          <div className="space-y-4">
            {Array.from(byProject.entries()).map(([pid, group]) => (
              <div key={pid} className="rounded-lg border bg-background overflow-hidden">
                <div
                  className="px-4 py-2.5 border-b bg-muted/30 flex items-center justify-between cursor-pointer hover:bg-muted/50"
                  onClick={() => navigate(`/projects/list/${pid}`)}
                >
                  <span className="text-sm font-medium">{group.name}</span>
                  <span className="text-xs text-muted-foreground">{group.tasks.length} task{group.tasks.length !== 1 ? "s" : ""}</span>
                </div>
                <div className="divide-y">
                  {group.tasks.map((t) => {
                    const isOverdue = t.due_date && t.due_date < today;
                    return (
                      <div key={t.id} className="px-4 py-2.5 flex items-center gap-3">
                        <span className={cn("text-sm flex-1", isOverdue && "text-red-400")}>{t.title}</span>
                        <StatusPill status={t.status} size="sm" />
                        {t.due_date && (
                          <span className={cn("text-xs", isOverdue ? "text-red-400" : "text-muted-foreground")}>
                            {t.due_date}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Staff dashboard ──────────────────────────────────────────

function StaffDashboard() {
  const navigate        = useNavigate();
  const { data: metrics, isLoading: metricsLoading } = useHubDashboardMetrics();
  const { data: activity = [], isLoading: actLoading } = useDashboardActivity();

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold">Contractor Hub</h1>
        <p className="text-muted-foreground text-sm">Project and contractor management</p>
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard
          title="Active Projects"
          value={metricsLoading ? "—" : metrics?.activeProjects ?? 0}
          icon={<FolderOpen className="w-5 h-5" />}
          className="cursor-pointer hover:border-primary/50 transition-colors"
          onClick={() => navigate("/projects/list")}
        />
        <StatsCard
          title="Overdue Tasks"
          value={metricsLoading ? "—" : metrics?.overdueTasks ?? 0}
          icon={<AlertTriangle className="w-5 h-5" />}
          className={cn(
            "cursor-pointer hover:border-primary/50 transition-colors",
            (metrics?.overdueTasks ?? 0) > 0 && "[&_p.text-2xl]:text-red-400",
          )}
          onClick={() => navigate("/projects/list")}
        />
        <StatsCard
          title="Hours This Week"
          value={metricsLoading ? "—" : metrics?.hoursThisWeek ?? 0}
          icon={<Clock className="w-5 h-5" />}
        />
        <StatsCard
          title="Budget Burn"
          value={metricsLoading ? "—" : `${metrics?.budgetBurnPct ?? 0}%`}
          icon={<TrendingUp className="w-5 h-5" />}
          className={cn(
            (metrics?.budgetBurnPct ?? 0) >= 80 && "[&_p.text-2xl]:text-amber-400",
          )}
        />
      </div>

      {/* Recent activity */}
      <div className="rounded-lg border bg-background p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4">
          Recent Activity
        </h2>
        <ActivityFeed
          entries={activity}
          isLoading={actLoading}
          emptyText="No activity yet — create a project to get started."
        />
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────

export default function HubDashboard() {
  const { user }              = useAuth();
  const { data: contractor }  = useMyContractorProfile(user?.id);

  return (
    <HubLayout>
      {contractor
        ? <ContractorDashboard contractorId={contractor.id} />
        : <StaffDashboard />
      }
    </HubLayout>
  );
}
