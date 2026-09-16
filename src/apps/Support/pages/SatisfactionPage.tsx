// Support Hub → Satisfaction
//
// Customer-satisfaction and call metrics derived from Dialpad. Rows live in
// public.dialpad_calls (synced by /api/dialpad-sync; graded by the dialpad-grade
// edge function). Dialpad's own CSAT surveys aren't enabled, so "CSAT" here is
// Claude's 1–5 read of each transcript, alongside Dialpad's AI sentiment moments,
// MOS call quality, answer rates and handle times.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Table2, ChartColumn } from 'lucide-react';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine, Cell,
} from 'recharts';
import { format, subDays, startOfDay, startOfWeek, eachDayOfInterval, eachWeekOfInterval, isSameDay, isSameWeek } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { palette } from '@portal/lib/palette';

// ── Types ─────────────────────────────────────────────────────────────────────

interface CallRow {
  call_id: string;
  started_at: string;
  direction: 'inbound' | 'outbound';
  status: 'answered' | 'missed' | 'voicemail';
  duration_seconds: number;
  ring_seconds: number | null;
  external_number: string | null;
  contact_name: string | null;
  agent_id: string | null;
  agent_name: string | null;
  is_transferred: boolean;
  mos_score: number | null;
  positive_moments: number;
  negative_moments: number;
  ai_csat: number | null;
  ai_sentiment: 'positive' | 'neutral' | 'negative' | null;
  ai_resolved: boolean | null;
  ai_purpose: string | null;
  ai_summary: string | null;
  ai_flags: string[];
  ai_graded_at: string | null;
  ai_skip_reason: string | null;
  synced_at: string;
}

type Range = '7d' | '30d' | '90d';
type SyncState = 'idle' | 'syncing' | 'done' | 'error';

const RANGE_DAYS: Record<Range, number> = { '7d': 7, '30d': 30, '90d': 90 };
const SYNC_STALE_MS = 15 * 60 * 1000;

const FLAG_LABELS: Record<string, string> = {
  complaint: 'Complaint',
  escalation_risk: 'Escalation risk',
  churn_risk: 'Churn risk',
  unresolved: 'Unresolved',
  callback_promised: 'Callback promised',
  praise: 'Praise',
};
const ATTENTION_FLAGS = new Set(['complaint', 'escalation_risk', 'churn_risk', 'unresolved']);

// Surface + chrome tokens (Support Hub cards are #161616 on a #0a0a0a page)
const SURFACE = '#161616';
const GRID = '#2a2a2a';
const INK_MUTED = '#9a9a9a';
const DEEMPHASIS = '#5a5a5a';

const TOOLTIP_STYLE = {
  contentStyle: { backgroundColor: '#1E1E1E', border: '1px solid #2A2A2A', borderRadius: '2px', fontSize: '12px' },
  itemStyle: { color: '#FFFFFF' },
  labelStyle: { color: INK_MUTED },
  cursor: { fill: 'rgba(255,255,255,0.04)' },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : null);
const fmtPct = (v: number | null) => (v === null ? '—' : `${v}%`);
const fmt1 = (v: number | null) => (v === null ? '—' : v.toFixed(1));
const fmt2 = (v: number | null) => (v === null ? '—' : v.toFixed(2));
function fmtDuration(sec: number | null) {
  if (sec === null || !Number.isFinite(sec)) return '—';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m ? `${m}m ${s.toString().padStart(2, '0')}s` : `${s}s`;
}
function fmtDelta(cur: number | null, prev: number | null, digits = 1, suffix = '') {
  if (cur === null || prev === null) return null;
  const d = cur - prev;
  if (Math.abs(d) < Math.pow(10, -digits) / 2) return `±0${suffix}`;
  return `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(digits)}${suffix}`;
}

/** Graded customer calls — excludes internal/skipped rows and ungraded ones. */
const isGraded = (c: CallRow) => c.ai_csat !== null && c.ai_skip_reason !== 'internal';

// ── Small components ─────────────────────────────────────────────────────────

function StatTile({ label, value, delta, deltaGood, hint }: {
  label: string; value: string; delta?: string | null; deltaGood?: boolean | null; hint?: string;
}) {
  return (
    <div className="bg-card border border-border px-4 py-3 min-w-0">
      <div className="text-2xl font-semibold text-foreground leading-tight" style={{ fontVariantNumeric: 'normal' }}>{value}</div>
      <div className="flex items-baseline gap-2 mt-0.5 flex-wrap">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground font-heading">{label}</span>
        {delta && (
          <span
            className="text-[11px] font-medium"
            style={{ color: deltaGood === null || deltaGood === undefined ? INK_MUTED : deltaGood ? palette.aqua : palette.pink }}
            title="vs previous period"
          >
            {delta}
          </span>
        )}
      </div>
      {hint && <div className="text-[11px] text-muted-foreground mt-1">{hint}</div>}
    </div>
  );
}

function ChartCard({ title, subtitle, table, children }: {
  title: string; subtitle?: string; table: { columns: string[]; rows: (string | number)[][] }; children: React.ReactNode;
}) {
  const [showTable, setShowTable] = useState(false);
  return (
    <div className="bg-card border border-border p-4 min-w-0">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="text-xs font-heading tracking-wider text-muted-foreground">{title}</h3>
          {subtitle && <p className="text-[11px] text-muted-foreground/80 mt-0.5">{subtitle}</p>}
        </div>
        <button
          type="button"
          onClick={() => setShowTable((v) => !v)}
          className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
          title={showTable ? 'Show chart' : 'Show data table'}
          aria-label={showTable ? 'Show chart' : 'Show data table'}
        >
          {showTable ? <ChartColumn className="h-3.5 w-3.5" /> : <Table2 className="h-3.5 w-3.5" />}
        </button>
      </div>
      {showTable ? (
        <div className="overflow-x-auto">
          <table className="w-full text-xs" style={{ fontVariantNumeric: 'tabular-nums' }}>
            <thead>
              <tr className="text-muted-foreground">
                {table.columns.map((c) => <th key={c} className="text-left font-medium py-1 pr-3 border-b border-border">{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {table.rows.length === 0 && <tr><td className="py-2 text-muted-foreground" colSpan={table.columns.length}>No data</td></tr>}
              {table.rows.map((r, i) => (
                <tr key={i} className="border-b border-border/50">
                  {r.map((v, j) => <td key={j} className="py-1 pr-3 text-foreground/90">{v}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : children}
    </div>
  );
}

function FlagChip({ flag }: { flag: string }) {
  const bad = ATTENTION_FLAGS.has(flag);
  return (
    <span
      className="inline-block text-[10px] px-1.5 py-0.5 rounded-sm border"
      style={{
        color: bad ? '#f2b8b8' : '#b9d6dc',
        borderColor: bad ? 'rgba(var(--brand-pink-rgb),0.5)' : 'rgba(var(--brand-aqua-rgb),0.6)',
        background: bad ? 'rgba(var(--brand-pink-rgb),0.12)' : 'rgba(var(--brand-aqua-rgb),0.15)',
      }}
    >
      {FLAG_LABELS[flag] ?? flag}
    </span>
  );
}

function CsatDots({ value }: { value: number | null }) {
  if (value === null) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="inline-flex items-center gap-1" title={`CSAT ${value}/5`} aria-label={`CSAT ${value} out of 5`}>
      <span className="text-foreground font-medium" style={{ fontVariantNumeric: 'tabular-nums' }}>{value}</span>
      <span className="inline-flex gap-[2px]">
        {[1, 2, 3, 4, 5].map((i) => (
          <span key={i} className="block w-1.5 h-1.5 rounded-full" style={{ background: i <= value ? (value <= 2 ? palette.pink : palette.accent) : GRID }} />
        ))}
      </span>
    </span>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SatisfactionPage() {
  const qc = useQueryClient();
  const [range, setRange] = useState<Range>('30d');
  const [syncState, setSyncState] = useState<SyncState>('idle');
  const [syncNote, setSyncNote] = useState<string>('');
  const syncedOnce = useRef(false);

  const days = RANGE_DAYS[range];
  const now = useMemo(() => new Date(), [range]); // eslint-disable-line react-hooks/exhaustive-deps
  const start = startOfDay(subDays(now, days - 1));
  const prevStart = startOfDay(subDays(start, days));
  const weekly = days > 31;

  // Pull current + previous period in one query (previous period feeds the deltas).
  const { data: rows = [], isLoading, isFetching, dataUpdatedAt } = useQuery({
    queryKey: ['dialpad-calls', range],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('dialpad_calls')
        .select('call_id,started_at,direction,status,duration_seconds,ring_seconds,external_number,contact_name,agent_id,agent_name,is_transferred,mos_score,positive_moments,negative_moments,ai_csat,ai_sentiment,ai_resolved,ai_purpose,ai_summary,ai_flags,ai_graded_at,ai_skip_reason,synced_at')
        .gte('started_at', prevStart.toISOString())
        .order('started_at', { ascending: false })
        .limit(5000);
      if (error) throw error;
      return (data ?? []) as CallRow[];
    },
    staleTime: 60_000,
  });

  // ── Sync trigger (page load, if stale; plus manual button) ───────────────
  const runSync = async (manual = false) => {
    setSyncState('syncing');
    setSyncNote(manual ? 'Syncing calls from Dialpad…' : 'Checking Dialpad for new calls…');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Not signed in');
      let more = true;
      let passes = 0;
      let totals = { pulled: 0, graded: 0 };
      while (more && passes < (manual ? 4 : 2)) {
        passes++;
        const r = await fetch('/api/dialpad-sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ phase: 'all' }),
        });
        if (!r.ok) throw new Error(`Sync failed (${r.status})`);
        const j = await r.json();
        totals = { pulled: totals.pulled + (j.pull?.upserted ?? 0), graded: totals.graded + (j.grade?.graded ?? 0) };
        more = Boolean(j.more);
        await qc.invalidateQueries({ queryKey: ['dialpad-calls'] });
      }
      setSyncState('done');
      setSyncNote(`${totals.pulled} calls checked · ${totals.graded} graded${more ? ' · more pending' : ''}`);
    } catch (err) {
      setSyncState('error');
      setSyncNote(err instanceof Error ? err.message : 'Sync failed');
    }
  };

  useEffect(() => {
    if (isLoading || syncedOnce.current) return;
    syncedOnce.current = true;
    const lastSync = rows.reduce((m, r) => Math.max(m, new Date(r.synced_at).getTime()), 0);
    if (Date.now() - lastSync > SYNC_STALE_MS) void runSync(false);
  }, [isLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Slices ────────────────────────────────────────────────────────────────
  const period = useMemo(() => rows.filter((r) => new Date(r.started_at) >= start), [rows, start]);
  const previous = useMemo(() => rows.filter((r) => { const d = new Date(r.started_at); return d >= prevStart && d < start; }), [rows, prevStart, start]);

  const stats = useMemo(() => {
    const build = (xs: CallRow[]) => {
      const graded = xs.filter(isGraded);
      const answered = xs.filter((c) => c.status === 'answered');
      const inbound = xs.filter((c) => c.direction === 'inbound');
      const inboundAnswered = inbound.filter((c) => c.status === 'answered');
      const withMos = xs.filter((c) => c.mos_score !== null && c.status === 'answered');
      return {
        csat: mean(graded.map((c) => c.ai_csat as number)),
        gradedCount: graded.length,
        positivePct: pct(graded.filter((c) => c.ai_sentiment === 'positive').length, graded.length),
        negativePct: pct(graded.filter((c) => c.ai_sentiment === 'negative').length, graded.length),
        resolvedPct: pct(graded.filter((c) => c.ai_resolved).length, graded.length),
        answerRate: pct(inboundAnswered.length, inbound.length),
        inboundCount: inbound.length,
        missed: inbound.filter((c) => c.status !== 'answered').length,
        voicemail: xs.filter((c) => c.status === 'voicemail').length,
        handle: mean(answered.map((c) => c.duration_seconds)),
        ring: mean(inboundAnswered.map((c) => c.ring_seconds ?? 0).filter((v) => v > 0)),
        mos: mean(withMos.map((c) => Number(c.mos_score))),
        total: xs.length,
        outbound: xs.length - inbound.length,
        attention: graded.filter((c) => (c.ai_csat ?? 5) <= 2 || c.ai_flags.some((f) => ATTENTION_FLAGS.has(f))).length,
      };
    };
    return { cur: build(period), prev: build(previous) };
  }, [period, previous]);

  // ── Chart series ──────────────────────────────────────────────────────────
  const buckets = useMemo(() => {
    const opts = { weekStartsOn: 1 as const };
    const keys = weekly ? eachWeekOfInterval({ start, end: now }, opts) : eachDayOfInterval({ start, end: now });
    const inBucket = (d: Date, k: Date) => (weekly ? isSameWeek(d, k, opts) : isSameDay(d, k));
    return keys.map((k) => {
      const xs = period.filter((c) => inBucket(new Date(c.started_at), k));
      const graded = xs.filter(isGraded);
      return {
        key: k,
        label: format(k, weekly ? 'd MMM' : 'EEE d'),
        csat: mean(graded.map((c) => c.ai_csat as number)),
        graded: graded.length,
        positive: graded.filter((c) => c.ai_sentiment === 'positive').length,
        neutral: graded.filter((c) => c.ai_sentiment === 'neutral').length,
        negative: -graded.filter((c) => c.ai_sentiment === 'negative').length,
        inbound: xs.filter((c) => c.direction === 'inbound').length,
        outbound: xs.filter((c) => c.direction === 'outbound').length,
        missed: xs.filter((c) => c.direction === 'inbound' && c.status !== 'answered').length,
      };
    });
  }, [period, start, now, weekly]);

  const purposes = useMemo(() => {
    const m = new Map<string, { count: number; csat: number[] }>();
    for (const c of period.filter(isGraded)) {
      const k = c.ai_purpose ?? 'Other';
      const e = m.get(k) ?? { count: 0, csat: [] };
      e.count++; e.csat.push(c.ai_csat as number); m.set(k, e);
    }
    return [...m.entries()].map(([name, e]) => ({ name, count: e.count, csat: mean(e.csat) })).sort((a, b) => b.count - a.count).slice(0, 8);
  }, [period]);

  const flags = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of period.filter(isGraded)) for (const f of c.ai_flags) m.set(f, (m.get(f) ?? 0) + 1);
    return Object.keys(FLAG_LABELS).map((f) => ({ flag: f, name: FLAG_LABELS[f], count: m.get(f) ?? 0 })).filter((x) => x.count > 0);
  }, [period]);

  const agents = useMemo(() => {
    const m = new Map<string, CallRow[]>();
    for (const c of period) { const k = c.agent_name ?? 'Unassigned'; m.set(k, [...(m.get(k) ?? []), c]); }
    return [...m.entries()].map(([name, xs]) => {
      const graded = xs.filter(isGraded);
      const answered = xs.filter((c) => c.status === 'answered');
      const inbound = xs.filter((c) => c.direction === 'inbound');
      return {
        name,
        calls: xs.length,
        answered: answered.length,
        answerRate: pct(inbound.filter((c) => c.status === 'answered').length, inbound.length),
        csat: mean(graded.map((c) => c.ai_csat as number)),
        graded: graded.length,
        resolvedPct: pct(graded.filter((c) => c.ai_resolved).length, graded.length),
        handle: mean(answered.map((c) => c.duration_seconds)),
        mos: mean(answered.filter((c) => c.mos_score !== null).map((c) => Number(c.mos_score))),
        negative: graded.filter((c) => c.ai_sentiment === 'negative').length,
      };
    }).sort((a, b) => b.calls - a.calls);
  }, [period]);

  const attention = useMemo(
    () => period.filter(isGraded).filter((c) => (c.ai_csat ?? 5) <= 2 || c.ai_flags.some((f) => ATTENTION_FLAGS.has(f))).slice(0, 25),
    [period],
  );
  const recentGraded = useMemo(() => period.filter(isGraded).slice(0, 12), [period]);

  const ungraded = period.filter((c) => c.status === 'answered' && c.ai_graded_at === null && c.ai_skip_reason === null).length;
  const dimmed = isFetching && !isLoading;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="p-4 md:p-6 space-y-5 max-w-[1400px]">
      {/* Header + filter row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-heading">SATISFACTION</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Customer sentiment and call metrics from Dialpad. CSAT is Claude's 1–5 read of each transcript; Dialpad surveys aren't enabled.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex border border-border">
            {(['7d', '30d', '90d'] as Range[]).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRange(r)}
                className={cn('px-3 py-1.5 text-xs font-heading tracking-wide transition-colors', range === r ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground')}
              >
                {r === '7d' ? 'Last 7 days' : r === '30d' ? 'Last 30 days' : 'Last 90 days'}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => runSync(true)}
            disabled={syncState === 'syncing'}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-border text-muted-foreground hover:text-foreground disabled:opacity-60"
            title="Pull new calls from Dialpad and grade any that are waiting"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', syncState === 'syncing' && 'animate-spin')} />
            {syncState === 'syncing' ? 'Syncing' : 'Sync now'}
          </button>
        </div>
      </div>

      {(syncNote || ungraded > 0) && (
        <div className="text-[11px] text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
          {syncNote && <span style={{ color: syncState === 'error' ? palette.pink : undefined }}>{syncNote}</span>}
          {ungraded > 0 && <span>{ungraded} answered call{ungraded === 1 ? '' : 's'} still waiting for a transcript grade</span>}
          {dataUpdatedAt > 0 && <span>Data as of {format(new Date(dataUpdatedAt), 'HH:mm')}</span>}
        </div>
      )}

      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => <div key={i} className="bg-card border border-border h-20 animate-pulse" />)}
        </div>
      ) : period.length === 0 ? (
        <div className="bg-card border border-border p-8 text-center text-sm text-muted-foreground">
          No Dialpad calls in this period yet. {syncState === 'syncing' ? 'Syncing now…' : 'Use Sync now to pull them in.'}
        </div>
      ) : (
        <div className={cn('space-y-5 transition-opacity', dimmed && 'opacity-60')}>
          {/* KPI row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatTile
              label="Avg CSAT (1–5)"
              value={fmt1(stats.cur.csat)}
              delta={fmtDelta(stats.cur.csat, stats.prev.csat, 1)}
              deltaGood={stats.cur.csat !== null && stats.prev.csat !== null ? stats.cur.csat >= stats.prev.csat : null}
              hint={`${stats.cur.gradedCount} graded call${stats.cur.gradedCount === 1 ? '' : 's'}`}
            />
            <StatTile
              label="Positive sentiment"
              value={fmtPct(stats.cur.positivePct)}
              delta={fmtDelta(stats.cur.positivePct, stats.prev.positivePct, 0, ' pts')}
              deltaGood={stats.cur.positivePct !== null && stats.prev.positivePct !== null ? stats.cur.positivePct >= stats.prev.positivePct : null}
              hint={stats.cur.negativePct !== null ? `${stats.cur.negativePct}% negative` : undefined}
            />
            <StatTile
              label="Resolved on the call"
              value={fmtPct(stats.cur.resolvedPct)}
              delta={fmtDelta(stats.cur.resolvedPct, stats.prev.resolvedPct, 0, ' pts')}
              deltaGood={stats.cur.resolvedPct !== null && stats.prev.resolvedPct !== null ? stats.cur.resolvedPct >= stats.prev.resolvedPct : null}
            />
            <StatTile
              label="Needs attention"
              value={String(stats.cur.attention)}
              delta={fmtDelta(stats.cur.attention, stats.prev.attention, 0)}
              deltaGood={stats.cur.attention <= stats.prev.attention}
              hint="CSAT ≤ 2 or flagged"
            />
            <StatTile
              label="Inbound answer rate"
              value={fmtPct(stats.cur.answerRate)}
              delta={fmtDelta(stats.cur.answerRate, stats.prev.answerRate, 0, ' pts')}
              deltaGood={stats.cur.answerRate !== null && stats.prev.answerRate !== null ? stats.cur.answerRate >= stats.prev.answerRate : null}
              hint={`${stats.cur.missed} missed · ${stats.cur.voicemail} to voicemail`}
            />
            <StatTile
              label="Avg handle time"
              value={fmtDuration(stats.cur.handle)}
              delta={fmtDelta(stats.cur.handle !== null ? stats.cur.handle / 60 : null, stats.prev.handle !== null ? stats.prev.handle / 60 : null, 1, ' min')}
              deltaGood={null}
              hint={stats.cur.ring !== null ? `Answered in ${fmtDuration(stats.cur.ring)} on average` : undefined}
            />
            <StatTile
              label="Call quality (MOS)"
              value={fmt2(stats.cur.mos)}
              delta={fmtDelta(stats.cur.mos, stats.prev.mos, 2)}
              deltaGood={stats.cur.mos !== null && stats.prev.mos !== null ? stats.cur.mos >= stats.prev.mos : null}
              hint="Dialpad audio score, 5 = perfect"
            />
            <StatTile
              label="Calls"
              value={String(stats.cur.total)}
              delta={fmtDelta(stats.cur.total, stats.prev.total, 0)}
              deltaGood={null}
              hint={`${stats.cur.inboundCount} in · ${stats.cur.outbound} out`}
            />
          </div>

          {/* Row 1: CSAT trend + sentiment mix */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <ChartCard
              title="CSAT TREND"
              subtitle={`Average graded CSAT per ${weekly ? 'week' : 'day'}`}
              table={{ columns: [weekly ? 'Week' : 'Day', 'Avg CSAT', 'Graded'], rows: buckets.map((b) => [b.label, fmt1(b.csat), b.graded]) }}
            >
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={buckets} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: INK_MUTED, fontSize: 11 }} axisLine={{ stroke: GRID }} tickLine={false} interval="preserveStartEnd" minTickGap={24} />
                  <YAxis domain={[1, 5]} ticks={[1, 2, 3, 4, 5]} tick={{ fill: INK_MUTED, fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip {...TOOLTIP_STYLE} formatter={(v: number | null, _n, p) => [v === null ? '—' : `${Number(v).toFixed(2)} (${p.payload.graded} calls)`, 'Avg CSAT']} />
                  <ReferenceLine y={4} stroke={DEEMPHASIS} strokeWidth={1} label={{ value: 'target 4.0', fill: INK_MUTED, fontSize: 10, position: 'insideTopRight' }} />
                  <Line type="monotone" dataKey="csat" stroke={palette.accent} strokeWidth={2} connectNulls dot={{ r: 4, fill: palette.accent, stroke: SURFACE, strokeWidth: 2 }} activeDot={{ r: 6, stroke: SURFACE, strokeWidth: 2 }} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard
              title="SENTIMENT MIX"
              subtitle="Graded calls per period · negative shown below the line"
              table={{ columns: [weekly ? 'Week' : 'Day', 'Positive', 'Neutral', 'Negative'], rows: buckets.map((b) => [b.label, b.positive, b.neutral, -b.negative]) }}
            >
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={buckets} stackOffset="sign" margin={{ top: 8, right: 12, left: -18, bottom: 0 }} barGap={2}>
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: INK_MUTED, fontSize: 11 }} axisLine={{ stroke: GRID }} tickLine={false} interval="preserveStartEnd" minTickGap={24} />
                  <YAxis tick={{ fill: INK_MUTED, fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} tickFormatter={(v) => String(Math.abs(v))} />
                  <Tooltip {...TOOLTIP_STYLE} formatter={(v: number, name: string) => [Math.abs(v), name]} />
                  <Legend iconType="rect" iconSize={8} wrapperStyle={{ fontSize: 11, color: INK_MUTED }} />
                  <ReferenceLine y={0} stroke={GRID} />
                  <Bar dataKey="positive" name="Positive" stackId="s" fill={palette.aqua} maxBarSize={24} stroke={SURFACE} strokeWidth={1} isAnimationActive={false} />
                  <Bar dataKey="neutral" name="Neutral" stackId="s" fill={DEEMPHASIS} maxBarSize={24} stroke={SURFACE} strokeWidth={1} isAnimationActive={false} />
                  <Bar dataKey="negative" name="Negative" stackId="s" fill={palette.pink} maxBarSize={24} stroke={SURFACE} strokeWidth={1} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          {/* Row 2: volume + purposes + flags */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <ChartCard
              title="CALL VOLUME"
              subtitle="Inbound vs outbound"
              table={{ columns: [weekly ? 'Week' : 'Day', 'Inbound', 'Outbound', 'Missed'], rows: buckets.map((b) => [b.label, b.inbound, b.outbound, b.missed]) }}
            >
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={buckets} margin={{ top: 8, right: 8, left: -18, bottom: 0 }} barGap={2}>
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: INK_MUTED, fontSize: 11 }} axisLine={{ stroke: GRID }} tickLine={false} interval="preserveStartEnd" minTickGap={24} />
                  <YAxis tick={{ fill: INK_MUTED, fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip {...TOOLTIP_STYLE} />
                  <Legend iconType="rect" iconSize={8} wrapperStyle={{ fontSize: 11, color: INK_MUTED }} />
                  <Bar dataKey="inbound" name="Inbound" stackId="v" fill={palette.accent} maxBarSize={24} stroke={SURFACE} strokeWidth={1} isAnimationActive={false} />
                  <Bar dataKey="outbound" name="Outbound" stackId="v" fill={palette.aqua} maxBarSize={24} radius={[4, 4, 0, 0]} stroke={SURFACE} strokeWidth={1} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard
              title="WHY CUSTOMERS CALL"
              subtitle="Graded calls by purpose"
              table={{ columns: ['Purpose', 'Calls', 'Avg CSAT'], rows: purposes.map((p) => [p.name, p.count, fmt1(p.csat)]) }}
            >
              <ResponsiveContainer width="100%" height={Math.max(220, purposes.length * 30 + 20)}>
                <BarChart data={purposes} layout="vertical" margin={{ top: 4, right: 32, left: 8, bottom: 0 }}>
                  <CartesianGrid stroke={GRID} horizontal={false} />
                  <XAxis type="number" tick={{ fill: INK_MUTED, fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" width={130} tick={{ fill: INK_MUTED, fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip {...TOOLTIP_STYLE} formatter={(v: number, _n, p) => [`${v} calls · avg CSAT ${fmt1(p.payload.csat)}`, 'Calls']} />
                  <Bar dataKey="count" name="Calls" fill={palette.accent} maxBarSize={18} radius={[0, 4, 4, 0]} isAnimationActive={false} label={{ position: 'right', fill: INK_MUTED, fontSize: 11 }} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard
              title="FLAGS RAISED"
              subtitle="Signals Claude picked out of transcripts"
              table={{ columns: ['Flag', 'Calls'], rows: flags.map((f) => [f.name, f.count]) }}
            >
              {flags.length === 0 ? (
                <div className="h-[220px] flex items-center justify-center text-xs text-muted-foreground">No flags in this period</div>
              ) : (
                <ResponsiveContainer width="100%" height={Math.max(220, flags.length * 30 + 20)}>
                  <BarChart data={flags} layout="vertical" margin={{ top: 4, right: 32, left: 8, bottom: 0 }}>
                    <CartesianGrid stroke={GRID} horizontal={false} />
                    <XAxis type="number" tick={{ fill: INK_MUTED, fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <YAxis type="category" dataKey="name" width={120} tick={{ fill: INK_MUTED, fontSize: 11 }} axisLine={false} tickLine={false} />
                    <Tooltip {...TOOLTIP_STYLE} />
                    <Bar dataKey="count" name="Calls" maxBarSize={18} radius={[0, 4, 4, 0]} isAnimationActive={false} label={{ position: 'right', fill: INK_MUTED, fontSize: 11 }}>
                      {flags.map((f) => <Cell key={f.flag} fill={ATTENTION_FLAGS.has(f.flag) ? palette.pink : palette.aqua} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>
          </div>

          {/* Agents */}
          <div className="bg-card border border-border p-4 overflow-x-auto">
            <h3 className="text-xs font-heading tracking-wider text-muted-foreground mb-3">BY TEAM MEMBER</h3>
            <table className="w-full text-xs" style={{ fontVariantNumeric: 'tabular-nums' }}>
              <thead>
                <tr className="text-muted-foreground">
                  {['Agent', 'Calls', 'Answered', 'Answer rate', 'Avg CSAT', 'Resolved', 'Negative', 'Avg handle', 'MOS'].map((h) => (
                    <th key={h} className={cn('font-medium py-1.5 pr-3 border-b border-border', h === 'Agent' ? 'text-left' : 'text-right')}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {agents.map((a) => (
                  <tr key={a.name} className="border-b border-border/50">
                    <td className="py-1.5 pr-3 text-foreground">{a.name}</td>
                    <td className="py-1.5 pr-3 text-right">{a.calls}</td>
                    <td className="py-1.5 pr-3 text-right">{a.answered}</td>
                    <td className="py-1.5 pr-3 text-right">{fmtPct(a.answerRate)}</td>
                    <td className="py-1.5 pr-3 text-right">{fmt1(a.csat)}{a.graded ? <span className="text-muted-foreground"> ({a.graded})</span> : null}</td>
                    <td className="py-1.5 pr-3 text-right">{fmtPct(a.resolvedPct)}</td>
                    <td className="py-1.5 pr-3 text-right">{a.negative}</td>
                    <td className="py-1.5 pr-3 text-right">{fmtDuration(a.handle)}</td>
                    <td className="py-1.5 pr-3 text-right">{fmt2(a.mos)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Attention list + recent graded */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            <div className="bg-card border border-border p-4">
              <h3 className="text-xs font-heading tracking-wider text-muted-foreground mb-1">NEEDS ATTENTION</h3>
              <p className="text-[11px] text-muted-foreground/80 mb-3">Low CSAT or flagged as complaint, escalation, churn risk, or unresolved</p>
              {attention.length === 0 ? (
                <div className="text-xs text-muted-foreground py-6 text-center">Nothing flagged in this period</div>
              ) : (
                <ul className="divide-y divide-border/50">
                  {attention.map((c) => <CallItem key={c.call_id} c={c} />)}
                </ul>
              )}
            </div>
            <div className="bg-card border border-border p-4">
              <h3 className="text-xs font-heading tracking-wider text-muted-foreground mb-1">LATEST GRADED CALLS</h3>
              <p className="text-[11px] text-muted-foreground/80 mb-3">What Claude read in the most recent transcripts</p>
              {recentGraded.length === 0 ? (
                <div className="text-xs text-muted-foreground py-6 text-center">No graded calls yet</div>
              ) : (
                <ul className="divide-y divide-border/50">
                  {recentGraded.map((c) => <CallItem key={c.call_id} c={c} />)}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CallItem({ c }: { c: CallRow }) {
  return (
    <li className="py-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs text-foreground truncate">
            {c.contact_name ?? c.external_number ?? 'Unknown caller'}
            <span className="text-muted-foreground"> · {c.direction === 'inbound' ? 'in' : 'out'} · {c.agent_name ?? '—'} · {fmtDuration(c.duration_seconds)}</span>
          </div>
          {c.ai_summary && <div className="text-[11px] text-muted-foreground mt-0.5">{c.ai_summary}</div>}
          {c.ai_flags.length > 0 && <div className="flex flex-wrap gap-1 mt-1">{c.ai_flags.map((f) => <FlagChip key={f} flag={f} />)}</div>}
        </div>
        <div className="text-right shrink-0">
          <CsatDots value={c.ai_csat} />
          <div className="text-[10px] text-muted-foreground mt-0.5">{format(new Date(c.started_at), 'd MMM HH:mm')}</div>
          {c.ai_purpose && <div className="text-[10px] text-muted-foreground">{c.ai_purpose}</div>}
        </div>
      </div>
    </li>
  );
}
