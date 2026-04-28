import { useNavigate } from "react-router-dom";
import { Loader2, TrendingUp, Phone, Users, RotateCcw, AlertCircle, CheckCircle, Clock } from "lucide-react";
import { cn } from "../../../apps/Guide/lib/utils";
import { useDashboardMetrics } from "../hooks/useSalesQueries";
import { CHANNEL_LABEL, CHANNEL_COLOR, CHANNEL_DESCRIPTION, CHANNELS, type Channel } from "../lib/constants";
import { LeadScoreBadge } from "../components/LeadScoreBadge";
import { supabase } from "../../../lib/supabase";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-muted/30 rounded-lg p-3">
      <div className="text-xl font-bold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
      {sub && <div className="text-xs text-muted-foreground/60 mt-0.5">{sub}</div>}
    </div>
  );
}

function JobStatusBadge({ status }: { status: string }) {
  const map: Record<string, { icon: typeof Clock; textClass: string; iconClass: string; label: string }> = {
    completed: { icon: CheckCircle, textClass: "text-green-400",        iconClass: "",             label: "Completed" },
    running:   { icon: Loader2,     textClass: "text-yellow-400",       iconClass: "",             label: "Running"   },
    failed:    { icon: AlertCircle, textClass: "text-red-400",          iconClass: "",             label: "Failed"    },
    pending:   { icon: Clock,       textClass: "text-muted-foreground", iconClass: "",             label: "Pending"   },
  };
  const { icon: Icon, textClass, iconClass, label } = map[status] ?? map.pending;
  return (
    <span className={cn("flex items-center gap-1 text-xs", textClass)}>
      <span className={cn("inline-flex flex-shrink-0", iconClass)}>
        <Icon className="w-3.5 h-3.5" />
      </span>
      {label}
    </span>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data, isLoading } = useDashboardMetrics();
  const [activeSync, setActiveSync] = useState<string | null>(null);
  const [syncStep, setSyncStep]     = useState<string>("");
  const [syncError, setSyncError]   = useState<string | null>(null);

  async function runResearch() {
    setActiveSync("research");
    setSyncError(null);
    try {
      setSyncStep("Discovering leads…");
      const r1 = await supabase.functions.invoke("sales-lead-discovery", { body: {} });
      if (r1.error) throw new Error(r1.error.message);
      for (const channel of ["trailbait", "fleetcraft", "aga"] as const) {
        setSyncStep(`Enriching ${channel}…`);
        const r2 = await supabase.functions.invoke("sales-lead-enrichment", { body: { channel } });
        if (r2.error) throw new Error(r2.error.message);
        setSyncStep(`Scoring ${channel}…`);
        const r3 = await supabase.functions.invoke("sales-lead-scoring", { body: { channel } });
        if (r3.error) throw new Error(r3.error.message);
      }
      qc.invalidateQueries({ queryKey: ["sales_dashboard_metrics"] });
      qc.invalidateQueries({ queryKey: ["sales_leads"] });
    } catch (err: unknown) {
      setSyncError((err as Error).message ?? "Research sync failed");
    } finally {
      setActiveSync(null);
      setSyncStep("");
    }
  }

  async function runListSync() {
    setActiveSync("list");
    setSyncError(null);
    try {
      setSyncStep("Deduplicating leads…");
      const r1 = await supabase.functions.invoke("sales-lead-dedup", { body: {} });
      if (r1.error) throw new Error(r1.error.message);
      setSyncStep("Scoring leads…");
      const r2 = await supabase.functions.invoke("sales-lead-scoring", { body: {} });
      if (r2.error) throw new Error(r2.error.message);
      setSyncStep("Enriching HubSpot records…");
      const r3 = await supabase.functions.invoke("sales-hubspot-sync", { body: { action: "back_sync" } });
      if (r3.error) throw new Error(r3.error.message);
      setSyncStep("Generating call list…");
      const r4 = await supabase.functions.invoke("sales-calllist-generate", { body: {} });
      if (r4.error) throw new Error(r4.error.message);
      qc.invalidateQueries({ queryKey: ["sales_dashboard_metrics"] });
      qc.invalidateQueries({ queryKey: ["sales_leads"] });
      qc.invalidateQueries({ queryKey: ["call_list"] });
    } catch (err: unknown) {
      setSyncError((err as Error).message ?? "List sync failed");
    } finally {
      setActiveSync(null);
      setSyncStep("");
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="p-6">
    <div className="max-w-7xl mx-auto space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Sales Support</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Lead research, enrichment, and call planning</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={runResearch}
            disabled={!!activeSync}
            title="Discover new leads, enrich, then score"
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {activeSync === "research"
              ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /><span>{syncStep}</span></>
              : <><RotateCcw className="w-3.5 h-3.5" /><span>Research</span></>}
          </button>
          <button
            onClick={runListSync}
            disabled={!!activeSync}
            title="Sync Cin7 order data then generate today's call list"
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-muted text-foreground rounded hover:bg-muted/70 transition-colors disabled:opacity-50 border border-border"
          >
            {activeSync === "list"
              ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /><span>{syncStep}</span></>
              : <><RotateCcw className="w-3.5 h-3.5" /><span>List</span></>}
          </button>
        </div>
      </div>

      {syncError && (
        <div className="flex items-center gap-2 px-3 py-2 rounded bg-destructive/10 border border-destructive/30 text-destructive text-xs">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
          {syncError}
        </div>
      )}

      {/* Channel columns */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {CHANNELS.map((ch) => {
          const colors  = CHANNEL_COLOR[ch];
          const metrics = data?.[ch] as any;

          return (
            <div
              key={ch}
              className={cn("rounded-xl border bg-card/50 p-4 space-y-4 cursor-pointer hover:border-foreground/20 transition-colors", colors.border)}
              onClick={() => navigate(`/sales-support/${ch}/leads`)}
            >
              {/* Channel heading */}
              <div className={cn("inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-semibold border", colors.bg, colors.text, colors.border)}>
                {CHANNEL_LABEL[ch]}
              </div>
              <p className="text-xs text-muted-foreground -mt-2">{CHANNEL_DESCRIPTION[ch]}</p>

              {/* Stats */}
              <div className="grid grid-cols-2 gap-2">
                <StatCard label="Total leads" value={metrics?.totalLeads ?? 0} />
                <StatCard label="New this week" value={metrics?.newThisWeek ?? 0} />
                <StatCard
                  label="Calls today"
                  value={`${metrics?.callsDone ?? 0}/${metrics?.callsToday ?? 0}`}
                  sub="done / total"
                />
                {ch === "trailbait" && (
                  <StatCard
                    label="Win-backs"
                    value={(metrics as any)?.winbacks ?? 0}
                    sub="awaiting contact"
                  />
                )}
              </div>

              {/* Top 3 leads */}
              {metrics?.top3Leads?.length > 0 && (
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Hot Leads</div>
                  <div className="space-y-1.5">
                    {metrics.top3Leads.map((l: any) => (
                      <div
                        key={l.id}
                        onClick={(e) => { e.stopPropagation(); navigate(`/sales-support/${ch}/leads`); }}
                        className="flex items-center justify-between gap-2 p-2 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors cursor-pointer"
                      >
                        <span className="text-sm font-medium truncate">{l.company_name}</span>
                        <LeadScoreBadge score={l.lead_score} size="sm" />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Research job status */}
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">Recent Research Jobs</h2>
        <div className="rounded-xl border border-border bg-card/50 overflow-x-auto">
          <table className="w-full text-sm min-w-[380px]">
            <thead>
              <tr className="border-b border-border">
                {["Channel", "Type", "Status", "Leads Found", "Started"].map((h) => (
                  <th key={h} className="text-left text-xs text-muted-foreground font-medium px-4 py-2.5">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(data?.recentJobs ?? []).length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground text-sm">
                    No research jobs yet — click "Research" to run the first one.
                  </td>
                </tr>
              ) : (data?.recentJobs ?? []).map((job: any) => (
                <tr key={job.id} className="border-b border-border/50 last:border-0 hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-2.5 font-medium capitalize">{CHANNEL_LABEL[job.channel as Channel]}</td>
                  <td className="px-4 py-2.5 text-muted-foreground capitalize">{job.job_type.replace(/_/g, " ")}</td>
                  <td className="px-4 py-2.5"><JobStatusBadge status={job.status} /></td>
                  <td className="px-4 py-2.5 tabular-nums">{job.leads_found ?? 0}</td>
                  <td className="px-4 py-2.5 text-muted-foreground text-xs">
                    {job.started_at ? new Date(job.started_at).toLocaleString("en-AU", { dateStyle: "short", timeStyle: "short" }) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
    </div>
  );
}
