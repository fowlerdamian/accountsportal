import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { CASE_TYPE_LABELS } from '@/lib/types';
import type { Case, CaseType } from '@/lib/types';
import { calculateBusinessDaysOpen } from '@/lib/businessDays';
import { Download } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie, Label,
  LineChart, Line,
} from 'recharts';
import {
  format, subDays, startOfWeek, startOfMonth, endOfMonth,
  subMonths, eachDayOfInterval, startOfDay,
} from 'date-fns';

type Preset = 'this_week' | 'this_month' | 'last_month' | 'last_3_months';

const TYPE_COLOURS: Record<CaseType, string> = {
  warranty_claim: '#C0392B',
  order_error: '#D4860A',
  freight_issue: '#1A6FA8',
  complaint: '#6B3FA0',
  general: '#5A5A5A',
};

type ExtendedCategory = 'warranty_claim' | 'order_entry_error' | 'warehouse_error' | 'freight_issue' | 'complaint' | 'general';

const EXTENDED_LABELS: Record<ExtendedCategory, string> = {
  warranty_claim: 'Warranty Claim',
  order_entry_error: 'Order Entry Error',
  warehouse_error: 'Warehouse Error',
  freight_issue: 'Freight Issue',
  complaint: 'Complaint',
  general: 'General Enquiry',
};

const EXTENDED_COLOURS: Record<ExtendedCategory, string> = {
  warranty_claim: '#C0392B',
  order_entry_error: '#D4860A',
  warehouse_error: '#6B3FA0',
  freight_issue: '#1A6FA8',
  complaint: '#6B3FA0',
  general: '#5A5A5A',
};

function getExtendedCategory(c: { type: string; error_origin?: string | null }): ExtendedCategory {
  if (c.type === 'order_error') {
    if (c.error_origin === 'order_entry') return 'order_entry_error';
    if (c.error_origin === 'warehouse') return 'warehouse_error';
    return 'order_entry_error';
  }
  return c.type as ExtendedCategory;
}

const STATUS_COLOURS: Record<string, string> = {
  open: '#5A5A5A',
  actioned: '#1A6FA8',
  in_hand: '#6B3FA0',
  closed: '#2E7D32',
};

function getDateRange(preset: Preset): { start: Date; end: Date } {
  const now = new Date();
  switch (preset) {
    case 'this_week': return { start: startOfWeek(now, { weekStartsOn: 1 }), end: now };
    case 'this_month': return { start: startOfMonth(now), end: now };
    case 'last_month': {
      const lm = subMonths(now, 1);
      return { start: startOfMonth(lm), end: endOfMonth(lm) };
    }
    case 'last_3_months': return { start: subMonths(startOfMonth(now), 2), end: now };
    default: return { start: subDays(now, 30), end: now };
  }
}

export default function ReportsTab() {
  const [preset, setPreset] = useState<Preset>('this_month');
  const { start, end } = getDateRange(preset);

  const { data: cases = [], isLoading } = useQuery({
    queryKey: ['reports-cases'],
    queryFn: async () => {
      const { data, error } = await supabase.from('cases').select('*').order('created_at', { ascending: true });
      if (error) throw error;
      return data as unknown as Case[];
    },
  });

  const periodCases = useMemo(() =>
    cases.filter(c => {
      const d = new Date(c.created_at);
      return d >= start && d <= end;
    }), [cases, start, end]);

  const closedPeriod = periodCases.filter(c => c.status === 'closed');

  const totalOpened = periodCases.length;
  const avgResponseDays = useMemo(() => {
    const withResponse = periodCases.filter(c => c.status !== 'open');
    if (withResponse.length === 0) return 0;
    const total = withResponse.reduce((sum, c) => sum + calculateBusinessDaysOpen(new Date(c.created_at)), 0);
    return Math.round((total / withResponse.length) * 10) / 10;
  }, [periodCases]);
  const resolutionRate = closedPeriod.length > 0
    ? Math.round((closedPeriod.filter(c => calculateBusinessDaysOpen(new Date(c.created_at)) <= 1).length / closedPeriod.length) * 100)
    : 0;
  const currentlyOverdue = cases.filter(c => c.status !== 'closed' && calculateBusinessDaysOpen(new Date(c.created_at)) >= 2).length;

  const typeData = (Object.keys(EXTENDED_LABELS) as ExtendedCategory[]).map(cat => ({
    name: EXTENDED_LABELS[cat],
    count: periodCases.filter(c => getExtendedCategory(c) === cat).length,
    color: EXTENDED_COLOURS[cat],
  })).filter(d => d.count > 0);

  const statusData = ['open', 'actioned', 'in_hand', 'closed'].map(s => ({
    name: s === 'open' ? 'New' : s === 'in_hand' ? 'In hand' : s.charAt(0).toUpperCase() + s.slice(1),
    value: periodCases.filter(c => c.status === s).length,
    color: STATUS_COLOURS[s],
  })).filter(d => d.value > 0);

  const avgCloseData = (Object.keys(EXTENDED_LABELS) as ExtendedCategory[]).map(cat => {
    const closed = closedPeriod.filter(c => getExtendedCategory(c) === cat);
    if (closed.length === 0) return null;
    const avg = closed.reduce((s, c) => s + calculateBusinessDaysOpen(new Date(c.created_at)), 0) / closed.length;
    const rounded = Math.round(avg * 10) / 10;
    return {
      name: EXTENDED_LABELS[cat],
      days: rounded,
      color: rounded <= 1 ? '#2E7D32' : rounded <= 2 ? '#D4860A' : '#C0392B',
    };
  }).filter(Boolean) as { name: string; days: number; color: string }[];

  const days = eachDayOfInterval({ start, end });
  const timeData = days.map(d => ({
    name: format(d, 'dd MMM'),
    count: periodCases.filter(c => {
      const cd = startOfDay(new Date(c.created_at));
      return cd.getTime() === startOfDay(d).getTime();
    }).length,
  }));

  const productMap = new Map<string, { count: number; types: Map<string, number>; lastDate: string }>();
  periodCases.forEach(c => {
    const p = c.product_name || 'Unknown';
    const entry = productMap.get(p) || { count: 0, types: new Map(), lastDate: c.created_at };
    entry.count++;
    entry.types.set(c.type, (entry.types.get(c.type) || 0) + 1);
    if (c.created_at > entry.lastDate) entry.lastDate = c.created_at;
    productMap.set(p, entry);
  });
  const topProducts = [...productMap.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 10)
    .map(([name, data]) => {
      const mostCommonType = [...data.types.entries()].sort((a, b) => b[1] - a[1])[0];
      const extCat = getExtendedCategory({ type: mostCommonType[0], error_origin: undefined });
      return {
        name,
        count: data.count,
        commonType: mostCommonType ? EXTENDED_LABELS[extCat] || mostCommonType[0] : '—',
        lastDate: format(new Date(data.lastDate), 'dd MMM yyyy'),
      };
    });

  const exportCSV = () => {
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
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cases-${format(start, 'yyyyMMdd')}-${format(end, 'yyyyMMdd')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const tooltipStyle = {
    contentStyle: { backgroundColor: '#1E1E1E', border: '1px solid #2A2A2A', borderRadius: '2px', fontSize: '12px' },
    itemStyle: { color: '#FFFFFF' },
    labelStyle: { color: '#9A9A9A' },
  };

  return (
    <div>
      <div className="flex items-center justify-end mb-6">
        <div className="flex items-center gap-2">
          {([
            ['this_week', 'This week'],
            ['this_month', 'This month'],
            ['last_month', 'Last month'],
            ['last_3_months', 'Last 3 months'],
          ] as [Preset, string][]).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setPreset(key)}
              className={cn('px-3 py-1.5 text-xs font-medium border transition-colors',
                preset === key ? 'bg-primary text-primary-foreground border-primary' : 'bg-card text-muted-foreground border-border hover:border-foreground'
              )}
            >
              {label}
            </button>
          ))}
          <button onClick={exportCSV} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-border text-muted-foreground hover:text-foreground transition-colors ml-2">
            <Download className="h-3.5 w-3.5" /> Export CSV
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="bg-card border border-border px-4 py-3">
          <span className="text-2xl font-heading text-foreground">{totalOpened}</span>
          <span className="text-xs text-muted-foreground uppercase tracking-wide font-heading block mt-0.5">Cases opened</span>
        </div>
        <div className="bg-card border border-border px-4 py-3">
          <span className="text-2xl font-heading text-foreground">{avgResponseDays}</span>
          <span className="text-xs text-muted-foreground uppercase tracking-wide font-heading block mt-0.5">Avg response (days)</span>
        </div>
        <div className="bg-card border border-border px-4 py-3">
          <span className="text-2xl font-heading text-status-resolved">{resolutionRate}%</span>
          <span className="text-xs text-muted-foreground uppercase tracking-wide font-heading block mt-0.5">Resolved ≤1 day</span>
        </div>
        <div className="bg-card border border-border px-4 py-3">
          <span className="text-2xl font-heading text-status-urgent">{currentlyOverdue}</span>
          <span className="text-xs text-muted-foreground uppercase tracking-wide font-heading block mt-0.5">Currently overdue</span>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2].map(i => <div key={i} className="bg-card border border-border h-64 animate-pulse" />)}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            <div className="bg-card border border-border p-4">
              <h3 className="text-xs font-heading tracking-wider text-muted-foreground mb-4">CASES BY TYPE</h3>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={typeData} margin={{ bottom: 48 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1A1A1A" />
                  <XAxis
                    dataKey="name"
                    tick={{ fill: '#5A5A5A', fontSize: 10 }}
                    axisLine={{ stroke: '#1A1A1A' }}
                    angle={-35}
                    textAnchor="end"
                    interval={0}
                    height={64}
                  />
                  <YAxis tick={{ fill: '#5A5A5A', fontSize: 11 }} axisLine={{ stroke: '#1A1A1A' }} allowDecimals={false} />
                  <Tooltip {...tooltipStyle} />
                  <Bar dataKey="count" label={{ position: 'top', fill: '#5A5A5A', fontSize: 11, formatter: (v: number) => v > 0 ? v : '' }}>
                    {typeData.map((d, i) => <Cell key={i} fill={d.color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-card border border-border p-4">
              <h3 className="text-xs font-heading tracking-wider text-muted-foreground mb-4">CASES BY STATUS</h3>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={statusData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={45}
                    outerRadius={80}
                    strokeWidth={0}
                    label={({ cx, cy, midAngle, innerRadius, outerRadius, value }) => {
                      if (value === 0) return null;
                      const RADIAN = Math.PI / 180;
                      const r = innerRadius + (outerRadius - innerRadius) * 0.5;
                      const x = cx + r * Math.cos(-midAngle * RADIAN);
                      const y = cy + r * Math.sin(-midAngle * RADIAN);
                      return <text x={x} y={y} fill="#fff" textAnchor="middle" dominantBaseline="central" fontSize={12} fontWeight={600}>{value}</text>;
                    }}
                    labelLine={false}
                  >
                    {statusData.map((d, i) => <Cell key={i} fill={d.color} />)}
                    <Label
                      value={periodCases.length}
                      position="center"
                      fill="#fff"
                      style={{ fontSize: '18px', fontWeight: 700 }}
                    />
                  </Pie>
                  <Tooltip {...tooltipStyle} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          {avgCloseData.length > 0 && (
            <div className="bg-card border border-border p-4 mb-6">
              <h3 className="text-xs font-heading tracking-wider text-muted-foreground mb-4">AVERAGE TIME TO CLOSE BY TYPE</h3>
              <ResponsiveContainer width="100%" height={avgCloseData.length * 40 + 40}>
                <BarChart data={avgCloseData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#1A1A1A" />
                  <XAxis type="number" tick={{ fill: '#5A5A5A', fontSize: 11 }} axisLine={{ stroke: '#1A1A1A' }} />
                  <YAxis dataKey="name" type="category" tick={{ fill: '#5A5A5A', fontSize: 11 }} axisLine={{ stroke: '#1A1A1A' }} width={120} />
                  <Tooltip {...tooltipStyle} formatter={(v: number) => [`${v} days`, 'Avg']} />
                  <Bar dataKey="days" label={{ position: 'right', fill: '#5A5A5A', fontSize: 11, formatter: (v: number) => `${v}d` }}>
                    {avgCloseData.map((d, i) => <Cell key={i} fill={d.color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          <div className="bg-card border border-border p-4 mb-6">
            <h3 className="text-xs font-heading tracking-wider text-muted-foreground mb-4">CASES OVER TIME</h3>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={timeData} margin={{ bottom: days.length > 7 ? 20 : 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1A1A1A" />
                <XAxis
                  dataKey="name"
                  tick={{ fill: '#5A5A5A', fontSize: 10 }}
                  axisLine={{ stroke: '#1A1A1A' }}
                  interval={days.length <= 7 ? 0 : days.length <= 14 ? 1 : days.length <= 31 ? 4 : 13}
                  angle={days.length > 7 ? -35 : 0}
                  textAnchor={days.length > 7 ? 'end' : 'middle'}
                  height={days.length > 7 ? 48 : 30}
                />
                <YAxis tick={{ fill: '#5A5A5A', fontSize: 11 }} axisLine={{ stroke: '#1A1A1A' }} allowDecimals={false} />
                <Tooltip {...tooltipStyle} />
                <Line type="monotone" dataKey="count" stroke="#1A6FA8" strokeWidth={2} dot={days.length <= 14} />
              </LineChart>
            </ResponsiveContainer>
          </div>

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
        </>
      )}
    </div>
  );
}
