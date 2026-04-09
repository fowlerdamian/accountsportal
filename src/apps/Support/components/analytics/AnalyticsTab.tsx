import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { CASE_TYPE_LABELS } from '@/lib/types';
import type { Case, CaseType } from '@/lib/types';
import { cn } from '@/lib/utils';
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  LineChart, Line, XAxis, YAxis, CartesianGrid, Legend,
} from 'recharts';
import { format, subDays, startOfDay, startOfWeek, startOfMonth, eachDayOfInterval, eachWeekOfInterval, eachMonthOfInterval } from 'date-fns';

const TYPE_COLOURS: Record<CaseType, string> = {
  warranty_claim: '#C0392B',
  order_error: '#D4860A',
  freight_issue: '#1A6FA8',
  complaint: '#1A6FA8',
  general: '#5A5A5A',
};

// Extended categories splitting order_error by error_origin
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
  complaint: '#2E7D32',
  general: '#5A5A5A',
};

function getExtendedCategory(c: { type: string; error_origin?: string | null }): ExtendedCategory {
  if (c.type === 'order_error') {
    if (c.error_origin === 'order_entry') return 'order_entry_error';
    if (c.error_origin === 'warehouse') return 'warehouse_error';
    return 'order_entry_error'; // default
  }
  return c.type as ExtendedCategory;
}

type TimeRange = '7d' | '30d' | '90d';
type Granularity = 'daily' | 'weekly' | 'monthly';

export default function AnalyticsTab() {
  const [range, setRange] = useState<TimeRange>('30d');
  const [granularity, setGranularity] = useState<Granularity>('daily');

  const rangeDays = range === '7d' ? 7 : range === '30d' ? 30 : 90;
  const startDate = subDays(new Date(), rangeDays);

  const { data: cases = [], isLoading } = useQuery({
    queryKey: ['analytics-cases', range],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cases')
        .select('*')
        .gte('created_at', startDate.toISOString())
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data as unknown as Case[];
    },
  });

  const { data: allCases = [] } = useQuery({
    queryKey: ['analytics-all-cases'],
    queryFn: async () => {
      const { data, error } = await supabase.from('cases').select('type, status, error_origin');
      if (error) throw error;
      return data;
    },
  });

  const typeCounts = (Object.keys(EXTENDED_LABELS) as ExtendedCategory[]).map(cat => ({
    name: EXTENDED_LABELS[cat],
    value: cases.filter(c => getExtendedCategory(c) === cat).length,
    color: EXTENDED_COLOURS[cat],
  })).filter(d => d.value > 0);

  const totalOpen = allCases.filter(c => c.status === 'open' || c.status === 'actioned' || c.status === 'in_hand').length;
  const totalResolved = allCases.filter(c => c.status === 'closed').length;
  const totalCases = allCases.length;
  const resolutionRate = totalCases > 0 ? Math.round((totalResolved / totalCases) * 100) : 0;

  const getIntervals = () => {
    const end = new Date();
    if (granularity === 'daily') {
      return eachDayOfInterval({ start: startDate, end }).map(d => ({
        start: startOfDay(d),
        label: format(d, 'dd MMM'),
      }));
    }
    if (granularity === 'weekly') {
      return eachWeekOfInterval({ start: startDate, end }).map(d => ({
        start: startOfWeek(d),
        label: format(d, 'dd MMM'),
      }));
    }
    return eachMonthOfInterval({ start: startDate, end }).map(d => ({
      start: startOfMonth(d),
      label: format(d, 'MMM yyyy'),
    }));
  };

  const intervals = getIntervals();
  const trendData = intervals.map((interval, idx) => {
    const nextStart = idx < intervals.length - 1 ? intervals[idx + 1].start : new Date();
    const periodCases = cases.filter(c => {
      const d = new Date(c.created_at);
      return d >= interval.start && d < nextStart;
    });
    return {
      name: interval.label,
      'Warranty': periodCases.filter(c => c.type === 'warranty_claim').length,
      'Order Entry Error': periodCases.filter(c => getExtendedCategory(c) === 'order_entry_error').length,
      'Warehouse Error': periodCases.filter(c => getExtendedCategory(c) === 'warehouse_error').length,
      'Freight Issue': periodCases.filter(c => c.type === 'freight_issue').length,
      'Complaint': periodCases.filter(c => c.type === 'complaint').length,
      'General': periodCases.filter(c => c.type === 'general').length,
    };
  });

  const renderPieLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, value }: any) => {
    const RADIAN = Math.PI / 180;
    const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
    const x = cx + radius * Math.cos(-midAngle * RADIAN);
    const y = cy + radius * Math.sin(-midAngle * RADIAN);
    return <text x={x} y={y} fill="#fff" textAnchor="middle" dominantBaseline="central" fontSize={14} fontWeight={600}>{value}</text>;
  };

  return (
    <div>
      <div className="flex items-center justify-end mb-6">
        <div className="flex items-center gap-2">
          {(['7d', '30d', '90d'] as TimeRange[]).map(r => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={cn('px-3 py-1.5 text-xs font-medium border transition-colors',
                range === r ? 'bg-primary text-primary-foreground border-primary' : 'bg-card text-muted-foreground border-border hover:border-foreground'
              )}
            >
              {r === '7d' ? '7 Days' : r === '30d' ? '30 Days' : '90 Days'}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="bg-card border border-border px-4 py-3">
          <span className="text-2xl font-heading text-foreground">{totalCases}</span>
          <span className="text-xs text-muted-foreground uppercase tracking-wide font-heading block mt-0.5">Total Cases</span>
        </div>
        <div className="bg-card border border-border px-4 py-3">
          <span className="text-2xl font-heading text-status-urgent">{totalOpen}</span>
          <span className="text-xs text-muted-foreground uppercase tracking-wide font-heading block mt-0.5">Open</span>
        </div>
        <div className="bg-card border border-border px-4 py-3">
          <span className="text-2xl font-heading text-status-resolved">{totalResolved}</span>
          <span className="text-xs text-muted-foreground uppercase tracking-wide font-heading block mt-0.5">Resolved</span>
        </div>
        <div className="bg-card border border-border px-4 py-3">
          <span className="text-2xl font-heading text-status-progress">{resolutionRate}%</span>
          <span className="text-xs text-muted-foreground uppercase tracking-wide font-heading block mt-0.5">Resolution Rate</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div className="bg-card border border-border p-4">
          <h3 className="text-xs font-heading tracking-wider text-muted-foreground mb-4">CASES BY TYPE</h3>
          {isLoading ? (
            <div className="h-52 animate-pulse bg-surface-elevated" />
          ) : typeCounts.length === 0 ? (
            <div className="h-52 flex items-center justify-center text-sm text-muted-foreground">No cases yet</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={typeCounts} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} strokeWidth={0} label={renderPieLabel} labelLine={false}>
                  {typeCounts.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                </Pie>
                <Tooltip
                  contentStyle={{ backgroundColor: '#1E1E1E', border: '1px solid #2A2A2A', borderRadius: '2px', fontSize: '12px' }}
                  itemStyle={{ color: '#FFFFFF' }}
                  labelStyle={{ color: '#9A9A9A' }}
                />
                <Legend
                  verticalAlign="bottom"
                  height={36}
                  formatter={(value) => <span style={{ color: '#9A9A9A', fontSize: '11px' }}>{value}</span>}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="bg-card border border-border p-4">
          <h3 className="text-xs font-heading tracking-wider text-muted-foreground mb-4">TARGETS</h3>
          <div className="space-y-4">
            <TargetBar label="Response within 1 business day" current={resolutionRate} target={90} />
            <TargetBar label="Cases resolved this period" current={totalResolved} target={Math.max(totalCases, 1)} isCount />
            <TargetBar label="Open cases" current={totalOpen} target={5} isCount inverse />
          </div>
        </div>
      </div>

      <div className="bg-card border border-border p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xs font-heading tracking-wider text-muted-foreground">CASE TRENDS</h3>
          <div className="flex gap-1">
            {(['daily', 'weekly', 'monthly'] as Granularity[]).map(g => (
              <button
                key={g}
                onClick={() => setGranularity(g)}
                className={cn('px-2.5 py-1 text-[11px] font-medium border transition-colors',
                  granularity === g ? 'bg-primary text-primary-foreground border-primary' : 'bg-transparent text-muted-foreground border-border hover:border-foreground'
                )}
              >
                {g.charAt(0).toUpperCase() + g.slice(1)}
              </button>
            ))}
          </div>
        </div>
        {isLoading ? (
          <div className="h-64 animate-pulse bg-surface-elevated" />
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={trendData} margin={{ bottom: granularity === 'daily' && range !== '7d' ? 20 : 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2A2A2A" />
              <XAxis
                dataKey="name"
                tick={{ fill: '#9A9A9A', fontSize: 10 }}
                axisLine={{ stroke: '#2A2A2A' }}
                interval={
                  granularity !== 'daily' ? 0
                    : range === '7d' ? 0
                    : range === '30d' ? 4
                    : 13
                }
                angle={granularity === 'daily' && range !== '7d' ? -35 : 0}
                textAnchor={granularity === 'daily' && range !== '7d' ? 'end' : 'middle'}
                height={granularity === 'daily' && range !== '7d' ? 48 : 30}
              />
              <YAxis tick={{ fill: '#9A9A9A', fontSize: 11 }} axisLine={{ stroke: '#2A2A2A' }} allowDecimals={false} />
              <Tooltip
                contentStyle={{ backgroundColor: '#1E1E1E', border: '1px solid #2A2A2A', borderRadius: '2px', fontSize: '12px' }}
                itemStyle={{ color: '#FFFFFF' }}
                labelStyle={{ color: '#9A9A9A' }}
              />
              <Legend formatter={(value) => <span style={{ color: '#9A9A9A', fontSize: '11px' }}>{value}</span>} />
              <Line type="monotone" dataKey="Warranty" stroke="#C0392B" strokeWidth={2} dot={{ r: 3, strokeWidth: 2, fill: '#1E1E1E' }} activeDot={{ r: 5 }} />
              <Line type="monotone" dataKey="Order Entry Error" stroke="#D4860A" strokeWidth={2} dot={{ r: 3, strokeWidth: 2, fill: '#1E1E1E' }} activeDot={{ r: 5 }} />
              <Line type="monotone" dataKey="Warehouse Error" stroke="#6B3FA0" strokeWidth={2} dot={{ r: 4, strokeWidth: 0, fill: '#6B3FA0' }} activeDot={{ r: 6 }} />
              <Line type="monotone" dataKey="Freight Issue" stroke="#1A6FA8" strokeWidth={2} dot={{ r: 3, strokeWidth: 2, fill: '#1E1E1E' }} activeDot={{ r: 5 }} />
              <Line type="monotone" dataKey="Complaint" stroke="#2E7D32" strokeWidth={2} dot={{ r: 4, strokeWidth: 0, fill: '#2E7D32' }} activeDot={{ r: 6 }} />
              <Line type="monotone" dataKey="General" stroke="#5A5A5A" strokeWidth={2} dot={{ r: 2, strokeWidth: 2, fill: '#5A5A5A' }} activeDot={{ r: 5 }} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

function TargetBar({ label, current, target, isCount, inverse }: { label: string; current: number; target: number; isCount?: boolean; inverse?: boolean }) {
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
