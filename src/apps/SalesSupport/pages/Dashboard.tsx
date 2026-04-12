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
  const map: Record<string, { icon: typeof Clock; class: string; label: string }> = {
    completed: { icon: CheckCircle, class: "text-green-400",  label: "Completed" },
    running:   { icon: Loader2,     class: "text-yellow-400 animate-spin", label: "Running" },
    failed:    { icon: AlertCircle, class: "text-red-400",    label: "Failed" },
    pending:   { icon: Clock,       class: "text-muted-foreground", label: "Pending" },
  };
  const { icon: Icon, class: cls, label } = map[status] ?? map.pending;
  return (
    <span className={cn("flex items-center gap-1 text-xs", cls)}>
      <Icon className="w-3.5 h-3.5" /> {label}
    </span>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data, isLoading } = useDashboardMetrics();
  const [triggering, setTriggering] = useState<string | null>(null);

  async function triggerJob(fnName: string) {
    setTriggering(fnName);
    try {
      await supabase.functions.invoke(fnName, { body: {} });
      qc.invalidateQueries({ queryKey: ["sales_dashboard_metrics"] });
    } finally {
      setTriggering(null);
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
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">Sales Support</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Lead research, enrichment, and call planning</p>
        </div>
        <div className="flex flex-wrap gap-2 justify-end">
          {[
            { fn: "sales-lead-discovery",    label: "Discover",      title: "Run lead discovery for all channels" },
            { fn: "sales-lead-enrichment",   label: "Enrich",        title: "Enrich new/researched leads" },
            { fn: "sales-cin7-sync",         label: "Cin7 Sync",     title: "Sync Cin7 order history & existing customers" },
            { fn: "sales-lead-scoring",      label: "Score",         title: "Rescore all enriched leads" },
            { fn: "sales-calllist-generate", label: "Call List",     title: "Generate today's call list" },
          ].map(({ fn, label, title }) => (
            <button key={fn} onClick={() => triggerJob(fn)} disabled={!!triggering} title={title}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90 transition-colors disabled:opacity-50">
              {triggering === fn ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Channel columns */}
      <div className="grid grid-cols-3 gap-5">
        {CHANNELS.map((ch) => {
          const colors  = CHANNEL_COLOR[ch];
          const metrics = data?.[ch] as any;

          return (
            <div
              key={ch}
              className={cn("rounded-xl border bg-card/50 p-4 space-y-4 cursor-pointer hover:border-foreground/20 transition-colors", colors.border)}
              onClick={() => navigate(`/apps/sales-support/${ch}/leads`)}
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
                        onClick={(e) => { e.stopPropagation(); navigate(`/apps/sales-support/${ch}/leads`); }}
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
        <div className="rounded-xl border border-border bg-card/50 overflow-hidden">
          <table className="w-full text-sm">
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
                    No research jobs yet — click "Discover" to run the first one.
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
