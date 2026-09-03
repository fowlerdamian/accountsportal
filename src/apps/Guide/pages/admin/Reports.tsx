import { StatsCard } from "@guide/components/admin/StatsCard";
import { Button } from "@guide/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@guide/components/ui/select";
import { Download, Loader2 } from "lucide-react";
import { ChartBarIcon, ChartLineIcon, UsersIcon, TargetIcon, TriangleAlertIcon } from "@portal/components/icons";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, Legend } from "recharts";
import { useState, useMemo } from "react";
import { useInstructionSets, useBrands, useFeedback } from "@guide/hooks/use-supabase-query";
import { palette } from "@portal/lib/palette";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@guide/integrations/supabase/client";
import { Tables } from "@guide/integrations/supabase/types";

function useStepViews() {
  return useQuery({
    queryKey: ["step_views_all"],
    queryFn: async () => {
      // PostgREST caps a single select at 1000 rows — page through everything
      // in the max reporting window (365 days) or stats silently undercount.
      const cutoff = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
      const pageSize = 1000;
      const all: Tables<"step_views">[] = [];
      for (let from = 0; ; from += pageSize) {
        const { data, error } = await supabase
          .from("step_views")
          .select("*")
          .gte("viewed_at", cutoff)
          .order("viewed_at", { ascending: true })
          .range(from, from + pageSize - 1);
        if (error) throw error;
        all.push(...data);
        if (data.length < pageSize) break;
      }
      return all;
    },
  });
}

/** Local calendar date as YYYY-MM-DD — stable grouping key regardless of locale. */
function isoDay(ts: string) {
  const d = new Date(ts);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** CSV cell: always quoted, embedded quotes doubled. */
const csvCell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

/**
 * Session completion. The viewer logs a step 0 / completed:false "opened" row
 * per session plus a completed:true row per step reached, so:
 *  - a session is any row's session_id (per guide);
 *  - a session is complete when it has a completed:true row whose step_number
 *    reaches the highest step number seen for that guide in the window.
 */
function sessionCompletion(rows: Tables<"step_views">[]) {
  const maxStep = new Map<string, number>();
  for (const r of rows) {
    if (r.step_number == null) continue;
    maxStep.set(r.instruction_set_id, Math.max(maxStep.get(r.instruction_set_id) ?? 0, r.step_number));
  }
  const sessions = new Set<string>();
  const completed = new Set<string>();
  for (const r of rows) {
    const key = `${r.instruction_set_id}:${r.session_id}`;
    sessions.add(key);
    const target = maxStep.get(r.instruction_set_id) ?? 0;
    if (r.completed && target > 0 && (r.step_number ?? 0) >= target) completed.add(key);
  }
  return { sessions, completed, maxStep };
}

export default function Reports() {
  const { data: guides = [], isLoading } = useInstructionSets();
  const { data: brands = [] } = useBrands();
  const { data: stepViews = [] } = useStepViews();
  const { data: feedbackItems = [] } = useFeedback();
  const [period, setPeriod] = useState("30");

  const stats = useMemo(() => {
    const now = new Date();
    const daysAgo = parseInt(period);
    const cutoff = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
    const filtered = stepViews.filter(sv => new Date(sv.viewed_at) >= cutoff);

    const overall = sessionCompletion(filtered);
    const uniqueSessions = new Set(filtered.map(sv => sv.session_id));
    const completionRate = overall.sessions.size > 0 ? Math.round((overall.completed.size / overall.sessions.size) * 100) : 0;

    // Per-guide stats
    const guideStats = guides.map((g: any) => {
      const gViews = filtered.filter(sv => sv.instruction_set_id === g.id);
      const gc = sessionCompletion(gViews);
      const gFeedback = feedbackItems.filter((f: any) => f.instruction_set_id === g.id);
      const ratings = gFeedback.filter((f: any) => f.rating);
      const avgRating = ratings.length > 0 ? (ratings.reduce((s: number, f: any) => s + f.rating, 0) / ratings.length).toFixed(1) : '—';

      const brandViews: Record<string, number> = {};
      brands.forEach(b => {
        brandViews[b.key] = gViews.filter(sv => sv.brand_id === b.id).length;
      });

      return {
        id: g.id,
        title: g.title as string,
        product_code: g.product_code as string,
        totalViews: gViews.length,
        sessions: gc.sessions.size,
        completionRate: gc.sessions.size > 0 ? Math.round((gc.completed.size / gc.sessions.size) * 100) : 0,
        reviews: gFeedback.length,
        avgRating,
        brandViews,
      };
    });

    // Most viewed — copy before sorting (useMemo must not mutate), and only
    // report a guide that actually has views.
    const byViews = [...guideStats].sort((a, b) => b.totalViews - a.totalViews);
    const mostViewed = byViews[0] && byViews[0].totalViews > 0 ? byViews[0] : undefined;

    // Brand comparison data
    const brandCompare = byViews.filter(g => g.totalViews > 0).slice(0, 8).map(g => ({
      guide: g.title.length > 20 ? g.title.substring(0, 20) + '…' : g.title,
      ...g.brandViews,
    }));

    // Time series: group by ISO day so ordering is chronological, then format
    // the label for display.
    const byDate: Record<string, { views: number; completions: number }> = {};
    filtered.forEach(sv => {
      const d = isoDay(sv.viewed_at);
      if (!byDate[d]) byDate[d] = { views: 0, completions: 0 };
      byDate[d].views++;
      if (sv.completed) byDate[d].completions++;
    });
    const timeSeries = Object.keys(byDate).sort().map((iso) => ({
      date: new Date(`${iso}T00:00:00`).toLocaleDateString('en-AU', { month: 'short', day: 'numeric' }),
      ...byDate[iso],
    }));

    return {
      totalViews: filtered.length,
      sessions: uniqueSessions.size,
      completionRate,
      mostViewed,
      guideStats,
      brandCompare,
      timeSeries,
    };
  }, [stepViews, guides, brands, feedbackItems, period]);

  const exportCSV = () => {
    const header = "Guide,Product Code,Total Views,Sessions,Completion %,Reviews,Avg Rating";
    const rows = stats.guideStats.map(g =>
      [csvCell(g.title), csvCell(g.product_code), g.totalViews, g.sessions, `${g.completionRate}%`, g.reviews, g.avgRating].join(",")
    );
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `guide-report-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Reports</h1>
          <p className="text-muted-foreground text-sm">Guide engagement and performance analytics</p>
        </div>
        <div className="flex gap-2">
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
              <SelectItem value="365">Last year</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={exportCSV}><Download className="w-4 h-4 mr-2" /> Export CSV</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <StatsCard title="Total Views" value={stats.totalViews} subtitle="Selected period" icon={<ChartBarIcon className="w-5 h-5" />} />
        <StatsCard title="Unique Sessions" value={stats.sessions} icon={<UsersIcon className="w-5 h-5" />} />
        <StatsCard title="Avg Completion" value={`${stats.completionRate}%`} subtitle="Sessions reaching the last step" icon={<TargetIcon className="w-5 h-5" />} />
        <StatsCard title="Most Viewed" value={stats.mostViewed?.title?.substring(0, 15) || '—'} subtitle={stats.mostViewed ? `${stats.mostViewed.totalViews} views` : 'No views yet'} icon={<ChartLineIcon className="w-5 h-5" />} />
        <StatsCard title="Guides" value={guides.length} icon={<TriangleAlertIcon className="w-5 h-5" />} />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="bg-card rounded-lg border p-5">
          <h3 className="font-semibold mb-4">Views Over Time</h3>
          {stats.timeSeries.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={stats.timeSeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="views" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="completions" stroke="hsl(var(--success))" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[280px] flex items-center justify-center text-sm text-muted-foreground">No view data yet</div>
          )}
        </div>

        <div className="bg-card rounded-lg border p-5">
          <h3 className="font-semibold mb-4">Brand Comparison</h3>
          {stats.brandCompare.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={stats.brandCompare}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="guide" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
                <Tooltip />
                <Legend />
                {brands.map((b, i) => (
                  <Bar key={b.key} dataKey={b.key} fill={palette.cat[i % palette.cat.length]} radius={[4, 4, 0, 0]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[280px] flex items-center justify-center text-sm text-muted-foreground">No view data yet</div>
          )}
        </div>
      </div>

      {/* Guide performance table */}
      <div className="bg-card rounded-lg border">
        <div className="p-4 border-b"><h3 className="font-semibold">Guide Performance</h3></div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left p-3 text-xs font-semibold text-muted-foreground uppercase">Guide</th>
                <th className="text-right p-3 text-xs font-semibold text-muted-foreground uppercase">Views</th>
                <th className="text-right p-3 text-xs font-semibold text-muted-foreground uppercase">Sessions</th>
                <th className="text-right p-3 text-xs font-semibold text-muted-foreground uppercase">Completion %</th>
                <th className="text-right p-3 text-xs font-semibold text-muted-foreground uppercase">Reviews</th>
                <th className="text-center p-3 text-xs font-semibold text-muted-foreground uppercase">Avg Rating</th>
              </tr>
            </thead>
            <tbody>
              {stats.guideStats.map(g => (
                <tr key={g.id} className="border-b hover:bg-muted/30">
                  <td className="p-3">
                    <span className="font-medium text-sm">{g.title}</span>
                    <code className="text-xs text-muted-foreground ml-2">{g.product_code}</code>
                  </td>
                  <td className="p-3 text-right text-sm">{g.totalViews}</td>
                  <td className="p-3 text-right text-sm">{g.sessions}</td>
                  <td className="p-3 text-right text-sm">{g.completionRate}%</td>
                  <td className="p-3 text-right text-sm">{g.reviews}</td>
                  <td className="p-3 text-center text-sm">{g.avgRating}</td>
                </tr>
              ))}
              {stats.guideStats.length === 0 && (
                <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">No guides yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
