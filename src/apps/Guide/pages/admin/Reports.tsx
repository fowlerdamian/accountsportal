import { StatsCard } from "@guide/components/admin/StatsCard";
import { Button } from "@guide/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@guide/components/ui/select";
import { BarChart3, TrendingUp, Users, Target, AlertTriangle, Download, Loader2 } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, Legend } from "recharts";
import { useState, useMemo } from "react";
import { useInstructionSets, useBrands, useFeedback } from "@guide/hooks/use-supabase-query";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@guide/integrations/supabase/client";

function useStepViews() {
  return useQuery({
    queryKey: ["step_views_all"],
    queryFn: async () => {
      const { data, error } = await supabase.from("step_views").select("*");
      if (error) throw error;
      return data;
    },
  });
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
    const sessions = new Set(filtered.map(sv => sv.session_id));
    const completedSessions = new Set(
      filtered.filter(sv => sv.completed).map(sv => sv.session_id)
    );
    const completionRate = sessions.size > 0 ? Math.round((completedSessions.size / sessions.size) * 100) : 0;

    // Per-guide stats
    const guideStats = guides.map((g: any) => {
      const gViews = filtered.filter(sv => sv.instruction_set_id === g.id);
      const gSessions = new Set(gViews.map(sv => sv.session_id));
      const gCompleted = new Set(gViews.filter(sv => sv.completed).map(sv => sv.session_id));
      const ratings = feedbackItems.filter((f: any) => f.instruction_set_id === g.id && f.rating);
      const avgRating = ratings.length > 0 ? (ratings.reduce((s: number, f: any) => s + f.rating, 0) / ratings.length).toFixed(1) : '—';

      const brandViews: Record<string, number> = {};
      brands.forEach(b => {
        brandViews[b.key] = gViews.filter(sv => sv.brand_id === b.id).length;
      });

      return {
        id: g.id,
        title: g.title,
        product_code: g.product_code,
        totalViews: gViews.length,
        sessions: gSessions.size,
        completionRate: gSessions.size > 0 ? Math.round((gCompleted.size / gSessions.size) * 100) : 0,
        avgRating,
        brandViews,
      };
    });

    // Most viewed
    const mostViewed = guideStats.sort((a, b) => b.totalViews - a.totalViews)[0];

    // Brand comparison data
    const brandCompare = guideStats.filter(g => g.totalViews > 0).slice(0, 8).map(g => ({
      guide: g.title.length > 20 ? g.title.substring(0, 20) + '…' : g.title,
      ...g.brandViews,
    }));

    // Time series: group by date
    const byDate: Record<string, { views: number; completions: number }> = {};
    filtered.forEach(sv => {
      const d = new Date(sv.viewed_at).toLocaleDateString('en-AU', { month: 'short', day: 'numeric' });
      if (!byDate[d]) byDate[d] = { views: 0, completions: 0 };
      byDate[d].views++;
      if (sv.completed) byDate[d].completions++;
    });
    const timeSeries = Object.entries(byDate).map(([date, v]) => ({ date, ...v }));

    return {
      totalViews: filtered.length,
      sessions: sessions.size,
      completionRate,
      mostViewed,
      guideStats,
      brandCompare,
      timeSeries,
    };
  }, [stepViews, guides, brands, feedbackItems, period]);

  const exportCSV = () => {
    const header = "Guide,Product Code,Total Views,Sessions,Completion %,Avg Rating";
    const rows = stats.guideStats.map(g =>
      `"${g.title}","${g.product_code}",${g.totalViews},${g.sessions},${g.completionRate}%,${g.avgRating}`
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
      <div className="flex items-center justify-between">
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
        <StatsCard title="Total Views" value={stats.totalViews} subtitle="Selected period" icon={<BarChart3 className="w-5 h-5" />} />
        <StatsCard title="Unique Sessions" value={stats.sessions} icon={<Users className="w-5 h-5" />} />
        <StatsCard title="Avg Completion" value={`${stats.completionRate}%`} icon={<Target className="w-5 h-5" />} />
        <StatsCard title="Most Viewed" value={stats.mostViewed?.title?.substring(0, 15) || '—'} subtitle={stats.mostViewed ? `${stats.mostViewed.totalViews} views` : ''} icon={<TrendingUp className="w-5 h-5" />} />
        <StatsCard title="Guides" value={guides.length} icon={<AlertTriangle className="w-5 h-5" />} />
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
                {brands.map(b => (
                  <Bar key={b.key} dataKey={b.key} fill={b.primary_colour} radius={[4, 4, 0, 0]} />
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
                  <td className="p-3 text-center text-sm">{g.avgRating}</td>
                </tr>
              ))}
              {stats.guideStats.length === 0 && (
                <tr><td colSpan={5} className="p-8 text-center text-muted-foreground">No guides yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
