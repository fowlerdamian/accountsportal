import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Loader2, ArrowLeft, Mail, Phone, Edit2, Check, X } from "lucide-react";
import { Button } from "@guide/components/ui/button";
import { Input } from "@guide/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@guide/components/ui/select";
import { toast } from "sonner";
import { HubLayout } from "@hub/components/HubLayout";
import { ContractorAvatar } from "@hub/components/ContractorAvatar";
import { StatusPill } from "@hub/components/StatusPill";
import { SourceBadge } from "@hub/components/SourceBadge";
import { ActivityFeed } from "@hub/components/ActivityFeed";
import { LogTimeForm } from "@hub/components/LogTimeForm";
import { supabase } from "@guide/integrations/supabase/client";
import {
  useContractor,
  useUpdateContractor,
  useTimeEntries,
  useActivityLog,
  type Task,
  type ContractorStatus,
} from "@hub/hooks/use-hub-queries";
import { cn } from "@guide/lib/utils";

export default function ContractorProfile() {
  const { id }     = useParams<{ id: string }>();
  const navigate   = useNavigate();
  const [editing, setEditing] = useState(false);
  const [logTime, setLogTime] = useState(false);

  // Editable fields
  const [editRole,   setEditRole]   = useState("");
  const [editRate,   setEditRate]   = useState("");
  const [editStatus, setEditStatus] = useState<ContractorStatus>("active");
  const [editNotes,  setEditNotes]  = useState("");

  const { data: contractor, isLoading } = useContractor(id);
  const { data: timeEntries = [] }      = useTimeEntries({ contractorId: id });
  const { data: activity = [] }         = useActivityLog({ contractorId: id });
  const { mutateAsync: updateContractor } = useUpdateContractor();

  // Tasks assigned to this contractor
  const { data: tasks = [], isLoading: tasksLoading } = useQuery({
    queryKey: ["hub_contractor_tasks", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tasks")
        .select("*, projects(id, name)")
        .eq("assigned_to", id!)
        .order("due_date", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return data as (Task & { projects: { id: string; name: string } | null })[];
    },
  });

  function startEdit() {
    if (!contractor) return;
    setEditRole(contractor.role);
    setEditRate(contractor.hourly_rate?.toString() ?? "");
    setEditStatus(contractor.status);
    setEditNotes(contractor.notes ?? "");
    setEditing(true);
  }

  async function saveEdit() {
    if (!contractor) return;
    try {
      await updateContractor({
        id:          contractor.id,
        role:        editRole.trim() || contractor.role,
        hourly_rate: editRate ? Number(editRate) : null,
        status:      editStatus,
        notes:       editNotes.trim() || null,
      });
      setEditing(false);
      toast.success("Contractor updated");
    } catch (err: any) {
      toast.error(err.message ?? "Failed to update");
    }
  }

  const today      = new Date().toISOString().split("T")[0];
  const openTasks  = tasks.filter((t) => t.status !== "done");
  const doneTasks  = tasks.filter((t) => t.status === "done");
  const totalHours = timeEntries.reduce((s, e) => s + (e.hours ?? 0), 0);

  if (isLoading) {
    return (
      <HubLayout>
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </HubLayout>
    );
  }

  if (!contractor) {
    return (
      <HubLayout>
        <div className="p-6 text-muted-foreground">Contractor not found.</div>
      </HubLayout>
    );
  }

  return (
    <HubLayout>
      <div className="space-y-6 animate-fade-in max-w-4xl">
        {/* Breadcrumb */}
        <button
          onClick={() => navigate("/hub/contractors")}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Contractors
        </button>

        {/* Header */}
        <div className="rounded-lg border bg-background p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-4">
              <ContractorAvatar name={contractor.name} avatarUrl={contractor.avatar_url} size="lg" />
              <div>
                <h1 className="text-xl font-bold">{contractor.name}</h1>
                {editing ? (
                  <Input
                    value={editRole}
                    onChange={(e) => setEditRole(e.target.value)}
                    className="h-7 text-sm mt-1 w-48"
                  />
                ) : (
                  <p className="text-muted-foreground text-sm mt-0.5">{contractor.role}</p>
                )}
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  {editing ? (
                    <Select value={editStatus} onValueChange={(v) => setEditStatus(v as ContractorStatus)}>
                      <SelectTrigger className="h-7 text-xs w-28"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="paused">Paused</SelectItem>
                        <SelectItem value="ended">Ended</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <StatusPill status={contractor.status} size="sm" />
                  )}
                  <SourceBadge source={contractor.source} />
                  {contractor.hourly_rate != null && !editing && (
                    <span className="text-xs text-muted-foreground">${contractor.hourly_rate}/hr</span>
                  )}
                  {editing && (
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-muted-foreground">$</span>
                      <Input
                        type="number"
                        value={editRate}
                        onChange={(e) => setEditRate(e.target.value)}
                        placeholder="hourly rate"
                        className="h-7 text-xs w-24"
                        min="0"
                        step="0.01"
                      />
                      <span className="text-xs text-muted-foreground">/hr</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="flex gap-2 shrink-0">
              {editing ? (
                <>
                  <Button size="sm" onClick={saveEdit}>
                    <Check className="w-3.5 h-3.5 mr-1.5" />Save
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setEditing(false)}>
                    <X className="w-3.5 h-3.5" />
                  </Button>
                </>
              ) : (
                <Button size="sm" variant="outline" onClick={startEdit}>
                  <Edit2 className="w-3.5 h-3.5 mr-1.5" />Edit
                </Button>
              )}
            </div>
          </div>

          {/* Contact + stats row */}
          <div className="mt-4 pt-4 border-t flex flex-wrap gap-4 text-sm">
            {contractor.email && (
              <a href={`mailto:${contractor.email}`} className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors">
                <Mail className="w-3.5 h-3.5" />
                {contractor.email}
              </a>
            )}
            {contractor.phone && (
              <a href={`tel:${contractor.phone}`} className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors">
                <Phone className="w-3.5 h-3.5" />
                {contractor.phone}
              </a>
            )}
            <span className="text-muted-foreground ml-auto">
              {openTasks.length} open task{openTasks.length !== 1 ? "s" : ""} · {totalHours.toFixed(1)} hrs total
            </span>
          </div>

          {editing && (
            <div className="mt-4">
              <label className="text-xs text-muted-foreground block mb-1">Notes</label>
              <textarea
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                rows={2}
                placeholder="Internal notes..."
                className="w-full resize-none rounded-lg border bg-muted/30 px-3 py-2 text-sm outline-none focus:border-primary/50"
              />
            </div>
          )}

          {!editing && contractor.notes && (
            <p className="mt-3 text-sm text-muted-foreground italic">{contractor.notes}</p>
          )}
        </div>

        {/* Log time */}
        <div className="flex justify-end">
          <Button size="sm" variant="outline" onClick={() => setLogTime((v) => !v)}>
            {logTime ? "Cancel" : "+ Log Time"}
          </Button>
        </div>
        {logTime && id && (
          <LogTimeForm
            projectId=""
            contractorId={id}
            onClose={() => setLogTime(false)}
          />
        )}

        {/* Assigned tasks */}
        <div className="rounded-lg border bg-background overflow-hidden">
          <div className="px-5 py-3 border-b bg-muted/30">
            <h2 className="text-sm font-semibold">Assigned Tasks</h2>
          </div>
          {tasksLoading ? (
            <div className="p-5"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
          ) : tasks.length === 0 ? (
            <p className="p-5 text-sm text-muted-foreground">No tasks assigned.</p>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b">
                  <th className="text-left p-3 text-xs font-semibold text-muted-foreground uppercase">Task</th>
                  <th className="text-left p-3 text-xs font-semibold text-muted-foreground uppercase">Project</th>
                  <th className="text-left p-3 text-xs font-semibold text-muted-foreground uppercase">Status</th>
                  <th className="text-right p-3 text-xs font-semibold text-muted-foreground uppercase">Due</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((t) => {
                  const isOverdue = t.due_date && t.due_date < today && t.status !== "done";
                  return (
                    <tr
                      key={t.id}
                      className="border-b hover:bg-muted/20 cursor-pointer transition-colors"
                      onClick={() => navigate(`/hub/projects/${t.projects?.id}`)}
                    >
                      <td className="p-3 text-sm">{t.title}</td>
                      <td className="p-3 text-sm text-muted-foreground">{t.projects?.name ?? "—"}</td>
                      <td className="p-3"><StatusPill status={t.status} size="sm" /></td>
                      <td className={cn("p-3 text-right text-xs", isOverdue ? "text-red-400" : "text-muted-foreground")}>
                        {t.due_date ?? "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Time entries */}
        <div className="rounded-lg border bg-background overflow-hidden">
          <div className="px-5 py-3 border-b bg-muted/30">
            <h2 className="text-sm font-semibold">Time Entries</h2>
          </div>
          {timeEntries.length === 0 ? (
            <p className="p-5 text-sm text-muted-foreground">No time logged yet.</p>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b">
                  <th className="text-left p-3 text-xs font-semibold text-muted-foreground uppercase">Date</th>
                  <th className="text-left p-3 text-xs font-semibold text-muted-foreground uppercase">Project</th>
                  <th className="text-left p-3 text-xs font-semibold text-muted-foreground uppercase">Description</th>
                  <th className="text-right p-3 text-xs font-semibold text-muted-foreground uppercase">Hours</th>
                  <th className="text-right p-3 text-xs font-semibold text-muted-foreground uppercase">Cost</th>
                </tr>
              </thead>
              <tbody>
                {timeEntries.map((e) => (
                  <tr key={e.id} className="border-b">
                    <td className="p-3 text-sm text-muted-foreground">{e.date}</td>
                    <td className="p-3 text-sm">{(e as any).projects?.name ?? "—"}</td>
                    <td className="p-3 text-sm text-muted-foreground truncate max-w-xs">{e.description ?? "—"}</td>
                    <td className="p-3 text-right text-sm tabular-nums">{e.hours}</td>
                    <td className="p-3 text-right text-sm tabular-nums text-muted-foreground">
                      {e.cost != null ? `$${Number(e.cost).toFixed(0)}` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Activity */}
        <div className="rounded-lg border bg-background p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4">Activity</h2>
          <ActivityFeed entries={activity} emptyText="No activity recorded." />
        </div>
      </div>
    </HubLayout>
  );
}
