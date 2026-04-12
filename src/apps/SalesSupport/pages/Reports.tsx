import { useOutletContext } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import {
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { cn } from "../../../apps/Guide/lib/utils";
import { supabase } from "../../../lib/supabase";
import { CHANNEL_LABEL, type Channel } from "../lib/constants";

const CHART_COLORS = ["#f3ca0f", "#4fc3f7", "#ef5350", "#66bb6a", "#ab47bc", "#ffa726"];

const TOOLTIP_STYLE = {
  contentStyle: { background: "#1a1a1a", border: "1px solid #333", borderRadius: 8, fontSize: 12 },
  labelStyle:   { color: "#aaa" },
};

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">{children}</h3>
  );
}

function ChartCard({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-xl border border-border bg-card/50 p-4", className)}>
      <div className="text-sm font-medium mb-4">{title}</div>
      {children}
    </div>
  );
}

export default function Reports() {
  const { channel } = useOutletContext<{ channel: Channel }>();

  const { data, isLoading } = useQuery({
    queryKey: ["sales_reports", channel],
    queryFn: async () => {
      const now      = new Date();
      const weekAgo  = new Date(now.getTime() - 7 * 86400000).toISOString();
      const fourWeeks = Array.from({ length: 8 }, (_, i) => {
        const d = new Date(now.getTime() - i * 7 * 86400000);
        return d.toISOString().split("T")[0];
      }).reverse();

      const [leadsRes, callsRes, winbackRes, jobsRes] = await Promise.all([
        supabase.from("sales_leads").select("id, status, lead_score, created_at, is_existing_customer, discovery_source").eq("channel", channel),
        supabase.from("call_list").select("id, call_outcome, is_complete, called_at, scheduled_date").eq("channel", channel),
        channel === "trailbait"
          ? supabase.from("trailbait_order_history").select("*").order("last_synced", { ascending: false }).limit(200)
          : Promise.resolve({ data: [] }),
        supabase.from("research_jobs").select("*").eq("channel", channel).order("created_at", { ascending: false }).limit(50),
      ]);

      const leads = leadsRes.data ?? [];
      const calls = callsRes.data ?? [];
      const winbacks = (winbackRes as any).data ?? [];
      const jobs  = jobsRes.data ?? [];

      // Score distribution histogram (buckets of 10)
      const scoreBuckets: Record<string, number> = {};
      for (let i = 0; i <= 90; i += 10) scoreBuckets[`${i}-${i + 9}`] = 0;
      for (const l of leads) {
        const bucket = Math.floor(l.lead_score / 10) * 10;
        const key = `${bucket}-${bucket + 9}`;
        if (scoreBuckets[key] !== undefined) scoreBuckets[key]++;
      }
      const scoreDistribution = Object.entries(scoreBuckets).map(([range, count]) => ({ range, count }));

      // Leads per week (last 8 weeks)
      const leadsPerWeek = fourWeeks.slice(0, -1).map((weekStart, i) => {
        const weekEnd = fourWeeks[i + 1];
        const count   = leads.filter((l) => l.created_at >= weekStart && l.created_at < weekEnd).length;
        const label   = new Date(weekStart).toLocaleDateString("en-AU", { day: "numeric", month: "short" });
        return { week: label, count };
      });

      // Conversion funnel
      const funnel = [
        { name: "Discovered",  value: leads.filter((l) => l.status !== "disqualified").length },
        { name: "Enriched",    value: leads.filter((l) => ["enriched","queued","contacted","converted"].includes(l.status)).length },
        { name: "Contacted",   value: leads.filter((l) => ["contacted","converted"].includes(l.status)).length },
        { name: "Deal Created",value: leads.filter((l) => l.status === "contacted").length },
        { name: "Won",         value: leads.filter((l) => l.status === "converted").length },
      ];

      // Call outcomes pie
      const outcomeCounts: Record<string, number> = {};
      for (const c of calls.filter((c) => c.call_outcome)) {
        outcomeCounts[c.call_outcome!] = (outcomeCounts[c.call_outcome!] ?? 0) + 1;
      }
      const callOutcomes = Object.entries(outcomeCounts).map(([name, value]) => ({
        name: name.replace(/_/g, " "),
        value,
      }));

      // Calls per day (last 14 days)
      const callsPerDay = Array.from({ length: 14 }, (_, i) => {
        const d     = new Date(now.getTime() - (13 - i) * 86400000);
        const key   = d.toISOString().split("T")[0];
        const label = d.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
        const made  = calls.filter((c) => c.scheduled_date === key && c.is_complete).length;
        const total = calls.filter((c) => c.scheduled_date === key).length;
        return { date: label, made, total };
      });

      // Job success rate
      const jobSuccessRate = jobs.length
        ? Math.round((jobs.filter((j) => j.status === "completed").length / jobs.length) * 100)
        : 0;

      // TrailBait-specific: winback candidates + order value distribution
      const winbackCount = winbacks.filter((w: any) => w.is_winback_candidate).length;
      const orderDistrib  = ["0-500","500-1000","1000-2000","2000-5000","5000+"].map((range) => {
        const [lo, hi] = range.split("-").map(Number);
        return {
          range,
          count: winbacks.filter((w: any) => {
            const v = w.average_order_value ?? 0;
            return hi ? v >= lo && v < hi : v >= lo;
          }).length,
        };
      });

      // FleetCraft: tender vs search
      const tenderLeads = leads.filter((l) => l.discovery_source === "news_tender").length;
      const searchLeads = leads.filter((l) => l.discovery_source !== "news_tender").length;

      return {
        scoreDistribution,
        leadsPerWeek,
        funnel,
        callOutcomes,
        callsPerDay,
        jobSuccessRate,
        totalLeads: leads.length,
        totalCalls: calls.filter((c) => c.is_complete).length,
        winbackCount,
        orderDistrib,
        tenderLeads,
        searchLeads,
      };
    },
    staleTime: 60_000,
  });

  if (isLoading) {
    return <div className="flex justify-center py-20"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;
  }

  if (!data) {
    return <div className="py-20 text-center text-sm text-muted-foreground">No report data available yet.</div>;
  }

  const d = data;

  return (
    <div className="space-y-8 animate-fade-in">
      <div>
        <h2 className="text-lg font-semibold">{CHANNEL_LABEL[channel]} Reports</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          {d?.totalLeads ?? 0} leads · {d?.totalCalls ?? 0} calls made · {d?.jobSuccessRate ?? 0}% job success rate
        </p>
      </div>

      {/* Row 1: Leads over time + Score distribution */}
      <div className="grid grid-cols-2 gap-5">
        <ChartCard title="New Leads Discovered (Weekly)">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={d?.leadsPerWeek ?? []} margin={{ left: -10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#333" />
              <XAxis dataKey="week" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip {...TOOLTIP_STYLE} />
              <Bar dataKey="count" fill="#f3ca0f" radius={[3, 3, 0, 0]} maxBarSize={32} name="Leads" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Lead Score Distribution">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={d?.scoreDistribution ?? []} margin={{ left: -10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#333" />
              <XAxis dataKey="range" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip {...TOOLTIP_STYLE} />
              <Bar dataKey="count" fill="#4fc3f7" radius={[3, 3, 0, 0]} maxBarSize={28} name="Leads" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Row 2: Conversion funnel + Call outcomes */}
      <div className="grid grid-cols-2 gap-5">
        <ChartCard title="Conversion Funnel">
          <div className="space-y-2">
            {(d?.funnel ?? []).map((step, i) => {
              const pct = d?.funnel[0]?.value ? Math.round((step.value / d.funnel[0].value) * 100) : 0;
              return (
                <div key={step.name} className="space-y-0.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">{step.name}</span>
                    <span className="tabular-nums font-medium">{step.value} <span className="text-muted-foreground">({pct}%)</span></span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{
                        width:      `${pct}%`,
                        background: CHART_COLORS[i % CHART_COLORS.length],
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </ChartCard>

        <ChartCard title="Call Outcomes">
          {(d?.callOutcomes ?? []).length === 0 ? (
            <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">No calls recorded yet</div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={d?.callOutcomes ?? []} cx="50%" cy="50%" outerRadius={75} dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                  {(d?.callOutcomes ?? []).map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip {...TOOLTIP_STYLE} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      {/* Row 3: Daily call activity */}
      <ChartCard title="Daily Call Activity (Last 14 Days)">
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={d?.callsPerDay ?? []} margin={{ left: -10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#333" />
            <XAxis dataKey="date" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip {...TOOLTIP_STYLE} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="total" fill="#4fc3f7" radius={[3, 3, 0, 0]} maxBarSize={20} name="Scheduled" opacity={0.4} />
            <Bar dataKey="made"  fill="#66bb6a" radius={[3, 3, 0, 0]} maxBarSize={20} name="Completed" />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* Channel-specific extras */}
      {channel === "trailbait" && (
        <div className="grid grid-cols-2 gap-5">
          <ChartCard title="Win-back Candidates">
            <div className="flex items-center gap-4 py-4">
              <div className="text-5xl font-bold text-red-400 tabular-nums">{d?.winbackCount ?? 0}</div>
              <div className="text-sm text-muted-foreground">
                distributors with no order<br />in the last 30 days
              </div>
            </div>
          </ChartCard>

          <ChartCard title="Distributor Avg Order Value Spread">
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={d?.orderDistrib ?? []} margin={{ left: -10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                <XAxis dataKey="range" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip {...TOOLTIP_STYLE} />
                <Bar dataKey="count" fill="#f3ca0f" radius={[3, 3, 0, 0]} maxBarSize={28} name="Distributors" />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>
      )}

      {channel === "fleetcraft" && (
        <ChartCard title="Lead Source: Tender News vs General Search">
          <div className="flex items-center gap-8 py-4">
            {[
              { label: "Tender / Contract News", value: d?.tenderLeads ?? 0, color: "text-blue-400" },
              { label: "General Search",          value: d?.searchLeads ?? 0, color: "text-primary" },
            ].map(({ label, value, color }) => (
              <div key={label}>
                <div className={cn("text-4xl font-bold tabular-nums", color)}>{value}</div>
                <div className="text-sm text-muted-foreground mt-1">{label}</div>
              </div>
            ))}
          </div>
        </ChartCard>
      )}
    </div>
  );
}
