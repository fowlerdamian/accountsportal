import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { cn } from "@guide/lib/utils";
import { FilterPill } from "@portal/components/FilterPill";
import { useAuth } from "../../../context/AuthContext.jsx";
import {
  useStaffTasks,
  useStaffProfiles,
} from "../hooks/use-task-queries";
import { quadrantOf, QUADRANT_LABEL, type Quadrant } from "../lib/eisenhower";
import { scoreFor, statsForDay, localDay, lastNDays } from "../lib/score";
import { palette } from "@portal/lib/palette";

const GOLD = palette.accent;

const STATUS_COLORS: Record<string, string> = {
  "Not Started": "#888888",
  "In Progress": palette.blue,
  "Blocked":     palette.pink,
  "Done":        palette.aqua,
};

const QUADRANT_COLORS: Record<Quadrant, string> = {
  do:       palette.pink,
  schedule: GOLD,
  delegate: palette.blue,
  drop:     "#888888",
};

const TOOLTIP_STYLE = {
  contentStyle: { background: "#1a1a1a", border: "1px solid #333", borderRadius: 8, fontSize: 12 },
  labelStyle:   { color: "#aaa" },
};

const AXIS = { stroke: "#555", fontSize: 11 };

function shortDay(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}

function scoreColor(score: number): string {
  if (score >= 8) return palette.aqua;
  if (score >= 5) return GOLD;
  return palette.pink;
}

function KpiCard({ label, value, accent }: { label: string; value: React.ReactNode; accent?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card/50 p-4">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">{label}</div>
      <div className="text-2xl font-semibold tabular-nums" style={accent ? { color: accent } : undefined}>
        {value}
      </div>
    </div>
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

export function TasksReporting() {
  const { user } = useAuth();
  const userId   = user?.id ?? "";

  const [scope, setScope] = useState<"mine" | "all">("mine");

  // One unfiltered fetch — the leaderboard always needs everyone, and the
  // scope toggle just narrows the pool client-side.
  const { data: allTasks = [], isLoading } = useStaffTasks({});
  const { data: profiles = [] }            = useStaffProfiles();

  const pool = useMemo(
    () => (scope === "mine" ? allTasks.filter((t) => t.assigned_to === userId) : allTasks),
    [allTasks, scope, userId],
  );

  const days   = useMemo(() => lastNDays(14), []);
  const today  = days[days.length - 1];
  const weekAgo = days[days.length - 7];

  const todayStats = useMemo(() => statsForDay(pool, today), [pool, today]);
  const todayScore = scoreFor(todayStats);

  const open    = pool.filter((t) => t.status !== "done");
  const overdue = open.filter((t) => t.due_date && t.due_date < today);
  const doneThisWeek = pool.filter((t) => {
    const d = t.status === "done" ? localDay(t.completed_at) : null;
    return d !== null && d >= weekAgo;
  });

  // 14-day score trend — same formula the 5pm Google Chat report uses
  const scoreTrend = useMemo(
    () => days.map((day) => ({ date: shortDay(day), score: scoreFor(statsForDay(pool, day)) })),
    [pool, days],
  );

  // Created vs completed per day
  const throughput = useMemo(
    () => days.map((day) => ({
      date:      shortDay(day),
      created:   pool.filter((t) => localDay(t.created_at) === day).length,
      completed: pool.filter((t) => t.status === "done" && localDay(t.completed_at) === day).length,
    })),
    [pool, days],
  );

  // Status breakdown (current)
  const statusPie = useMemo(() => {
    const counts: Record<string, number> = { "Not Started": 0, "In Progress": 0, "Blocked": 0, "Done": 0 };
    for (const t of pool) {
      if (t.status === "not_started") counts["Not Started"]++;
      else if (t.status === "in_progress") counts["In Progress"]++;
      else if (t.status === "blocked") counts["Blocked"]++;
      else counts["Done"]++;
    }
    return Object.entries(counts).filter(([, v]) => v > 0).map(([name, value]) => ({ name, value }));
  }, [pool]);

  // Eisenhower quadrant breakdown of open tasks
  const quadrantPie = useMemo(() => {
    const counts: Record<Quadrant, number> = { do: 0, schedule: 0, delegate: 0, drop: 0 };
    for (const t of open) counts[quadrantOf(t.urgency, t.importance)]++;
    return (Object.keys(counts) as Quadrant[])
      .filter((q) => counts[q] > 0)
      .map((q) => ({ name: QUADRANT_LABEL[q], value: counts[q], quadrant: q }));
  }, [open]);

  // Leaderboard — completions this week, always team-wide. Seeded from the
  // full staff list so everyone shows, zeros included.
  const leaderboard = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of allTasks) {
      const d = t.status === "done" ? localDay(t.completed_at) : null;
      if (d === null || d < weekAgo) continue;
      counts.set(t.assigned_to, (counts.get(t.assigned_to) ?? 0) + 1);
    }
    return profiles
      .map((p) => ({
        name:      p.full_name ?? p.email ?? p.id.slice(0, 8),
        completed: counts.get(p.id) ?? 0,
      }))
      .sort((a, b) => b.completed - a.completed || a.name.localeCompare(b.name));
  }, [allTasks, profiles, weekAgo]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-fade-in">

      {/* Scope toggle */}
      <div className="flex items-center gap-1 flex-wrap">
        <FilterPill active={scope === "mine"} onClick={() => setScope("mine")}>My report</FilterPill>
        <FilterPill active={scope === "all"} onClick={() => setScope("all")}>Team report</FilterPill>
        <span className="ml-auto text-[11px] text-muted-foreground/60">
          Score matches the 5pm Google Chat daily report
        </span>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label="Today's score" value={`${todayScore}/10`} accent={scoreColor(todayScore)} />
        <KpiCard label="Open tasks" value={open.length} />
        <KpiCard label="Overdue" value={overdue.length} accent={overdue.length > 0 ? "var(--brand-pink)" : "var(--brand-aqua)"} />
        <KpiCard label="Completed this week" value={doneThisWeek.length} accent="var(--brand-aqua)" />
      </div>

      {/* Score trend */}
      <ChartCard title="Daily score — last 14 days">
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={scoreTrend} margin={{ top: 4, right: 8, left: -24, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#222" />
            <XAxis dataKey="date" {...AXIS} />
            <YAxis domain={[0, 10]} ticks={[0, 2, 4, 6, 8, 10]} {...AXIS} />
            <Tooltip {...TOOLTIP_STYLE} />
            <Line type="monotone" dataKey="score" stroke={GOLD} strokeWidth={2} dot={{ r: 2.5, fill: GOLD }} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Throughput */}
        <ChartCard title="Created vs completed — last 14 days">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={throughput} margin={{ top: 4, right: 8, left: -24, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#222" />
              <XAxis dataKey="date" {...AXIS} />
              <YAxis allowDecimals={false} {...AXIS} />
              <Tooltip {...TOOLTIP_STYLE} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="created"   name="Created"   fill={palette.blue} radius={[3, 3, 0, 0]} />
              <Bar dataKey="completed" name="Completed" fill={palette.aqua} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Leaderboard */}
        <ChartCard title="Team leaderboard — completed this week">
          {leaderboard.length === 0 ? (
            <p className="text-muted-foreground text-sm py-8 text-center">No staff profiles found.</p>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(220, leaderboard.length * 28)}>
              <BarChart data={leaderboard} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#222" horizontal={false} />
                <XAxis type="number" allowDecimals={false} {...AXIS} />
                <YAxis type="category" dataKey="name" width={110} interval={0} {...AXIS} />
                <Tooltip {...TOOLTIP_STYLE} />
                <Bar dataKey="completed" name="Completed" fill={GOLD} radius={[0, 3, 3, 0]} barSize={14} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        {/* Status pie */}
        <ChartCard title="Status breakdown">
          {statusPie.length === 0 ? (
            <p className="text-muted-foreground text-sm py-8 text-center">No tasks yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={statusPie} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={2}>
                  {statusPie.map((s) => <Cell key={s.name} fill={STATUS_COLORS[s.name]} />)}
                </Pie>
                <Tooltip {...TOOLTIP_STYLE} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        {/* Quadrant pie */}
        <ChartCard title="Open tasks by Eisenhower quadrant">
          {quadrantPie.length === 0 ? (
            <p className="text-muted-foreground text-sm py-8 text-center">No open tasks.</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={quadrantPie} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={2}>
                  {quadrantPie.map((q) => <Cell key={q.name} fill={QUADRANT_COLORS[q.quadrant as Quadrant]} />)}
                </Pie>
                <Tooltip {...TOOLTIP_STYLE} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>
    </div>
  );
}
