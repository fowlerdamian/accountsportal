import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@guide/components/ui/button";
import { HubLayout } from "@guide/components/hub/HubLayout";
import { ContractorAvatar } from "@guide/components/hub/ContractorAvatar";
import { StatusPill } from "@guide/components/hub/StatusPill";
import { SourceBadge } from "@guide/components/hub/SourceBadge";
import { NewContractorModal } from "@guide/components/hub/NewContractorModal";
import { useContractors } from "@guide/hooks/use-hub-queries";
import { supabase } from "@guide/integrations/supabase/client";

export default function ContractorsList() {
  const navigate = useNavigate();
  const [addOpen, setAddOpen] = useState(false);

  const { data: contractors = [], isLoading } = useContractors();

  // Fetch active project counts per contractor (tasks not done, grouped by project)
  const { data: activeProjectCounts = new Map<string, number>() } = useQuery({
    queryKey: ["hub_contractor_project_counts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tasks")
        .select("assigned_to, project_id")
        .not("assigned_to", "is", null)
        .neq("status", "done");
      if (error) throw error;
      const map = new Map<string, Set<string>>();
      for (const t of data ?? []) {
        if (!t.assigned_to) continue;
        if (!map.has(t.assigned_to)) map.set(t.assigned_to, new Set());
        map.get(t.assigned_to)!.add(t.project_id);
      }
      const counts = new Map<string, number>();
      map.forEach((projects, cid) => counts.set(cid, projects.size));
      return counts;
    },
  });

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
      <div className="space-y-6 animate-fade-in">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Contractors</h1>
            <p className="text-muted-foreground text-sm">{contractors.length} contractor{contractors.length !== 1 ? "s" : ""}</p>
          </div>
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Add Contractor
          </Button>
        </div>

        <div className="rounded-lg border bg-background overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left p-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Name</th>
                <th className="text-left p-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Role</th>
                <th className="text-left p-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Source</th>
                <th className="text-left p-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Status</th>
                <th className="text-right p-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Active Projects</th>
              </tr>
            </thead>
            <tbody>
              {contractors.map((c) => (
                <tr
                  key={c.id}
                  className="border-b hover:bg-muted/30 cursor-pointer transition-colors"
                  onClick={() => navigate(`/hub/contractors/${c.id}`)}
                >
                  <td className="p-3">
                    <div className="flex items-center gap-2.5">
                      <ContractorAvatar name={c.name} avatarUrl={c.avatar_url} size="sm" />
                      <div>
                        <p className="text-sm font-medium">{c.name}</p>
                        {c.hourly_rate != null && (
                          <p className="text-xs text-muted-foreground">${c.hourly_rate}/hr</p>
                        )}
                        {c.hourly_rate == null && (
                          <p className="text-xs text-muted-foreground">Fixed price</p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="p-3 text-sm text-muted-foreground">{c.role}</td>
                  <td className="p-3"><SourceBadge source={c.source} /></td>
                  <td className="p-3"><StatusPill status={c.status} /></td>
                  <td className="p-3 text-right text-sm text-muted-foreground tabular-nums">
                    {activeProjectCounts.get(c.id) ?? 0}
                  </td>
                </tr>
              ))}
              {contractors.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-muted-foreground text-sm">
                    No contractors yet. Add your first contractor to get started.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <NewContractorModal open={addOpen} onClose={() => setAddOpen(false)} />
    </HubLayout>
  );
}
