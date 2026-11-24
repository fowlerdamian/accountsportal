import { useState, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import type { Case, CaseType } from '@/lib/types';
import { calculateBusinessDaysOpen } from '@/lib/businessDays';
import { Download } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie, Label,
  LineChart, Line, Legend,
} from 'recharts';
import {
  format, startOfMonth, endOfMonth, addMonths,
  eachDayOfInterval, eachWeekOfInterval, eachMonthOfInterval,
  startOfDay, startOfWeek as _startOfWeek,
} from 'date-fns';
import { palette } from '@portal/lib/palette';
// Same period model as the Accounts app (Finance Dashboard / Sales Mix):
// a grain (Month / Rolling 12M / Calendar Year / Financial Year) + an anchor.
import { GRAINS, buildOptions, periodKeys, ymParts } from '@portal/apps/Accounts/finance/periods.js';

// ── Types ─────────────────────────────────────────────────────────────────────

type Grain = 'month' | 'r12' | 'cy' | 'fy';
type Granularity = 'daily' | 'weekly' | 'monthly';

type ExtendedCategory =
  | 'warranty_claim' | 'order_entry_error' | 'warehouse_error'
  | 'freight_issue' | 'complaint' | 'general';

// ── Constants ─────────────────────────────────────────────────────────────────

const EXTENDED_LABELS: Record<ExtendedCategory, string> = {
  warranty_claim:    'Warranty Claim',
  order_entry_error: 'Order Entry Error',
  warehouse_error:   'Warehouse Error',
  freight_issue:     'Freight Issue',
  complaint:         'Complaint',
  general:           'General Enquiry',
};

const EXTENDED_COLOURS: Record<ExtendedCategory, string> = {
  warranty_claim:    '#a0a0a0',       // grey
  order_entry_error: palette.orange,
  warehouse_error:   palette.purple,  // deep red
  freight_issue:     palette.blue,    // teal
  complaint:         palette.cat[4],  // cream — the brand aqua aliases the teal used by Freight
  general:           palette.pink,    // red
};

const STATUS_COLOURS: Record<string, string> = {
  open:     '#5A5A5A',
  actioned: palette.blue,
  in_hand:  palette.purple,
  closed:   palette.aqua,
};

const TOOLTIP_STYLE = {
  contentStyle: { backgroundColor: '#1E1E1E', border: '1px solid #2A2A2A', borderRadius: '2px', fontSize: '12px' },
  itemStyle:    { color: '#FFFFFF' },
  labelStyle:   { color: '#9A9A9A' },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function getExtendedCategory(c: { type: string; error_origin?: string | null }): ExtendedCategory {
  if (c.type === 'order_error') {
    return c.error_origin === 'warehouse' ? 'warehouse_error' : 'order_entry_error';
  }
  return c.type as ExtendedCategory;
}

// 'YYYY-MM' of a date, in local time (cases are bucketed by the local calendar).
const monthKey = (d: Date) => format(d, 'yyyy-MM');
const monthStart = (key: string) => { const { y, m } = ymParts(key); return new Date(y, m - 1, 1); };

// Every month-key from `from` through `to`, inclusive.
function monthKeysBetween(from: Date, to: Date): string[] {
  const out: string[] = [];
  for (let d = startOfMonth(from); d <= to; d = addMonths(d, 1)) out.push(monthKey(d));
  return out;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({ value, label, colour }: { value: string | number; label: string; colour?: string }) {
  return (
    <div className="bg-card border border-border px-4 py-3">
      <span className={cn('text-2xl font-heading', colour ?? 'text-foreground')}>{value}</span>
      <span className="text-xs text-muted-foreground uppercase tracking-wide font-heading block mt-0.5">{label}</span>
    </div>
  );
}

function TargetBar({ label, current, target, isCount, inverse }: {
  label: string; current: number; target: number; isCount?: boolean; inverse?: boolean;
}) {
  const pct = isCount ? Math.min((current / target) * 100, 100) : Math.min(current, 100);
  const isGood = inverse ? current <= target : (isCount ? current >= target : current >= target);
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className={cn('text-xs font-medium', isGood ? 'text-status-resolved' : 'text-status-urgent')}>
          {isCount ? `${current}/${target}` : `${current}%`}
        </span>
      </div>
      <div className="h-1.5 bg-border w-full">
        <div
          className={cn('h-full transition-all duration-500', isGood ? 'bg-status-resolved' : 'bg-status-urgent')}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  const [grain, setGrain]             = useState<Grain>('month');
  const [anchor, setAnchor]           = useState<string | null>(null);
  const [granularity, setGranularity] = useState<Granularity>('daily');

  const { data: cases = [], isLoading } = useQuery({
    queryKey: ['analytics-cases'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cases')
        .select('*')
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data as unknown as Case[];
    },
  });

  // Selectable periods run from the first case's month to the current month
  // (cases arrive sorted by created_at). Default anchor = the latest period.
  const firstCaseAt = cases[0]?.created_at;
  const options = useMemo(() => {
    const now = new Date();
    const keys = monthKeysBetween(firstCaseAt ? new Date(firstCaseAt) : now, now);
    return buildOptions(grain, keys) as { value: string; label: string }[];
  }, [grain, firstCaseAt]);
  const effAnchor = (anchor && options.some(o => o.value === anchor) ? anchor : null)
    ?? options[options.length - 1]?.value ?? monthKey(new Date());

  // The period's date window. `end` stops at now for a period still in progress,
  // so the trend chart doesn't trail off into empty future days.
  const { start, end } = useMemo(() => {
    const keys = periodKeys(grain, effAnchor) as string[];
    const now = new Date();
    const last = endOfMonth(monthStart(keys[keys.length - 1]));
    return { start: monthStart(keys[0]), end: last > now ? now : last };
  }, [grain, effAnchor]);

  // Period-filtered cases
  const periodCases = useMemo(() =>
    cases.filter(c => {
      const d = new Date(c.created_at);
      return d >= start && d <= end;
    }), [cases, start, end]);

  const closedPeriod = periodCases.filter(c => c.status === 'closed');

  // ── Summary stats ────────────────────────────────────────────────────────

  const avgResponseDays = useMemo(() => {
    const withResponse = periodCases.filter(c => c.status !== 'open');
    if (!withResponse.length) return 0;
    const total = withResponse.reduce((s, c) => s + calculateBusinessDaysOpen(new Date(c.created_at)), 0);
    return Math.round((total / withResponse.length) * 10) / 10;
  }, [periodCases]);

  const resolutionRate = closedPeriod.length > 0
    ? Math.round((closedPeriod.filter(c => calculateBusinessDaysOpen(new Date(c.created_at)) <= 1).length / closedPeriod.length) * 100)
    : 0;

  const currentlyOverdue = cases.filter(
    c => c.status !== 'closed' && calculateBusinessDaysOpen(new Date(c.created_at)) >= 2
  ).length;

  const totalOpen     = cases.filter(c => ['open', 'actioned', 'in_hand'].includes(c.status)).length;
  const totalResolved = cases.filter(c => c.status === 'closed').length;
  const allTimeRate   = cases.length > 0 ? Math.round((totalResolved / cases.length) * 100) : 0;

  // ── Chart data ───────────────────────────────────────────────────────────

  const typeData = (Object.keys(EXTENDED_LABELS) as ExtendedCategory[]).map(cat => ({
    name:  EXTENDED_LABELS[cat],
    count: periodCases.filter(c => getExtendedCategory(c) === cat).length,
    color: EXTENDED_COLOURS[cat],
  })).filter(d => d.count > 0);

  const statusData = ['open', 'actioned', 'in_hand', 'closed'].map(s => ({
    name:  s === 'open' ? 'New' : s === 'in_hand' ? 'In hand' : s.charAt(0).toUpperCase() + s.slice(1),
    value: periodCases.filter(c => c.status === s).length,
    color: STATUS_COLOURS[s],
  })).filter(d => d.value > 0);

  const avgCloseData = (Object.keys(EXTENDED_LABELS) as ExtendedCategory[]).map(cat => {
    const closed = closedPeriod.filter(c => getExtendedCategory(c) === cat);
    if (!closed.length) return null;
    const avg = closed.reduce((s, c) => s + calculateBusinessDaysOpen(new Date(c.created_at)), 0) / closed.length;
    const rounded = Math.round(avg * 10) / 10;
    return {
      name: EXTENDED_LABELS[cat],
      days: rounded,
      color: EXTENDED_COLOURS[cat], // same hue per category as the Cases by Type chart
    };
  }).filter(Boolean) as { name: string; days: number; color: string }[];

  // Trend data — respects granularity
  const trendData = useMemo(() => {
    const intervals: { start: Date; label: string }[] = [];
    if (granularity === 'daily') {
      eachDayOfInterval({ start, end }).forEach(d => intervals.push({ start: startOfDay(d), label: format(d, 'dd MMM') }));
    } else if (granularity === 'weekly') {
      eachWeekOfInterval({ start, end }).forEach(d => intervals.push({ start: _startOfWeek(d, { weekStartsOn: 1 }), label: format(d, 'dd MMM') }));
    } else {
      eachMonthOfInterval({ start, end }).forEach(d => intervals.push({ start: startOfMonth(d), label: format(d, 'MMM yyyy') }));
    }
    return intervals.map((interval, idx) => {
      const nextStart = idx < intervals.length - 1 ? intervals[idx + 1].start : new Date();
      const pc = periodCases.filter(c => {
        const d = new Date(c.created_at);
        return d >= interval.start && d < nextStart;
      });
      return {
        name: interval.label,
        'Warranty':           pc.filter(c => c.type === 'warranty_claim').length,
        'Order Entry Error':  pc.filter(c => getExtendedCategory(c) === 'order_entry_error').length,
        'Warehouse Error':    pc.filter(c => getExtendedCategory(c) === 'warehouse_error').length,
        'Freight Issue':      pc.filter(c => c.type === 'freight_issue').length,
        'Complaint':          pc.filter(c => c.type === 'complaint').length,
        'General':            pc.filter(c => c.type === 'general').length,
      };
    });
  }, [periodCases, granularity, start, end]);

  const trendDayCount = trendData.length;
  const trendXInterval = granularity !== 'daily' ? 0
    : trendDayCount <= 7 ? 0
    : trendDayCount <= 14 ? 1
    : trendDayCount <= 31 ? 4
    : 13;
  const trendAngled = granularity === 'daily' && trendDayCount > 7;

  const topProducts = useMemo(() => {
    const map = new Map<string, { count: number; types: Map<string, number>; lastDate: string }>();
    periodCases.forEach(c => {
      const p = c.product_name || 'Unknown';
      const entry = map.get(p) || { count: 0, types: new Map(), lastDate: c.created_at };
      entry.count++;
      entry.types.set(c.type, (entry.types.get(c.type) || 0) + 1);
      if (c.created_at > entry.lastDate) entry.lastDate = c.created_at;
      map.set(p, entry);
    });
    return [...map.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 10)
      .map(([name, data]) => {
        const mostCommonType = [...data.types.entries()].sort((a, b) => b[1] - a[1])[0];
        const extCat = getExtendedCategory({ type: mostCommonType[0] });
        return {
          name,
          count:      data.count,
          commonType: EXTENDED_LABELS[extCat] || mostCommonType[0],
          lastDate:   format(new Date(data.lastDate), 'dd MMM yyyy'),
        };
      });
  }, [periodCases]);

  // ── Export ───────────────────────────────────────────────────────────────

  const exportCSV = useCallback(() => {
    const headers = ['Case Number', 'Type', 'Error Origin', 'Status', 'Created At', 'Closed At', 'Business Days Open', 'SO Number', 'Customer', 'Product', 'Resolution Summary'];
    const rows = periodCases.map(c => [
      c.case_number, c.type, c.error_origin || '', c.status,
      format(new Date(c.created_at), 'yyyy-MM-dd HH:mm'),
      c.status === 'closed' ? format(new Date(c.updated_at), 'yyyy-MM-dd HH:mm') : '',
      calculateBusinessDaysOpen(new Date(c.created_at)).toString(),
      c.order_number || '', c.customer_name || '', c.product_name || '', c.description || '',
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.map(v => `"${(v || '').replace(/"/g, '""')}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `cases-${format(start, 'yyyyMMdd')}-${format(end, 'yyyyMMdd')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [periodCases, start, end]);

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-heading">ANALYTICS & REPORTS</h2>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {/* Same period filter as the Accounts app: grain + anchor */}
          {(GRAINS as { key: Grain; label: string }[]).map(g => (
            <button
              key={g.key}
              onClick={() => {
                setGrain(g.key);
                setAnchor(null);
                // A year of daily points is unreadable — start year views on monthly.
                setGranularity(g.key === 'month' ? 'daily' : 'monthly');
              }}
              className={cn('px-3 py-1.5 text-xs font-medium border transition-colors',
                grain === g.key
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-card text-muted-foreground border-border hover:border-foreground'
              )}
            >
              {g.label}
            </button>
          ))}
          <select
            value={effAnchor}
            onChange={e => setAnchor(e.target.value)}
            aria-label="Period"
            className="px-2.5 py-1.5 text-xs font-medium border border-border bg-card text-foreground cursor-pointer focus:outline-none focus:border-foreground"
          >
            {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <button
            onClick={exportCSV}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-border text-muted-foreground hover:text-foreground transition-colors"
          >
            <Download className="h-3.5 w-3.5" /> Export CSV
          </button>
        </div>
      </div>

      {/* Period stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatCard value={periodCases.length}  label="Cases opened" />
        <StatCard value={avgResponseDays}     label="Avg response (days)" />
        <StatCard value={`${resolutionRate}%`} label="Resolved ≤1 day" colour="text-status-resolved" />
        <StatCard value={currentlyOverdue}    label="Currently overdue" colour="text-status-urgent" />
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map(i => <div key={i} className="bg-card border border-border h-64 animate-pulse" />)}
        </div>
      ) : (
        <div className="space-y-4">

          {/* Row 1: By type + by status */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

            <div className="bg-card border border-border p-4">
              <h3 className="text-xs font-heading tracking-wider text-muted-foreground mb-4">CASES BY TYPE</h3>
              {typeData.length === 0 ? (
                <div className="h-52 flex items-center justify-center text-sm text-muted-foreground">No cases in this period</div>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={typeData} margin={{ bottom: 48 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1A1A1A" />
                    <XAxis dataKey="name" tick={{ fill: '#5A5A5A', fontSize: 10 }} axisLine={{ stroke: '#1A1A1A' }} angle={-35} textAnchor="end" interval={0} height={64} />
                    <YAxis tick={{ fill: '#5A5A5A', fontSize: 11 }} axisLine={{ stroke: '#1A1A1A' }} allowDecimals={false} domain={[0, (d: number) => Math.max(d, 1)]} />
                    <Tooltip {...TOOLTIP_STYLE} />
                    <Bar dataKey="count" label={{ position: 'top', fill: '#5A5A5A', fontSize: 11, formatter: (v: number) => v > 0 ? v : '' }}>
                      {typeData.map((d, i) => <Cell key={i} fill={d.color} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="bg-card border border-border p-4">
              <h3 className="text-xs font-heading tracking-wider text-muted-foreground mb-4">CASES BY STATUS</h3>
              {statusData.length === 0 ? (
                <div className="h-52 flex items-center justify-center text-sm text-muted-foreground">No cases in this period</div>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie
                      data={statusData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={90}
                      strokeWidth={0}
                      label={({ cx, cy, midAngle, innerRadius, outerRadius, value }) => {
                        if (!value) return null;
                        const RADIAN = Math.PI / 180;
                        const r = innerRadius + (outerRadius - innerRadius) * 0.5;
                        const x = cx + r * Math.cos(-midAngle * RADIAN);
                        const y = cy + r * Math.sin(-midAngle * RADIAN);
                        return <text x={x} y={y} fill="#fff" textAnchor="middle" dominantBaseline="central" fontSize={12} fontWeight={600}>{value}</text>;
                      }}
                      labelLine={false}
                    >
                      {statusData.map((d, i) => <Cell key={i} fill={d.color} />)}
                      <Label value={periodCases.length} position="center" fill="#fff" style={{ fontSize: '18px', fontWeight: 700 }} />
                    </Pie>
                    <Tooltip {...TOOLTIP_STYLE} />
                    <Legend
                      verticalAlign="bottom"
                      height={36}
                      formatter={(value) => <span style={{ color: '#9A9A9A', fontSize: '11px' }}>{value}</span>}
                    />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Row 2: Targets */}
          <div className="bg-card border border-border p-4">
            <h3 className="text-xs font-heading tracking-wider text-muted-foreground mb-4">TARGETS</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
              <TargetBar label="Response within 1 business day" current={resolutionRate} target={90} />
              <TargetBar label="Overall resolution rate" current={allTimeRate} target={80} />
              <TargetBar label="Currently overdue" current={currentlyOverdue} target={5} isCount inverse />
            </div>
          </div>

          {/* Row 3: Case trends */}
          <div className="bg-card border border-border p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xs font-heading tracking-wider text-muted-foreground">CASE TRENDS</h3>
              <div className="flex gap-1">
                {(['daily', 'weekly', 'monthly'] as Granularity[]).map(g => (
                  <button
                    key={g}
                    onClick={() => setGranularity(g)}
                    className={cn('px-2.5 py-1 text-[11px] font-medium border transition-colors',
                      granularity === g
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-transparent text-muted-foreground border-border hover:border-foreground'
                    )}
                  >
                    {g.charAt(0).toUpperCase() + g.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={trendData} margin={{ bottom: trendAngled ? 24 : 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2A2A2A" />
                <XAxis
                  dataKey="name"
                  tick={{ fill: '#9A9A9A', fontSize: 10 }}
                  axisLine={{ stroke: '#2A2A2A' }}
                  interval={trendXInterval}
                  angle={trendAngled ? -35 : 0}
                  textAnchor={trendAngled ? 'end' : 'middle'}
                  height={trendAngled ? 52 : 30}
                />
                <YAxis
                  tick={{ fill: '#9A9A9A', fontSize: 11 }}
                  axisLine={{ stroke: '#2A2A2A' }}
                  allowDecimals={false}
                  domain={[0, (d: number) => Math.max(d, 1)]}
                />
                <Tooltip {...TOOLTIP_STYLE} />
                <Legend formatter={(value) => <span style={{ color: '#9A9A9A', fontSize: '11px' }}>{value}</span>} />
                <Line type="monotone" dataKey="Warranty"          stroke={EXTENDED_COLOURS.warranty_claim} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                <Line type="monotone" dataKey="Order Entry Error" stroke={EXTENDED_COLOURS.order_entry_error} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                <Line type="monotone" dataKey="Warehouse Error"   stroke={EXTENDED_COLOURS.warehouse_error} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                <Line type="monotone" dataKey="Freight Issue"     stroke={EXTENDED_COLOURS.freight_issue} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                <Line type="monotone" dataKey="Complaint"         stroke={EXTENDED_COLOURS.complaint} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                <Line type="monotone" dataKey="General"           stroke={EXTENDED_COLOURS.general} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Row 4: Avg time to close — only shown when there's data */}
          {avgCloseData.length > 0 && (
            <div className="bg-card border border-border p-4">
              <h3 className="text-xs font-heading tracking-wider text-muted-foreground mb-4">AVERAGE TIME TO CLOSE BY TYPE</h3>
              <ResponsiveContainer width="100%" height={avgCloseData.length * 44 + 40}>
                <BarChart data={avgCloseData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#1A1A1A" />
                  <XAxis type="number" tick={{ fill: '#5A5A5A', fontSize: 11 }} axisLine={{ stroke: '#1A1A1A' }} domain={[0, (d: number) => Math.max(d, 1)]} />
                  <YAxis dataKey="name" type="category" tick={{ fill: '#5A5A5A', fontSize: 11 }} axisLine={{ stroke: '#1A1A1A' }} width={130} />
                  <Tooltip {...TOOLTIP_STYLE} formatter={(v: number) => [`${v} days`, 'Avg']} />
                  <Bar dataKey="days" label={{ position: 'right', fill: '#5A5A5A', fontSize: 11, formatter: (v: number) => `${v}d` }}>
                    {avgCloseData.map((d, i) => <Cell key={i} fill={d.color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Row 5: Top products table */}
          {topProducts.length > 0 && (
            <div className="bg-card border border-border p-4">
              <h3 className="text-xs font-heading tracking-wider text-muted-foreground mb-4">TOP PRODUCTS BY CASE COUNT</h3>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left px-3 py-2 text-xs text-muted-foreground font-medium">Product</th>
                    <th className="text-right px-3 py-2 text-xs text-muted-foreground font-medium">Cases</th>
                    <th className="text-left px-3 py-2 text-xs text-muted-foreground font-medium">Most common type</th>
                    <th className="text-left px-3 py-2 text-xs text-muted-foreground font-medium">Last case</th>
                  </tr>
                </thead>
                <tbody>
                  {topProducts.map((p, i) => (
                    <tr key={i} className="border-b border-border last:border-0">
                      <td className="px-3 py-2 text-foreground">{p.name}</td>
                      <td className="px-3 py-2 text-right text-foreground font-medium">{p.count}</td>
                      <td className="px-3 py-2 text-muted-foreground">{p.commonType}</td>
                      <td className="px-3 py-2 text-muted-foreground">{p.lastDate}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

        </div>
      )}
    </div>
  );
}
