// Accounts › Stat Breakdown — monthly Revenue / Cost / Profit split two ways:
//   1. Customer type — Cin7 customer tags (no tag → Consumers, D → Distributors,
//      F → Fleet, A → Bespoke)
//   2. Product category — Electrical (parent, broken down into Lighting,
//      Behind Grille Lighting and Electrical), Communication, Storage, Safety,
//      Other (every remaining Cin7 category)
// Figures come from stat_breakdown_monthly (fed by the stat-breakdown-sync edge
// fn from Cin7 invoice lines; GST-exclusive, cost = Cin7 AverageCost at invoice
// time, credit notes subtracted). Sync: hourly pg_cron + the shared Sync button.

import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ResponsiveContainer, ComposedChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell,
} from 'recharts'
import { LayersIcon, TargetIcon, TriangleAlertIcon, ChartBarIcon } from '@portal/components/icons'
import { supabase } from '@portal/lib/supabase'
import { palette } from '@portal/lib/palette'
import { useIsMobile } from '../../../hooks/useIsMobile.js'
import { GRAINS, buildOptions, periodKeys, chartKeys, toKey, monthLabel } from './periods.js'
import { useFinanceSync, SYNC_LABEL } from './financeSync.js'

const C = {
  bg: '#0a0a0a', panel: '#161616', surface: '#1e1e1e',
  border: '#2a2a2a', borderSoft: '#1c1c1c',
  text: '#f8fafc', muted: '#a0a0a0', faint: '#666666',
  accent: palette.accent, green: palette.aqua, red: palette.pink,
}
const MONO = '"JetBrains Mono", monospace'

// Fixed segment order + hue, so charts and tables never re-shuffle.
// Hues come from the DISTINCT categorical ramp (--cat-1..8) — the single-hue
// brand accents alias each other (gold === orange, aqua === blue), which made
// stacked segments indistinguishable.
const CAT = palette.cat // [orange, teal, red, deep red, cream, orange 300, teal 400, red 400]
const GREY = '#a0a0a0' // neutral segment hue (per Damian: grey, not cream)
const CUSTOMER_SEGMENTS = [
  { key: 'Consumers',    hue: CAT[0] }, // orange
  { key: 'Distributors', hue: CAT[1] }, // teal
  { key: 'Fleet',        hue: GREY, stackTop: true }, // rendered last → top of the stacked bars
  { key: 'Bespoke',      hue: CAT[2] }, // red
]
// Category tree: `children` are the leaf buckets stored in the DB; a segment
// with children is a parent whose figures are the sum of its leaves. The chart
// stacks top-level segments; the table indents the children beneath the parent.
const CATEGORY_SEGMENTS = [
  { key: 'Electrical', hue: CAT[0], children: [ // orange
    { key: 'Lighting',               hue: CAT[0] },
    { key: 'Behind Grille Lighting', hue: CAT[0] },
    { key: 'Electrical',             hue: CAT[0] },
  ] },
  { key: 'Communication', hue: CAT[1] }, // teal
  { key: 'Storage',       hue: GREY },
  { key: 'Safety',        hue: CAT[2] }, // red
  { key: 'Other',         hue: CAT[6] }, // teal 400
]
const METRICS = [
  { key: 'revenue', label: 'Revenue' },
  { key: 'cost',    label: 'Cost' },
  { key: 'profit',  label: 'Profit' },
]

const fmt0 = new Intl.NumberFormat('en-AU', { maximumFractionDigits: 0 })
function money(v) {
  if (v == null || Number.isNaN(v)) return '—'
  return v < 0 ? `-$${fmt0.format(Math.abs(v))}` : `$${fmt0.format(v)}`
}
function compact(v) {
  if (v == null) return '—'
  const a = Math.abs(v), s = v < 0 ? '-' : ''
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(1)}m`
  if (a >= 1e3) return `${s}$${Math.round(a / 1e3)}k`
  return `${s}$${Math.round(a)}`
}
const pct = (v, dp = 1) => (v == null || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(dp)}%`)

function useStatBreakdown() {
  return useQuery({
    queryKey: ['stat-breakdown'],
    queryFn: async () => {
      const [rows, pending, state] = await Promise.all([
        supabase.from('stat_breakdown_monthly').select('*').order('period_month'),
        supabase.from('cin7_stat_pending').select('*', { count: 'exact', head: true }),
        supabase.from('cin7_stat_sync_state').select('last_run, last_error').eq('id', 1).maybeSingle(),
      ])
      if (rows.error) throw rows.error
      return {
        rows: rows.data ?? [],
        pending: pending.count ?? 0,
        state: state.data ?? null,
      }
    },
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    // While a backfill/sync is draining, keep the tab filling in by itself.
    refetchInterval: (query) => (query.state.data?.pending > 0 ? 30_000 : false),
  })
}

function Panel({ title, icon: Icon, right, children }) {
  const isMobile = useIsMobile()
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 8, padding: isMobile ? 12 : 18, display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          {Icon && <Icon size={15} strokeWidth={1.5} style={{ color: C.accent }} />}
          <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{title}</span>
        </div>
        {right}
      </div>
      {children}
    </div>
  )
}

function ChartTip({ active, payload, label, segments }) {
  if (!active || !payload?.length) return null
  const total = payload.reduce((s, p) => s + (p.value ?? 0), 0)
  const hueOf = (name) => segments.find((s) => s.key === name)?.hue ?? C.text
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 5, padding: '8px 10px', fontFamily: MONO, fontSize: 11 }}>
      <div style={{ color: C.muted, marginBottom: 4 }}>{label} · total {money(total)}</div>
      {[...payload].reverse().map((p) => (
        <div key={p.dataKey} style={{ color: hueOf(p.name) }}>{p.name}: {money(p.value)}</div>
      ))}
    </div>
  )
}

function Legend({ segments }) {
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
      {segments.map((s) => (
        <span key={s.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, color: C.muted, fontFamily: MONO }}>
          <span style={{ width: 9, height: 9, borderRadius: 2, background: s.hue, display: 'inline-block' }} />
          {s.key}
        </span>
      ))}
    </div>
  )
}

// A segment's figures for one month: its own leaf bucket, or (for a parent
// with children) the sum of its leaf buckets.
function segmentValues(byseg, seg) {
  const leaves = seg.children ?? [seg]
  const out = { revenue: 0, cost: 0, profit: 0 }
  for (const leaf of leaves) {
    const r = byseg?.get(leaf.key)
    if (!r) continue
    out.revenue += r.revenue
    out.cost += r.cost
    out.profit += r.profit
  }
  return out
}

// A segment summed over a list of month keys (the selected period).
function segmentPeriodValues(rowsByMonth, monthKeys, seg) {
  const out = { revenue: 0, cost: 0, profit: 0 }
  for (const m of monthKeys) {
    const v = segmentValues(rowsByMonth.get(m), seg)
    out.revenue += v.revenue
    out.cost += v.cost
    out.profit += v.profit
  }
  return out
}

// Clickable column header; shows the active sort arrow.
function SortHeader({ label, colKey, align = 'right', sort, onSort, style }) {
  const active = sort.key === colKey
  return (
    <span
      onClick={() => onSort(colKey)}
      title="Click to sort"
      style={{ ...style, textAlign: align, cursor: 'pointer', userSelect: 'none', color: active ? C.text : style?.color }}>
      {label}{active ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
    </span>
  )
}

function PieTip({ active, payload }) {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload
  if (!d) return null
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 5, padding: '8px 10px', fontFamily: MONO, fontSize: 11 }}>
      <div style={{ color: d.hue, marginBottom: 2 }}>{d.name}</div>
      <div style={{ color: C.text }}>{money(d.real)}{d.share != null ? ` · ${pct(d.share)}` : ''}</div>
    </div>
  )
}

// One cross-section: chart (stacked monthly bars or period pie) + table for the
// selected period.
function Breakdown({ title, icon, segments, rowsByMonth, chartMonths, periodMonths, periodLabel, metric, chartType }) {
  const isMobile = useIsMobile()

  const chartData = useMemo(() => chartMonths.map((m) => {
    const row = { label: monthLabel(m) } // 'MMM YY'
    const byseg = rowsByMonth.get(m)
    for (const s of segments) row[s.key] = segmentValues(byseg, s)[metric]
    return row
  }), [chartMonths, segments, rowsByMonth, metric])

  const tableRows = useMemo(() => {
    const rows = segments.map((s) => ({
      key: s.key, hue: s.hue, ...segmentPeriodValues(rowsByMonth, periodMonths, s),
      children: s.children?.map((c) => ({ key: c.key, hue: c.hue, ...segmentPeriodValues(rowsByMonth, periodMonths, c) })),
    }))
    const total = rows.reduce((t, r) => ({ revenue: t.revenue + r.revenue, cost: t.cost + r.cost, profit: t.profit + r.profit }), { revenue: 0, cost: 0, profit: 0 })
    return { rows, total }
  }, [rowsByMonth, periodMonths, segments])

  // Click a column header to sort; click again to flip. key null = the fixed
  // segment order. Children sort within their parent by the same column.
  const [sort, setSort] = useState({ key: null, dir: 'desc' })
  const toggleSort = (key) =>
    setSort((s) => (s.key === key
      ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: key === 'name' ? 'asc' : 'desc' }))
  const sortedRows = useMemo(() => {
    if (!sort.key) return tableRows.rows
    const val = (r) => {
      if (sort.key === 'name') return r.key
      if (sort.key === 'margin') return r.revenue ? r.profit / r.revenue : null
      if (sort.key === 'share') return r.revenue
      return r[sort.key]
    }
    const mul = sort.dir === 'asc' ? 1 : -1
    const cmp = (a, b) => {
      const av = val(a), bv = val(b)
      if (typeof av === 'string') return mul * av.localeCompare(bv)
      if (av == null && bv == null) return 0
      if (av == null) return 1 // nulls last, regardless of direction
      if (bv == null) return -1
      return mul * (av - bv)
    }
    return [...tableRows.rows].sort(cmp).map((r) => (
      r.children ? { ...r, children: [...r.children].sort(cmp) } : r
    ))
  }, [tableRows, sort])

  const grid = {
    display: 'grid',
    gridTemplateColumns: isMobile ? '1.3fr repeat(3, 1fr)' : '1.6fr repeat(4, 1fr) 1fr',
    gap: 10, alignItems: 'center',
  }
  const th = { fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.07em', color: C.muted, textAlign: 'right' }

  // Pie: the selected period's split per top-level segment. Negative values
  // (e.g. a loss-making segment on the Profit metric) can't be a slice — they
  // render at 0 with the true figure in the tooltip.
  const pieData = useMemo(() => {
    const rows = tableRows.rows.map((r) => ({ name: r.key, hue: r.hue, real: r[metric], value: Math.max(0, r[metric]) }))
    const sum = rows.reduce((s, r) => s + r.value, 0)
    return rows.map((r) => ({ ...r, share: sum ? r.value / sum : null }))
  }, [tableRows, metric])
  const pieTotal = tableRows.total[metric]

  const pieLabel = ({ cx, cy, midAngle, outerRadius, percent, payload }) => {
    if (!percent || percent < 0.04) return null
    const RAD = Math.PI / 180
    const x = cx + (outerRadius + 12) * Math.cos(-midAngle * RAD)
    const y = cy + (outerRadius + 12) * Math.sin(-midAngle * RAD)
    return (
      <text x={x} y={y} fill={C.muted} fontSize={10.5} fontFamily={MONO}
        textAnchor={x > cx ? 'start' : 'end'} dominantBaseline="central">
        {`${(percent * 100).toFixed(0)}%`}
      </text>
    )
  }

  return (
    <Panel title={title} icon={icon} right={<Legend segments={segments} />}>
      {chartType === 'pie' ? (
        <ResponsiveContainer width="100%" height={isMobile ? 210 : 240}>
          <PieChart>
            <Tooltip content={<PieTip />} />
            <Pie data={pieData} dataKey="value" nameKey="name"
              innerRadius="55%" outerRadius="78%" paddingAngle={2}
              stroke={C.panel} strokeWidth={2}
              labelLine={false} label={pieLabel} isAnimationActive={false}>
              {pieData.map((d) => <Cell key={d.name} fill={d.hue} fillOpacity={0.85} />)}
            </Pie>
            {/* Period total in the donut centre */}
            <text x="50%" y="47%" textAnchor="middle" fill={C.text} fontSize={17} fontWeight={600} fontFamily={MONO}>
              {compact(pieTotal)}
            </text>
            <text x="50%" y="47%" dy={16} textAnchor="middle" fill={C.faint} fontSize={9.5} fontFamily={MONO} letterSpacing="0.1em">
              {METRICS.find((m) => m.key === metric)?.label.toUpperCase()} · {periodLabel}
            </text>
          </PieChart>
        </ResponsiveContainer>
      ) : (
      <ResponsiveContainer width="100%" height={isMobile ? 190 : 230}>
        <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: isMobile ? 0 : 6, bottom: 0 }}>
          <CartesianGrid stroke={C.borderSoft} vertical={false} />
          <XAxis dataKey="label" tick={{ fill: C.muted, fontSize: 10 }} axisLine={{ stroke: C.border }} tickLine={false} />
          <YAxis tick={{ fill: C.muted, fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={compact} width={isMobile ? 40 : 48} />
          <Tooltip content={<ChartTip segments={segments} />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
          {/* Recharts stacks in render order (first = bottom); stackTop segments go last */}
          {[...segments.filter((s) => !s.stackTop), ...segments.filter((s) => s.stackTop)].map((s, i) => (
            <Bar key={s.key} dataKey={s.key} name={s.key} stackId="m" fill={s.hue}
              fillOpacity={0.8} radius={i === segments.length - 1 ? [2, 2, 0, 0] : [0, 0, 0, 0]}
              isAnimationActive={false} />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
      )}

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ ...grid, paddingBottom: 8, borderBottom: `1px solid ${C.border}` }}>
          <SortHeader label={periodLabel ?? '—'} colKey="name" align="left" sort={sort} onSort={toggleSort} style={th} />
          <SortHeader label="Revenue" colKey="revenue" sort={sort} onSort={toggleSort} style={th} />
          <SortHeader label="Cost" colKey="cost" sort={sort} onSort={toggleSort} style={th} />
          <SortHeader label="Profit" colKey="profit" sort={sort} onSort={toggleSort} style={th} />
          {!isMobile && <SortHeader label="Margin" colKey="margin" sort={sort} onSort={toggleSort} style={th} />}
          {!isMobile && <SortHeader label="% of Rev" colKey="share" sort={sort} onSort={toggleSort} style={th} />}
        </div>
        {sortedRows.map((r) => (
          <div key={r.key}>
            <div style={{ ...grid, fontSize: 12.5, padding: '8px 0', borderBottom: r.children ? 'none' : `1px solid ${C.borderSoft}`, fontWeight: r.children ? 600 : 400 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 7, color: C.text, minWidth: 0 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: r.hue, flexShrink: 0 }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.key}</span>
              </span>
              <span style={{ textAlign: 'right', fontFamily: MONO, color: C.text }}>{money(r.revenue)}</span>
              <span style={{ textAlign: 'right', fontFamily: MONO, color: C.muted }}>{money(r.cost)}</span>
              <span style={{ textAlign: 'right', fontFamily: MONO, color: r.profit >= 0 ? C.green : C.red }}>{money(r.profit)}</span>
              {!isMobile && <span style={{ textAlign: 'right', fontFamily: MONO, color: C.muted }}>{r.revenue ? pct(r.profit / r.revenue) : '—'}</span>}
              {!isMobile && <span style={{ textAlign: 'right', fontFamily: MONO, color: C.faint }}>{tableRows.total.revenue ? pct(r.revenue / tableRows.total.revenue) : '—'}</span>}
            </div>
            {r.children?.map((c, ci) => (
              <div key={c.key} style={{ ...grid, fontSize: 12, padding: '6px 0', color: C.muted, borderBottom: ci === r.children.length - 1 ? `1px solid ${C.borderSoft}` : 'none' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 7, paddingLeft: 15, minWidth: 0 }}>
                  <span style={{ width: 6, height: 6, borderRadius: 2, background: c.hue, opacity: 0.55, flexShrink: 0 }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.key}</span>
                </span>
                <span style={{ textAlign: 'right', fontFamily: MONO }}>{money(c.revenue)}</span>
                <span style={{ textAlign: 'right', fontFamily: MONO, color: C.faint }}>{money(c.cost)}</span>
                <span style={{ textAlign: 'right', fontFamily: MONO, color: c.profit >= 0 ? C.green : C.red, opacity: 0.85 }}>{money(c.profit)}</span>
                {!isMobile && <span style={{ textAlign: 'right', fontFamily: MONO }}>{c.revenue ? pct(c.profit / c.revenue) : '—'}</span>}
                {!isMobile && <span style={{ textAlign: 'right', fontFamily: MONO, color: C.faint }}>{tableRows.total.revenue ? pct(c.revenue / tableRows.total.revenue) : '—'}</span>}
              </div>
            ))}
          </div>
        ))}
        <div style={{ ...grid, fontSize: 12.5, padding: '9px 0 2px', fontWeight: 600 }}>
          <span style={{ color: C.text }}>Total</span>
          <span style={{ textAlign: 'right', fontFamily: MONO, color: C.text }}>{money(tableRows.total.revenue)}</span>
          <span style={{ textAlign: 'right', fontFamily: MONO, color: C.muted }}>{money(tableRows.total.cost)}</span>
          <span style={{ textAlign: 'right', fontFamily: MONO, color: tableRows.total.profit >= 0 ? C.green : C.red }}>{money(tableRows.total.profit)}</span>
          {!isMobile && <span style={{ textAlign: 'right', fontFamily: MONO, color: C.muted }}>{tableRows.total.revenue ? pct(tableRows.total.profit / tableRows.total.revenue) : '—'}</span>}
          {!isMobile && <span />}
        </div>
      </div>
    </Panel>
  )
}

export default function StatBreakdown() {
  const { data, isLoading, error, refetch } = useStatBreakdown()
  const qc = useQueryClient()
  const isMobile = useIsMobile()
  const { state: syncState, busy: syncBusy, run: runSync } = useFinanceSync()
  const [metric, setMetric] = useState('revenue')
  // Same period filter as the Finance Dashboard: grain + anchor (periods.js).
  const [grain, setGrain] = useState('month')
  const [anchor, setAnchor] = useState(null)
  // Chart style — a single month has no trend to stack, so Month grain is
  // always a pie; Bar becomes selectable on CY/FY.
  const [chartTypeRaw, setChartTypeRaw] = useState('bar')
  const chartType = grain === 'month' ? 'pie' : chartTypeRaw

  // 'YYYY-MM' → segment → {revenue, cost, profit}, per dimension
  const { customerByMonth, categoryByMonth, availableKeys } = useMemo(() => {
    const cust = new Map(), cat = new Map()
    const keySet = new Set()
    for (const r of data?.rows ?? []) {
      const m = toKey(String(r.period_month))
      keySet.add(m)
      const target = r.dimension === 'customer' ? cust : cat
      if (!target.has(m)) target.set(m, new Map())
      target.get(m).set(r.segment, { revenue: Number(r.revenue), cost: Number(r.cost), profit: Number(r.profit) })
    }
    return { customerByMonth: cust, categoryByMonth: cat, availableKeys: [...keySet].sort() }
  }, [data])

  const options = useMemo(() => buildOptions(grain, availableKeys), [grain, availableKeys])
  const effAnchor = (anchor && options.some((o) => o.value === anchor) ? anchor : null)
    ?? options[options.length - 1]?.value ?? null
  const periodLabel = options.find((o) => o.value === effAnchor)?.label ?? '—'
  const periodMonths = useMemo(() => effAnchor ? periodKeys(grain, effAnchor) : [], [grain, effAnchor])
  const chartMonths = useMemo(() => effAnchor ? chartKeys(grain, effAnchor) : [], [grain, effAnchor])

  if (isLoading) return <Centered>Loading stat breakdown…</Centered>
  if (error) return <Centered tone={C.red}>Failed to load: {error.message}</Centered>

  return (
    <div style={{ height: '100%', overflow: 'auto', background: C.bg, padding: isMobile ? 12 : 20, fontFamily: 'Inter, system-ui, sans-serif' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>

        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 600, color: C.text, margin: 0 }}>Sales Mix</h1>
            <span style={{ fontSize: 12, color: C.muted, fontFamily: MONO }}>
              Cin7 invoiced sales · GST-exclusive · cost = Cin7 avg cost at invoice
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {/* Metric toggle drives both charts; tables always show all three. */}
            <div style={{ display: 'flex', background: C.panel, border: `1px solid ${C.border}`, borderRadius: 7, padding: 2 }}>
              {METRICS.map((m) => (
                <button key={m.key} onClick={() => setMetric(m.key)}
                  style={{
                    border: 'none', cursor: 'pointer', padding: '6px 12px', borderRadius: 5, fontSize: 11.5,
                    fontFamily: MONO,
                    background: metric === m.key ? C.accent : 'transparent',
                    color: metric === m.key ? C.bg : C.muted, fontWeight: metric === m.key ? 600 : 400,
                    transition: 'background 120ms, color 120ms',
                  }}>
                  {m.label}
                </button>
              ))}
            </div>
            {/* Chart style — Bar is disabled on Month grain (pie only) */}
            <div style={{ display: 'flex', background: C.panel, border: `1px solid ${C.border}`, borderRadius: 7, padding: 2 }}>
              {[{ key: 'bar', label: 'Bar' }, { key: 'pie', label: 'Pie' }].map((t) => {
                const disabled = t.key === 'bar' && grain === 'month'
                const active = chartType === t.key
                return (
                  <button key={t.key} onClick={() => !disabled && setChartTypeRaw(t.key)}
                    disabled={disabled}
                    title={disabled ? 'Single-month view is always a pie' : undefined}
                    style={{
                      border: 'none', cursor: disabled ? 'default' : 'pointer', padding: '6px 12px', borderRadius: 5, fontSize: 11.5,
                      fontFamily: MONO,
                      background: active ? C.accent : 'transparent',
                      color: active ? C.bg : disabled ? C.faint : C.muted, fontWeight: active ? 600 : 400,
                      opacity: disabled ? 0.5 : 1,
                      transition: 'background 120ms, color 120ms',
                    }}>
                    {t.label}
                  </button>
                )
              })}
            </div>
            {/* Same period filter as the Finance Dashboard */}
            <div style={{ display: 'flex', background: C.panel, border: `1px solid ${C.border}`, borderRadius: 7, padding: 2 }}>
              {GRAINS.map((g) => (
                <button key={g.key} onClick={() => { setGrain(g.key); setAnchor(null) }}
                  style={{
                    border: 'none', cursor: 'pointer', padding: '6px 12px', borderRadius: 5, fontSize: 11.5,
                    fontFamily: MONO,
                    background: grain === g.key ? C.accent : 'transparent',
                    color: grain === g.key ? C.bg : C.muted, fontWeight: grain === g.key ? 600 : 400,
                    transition: 'background 120ms, color 120ms',
                  }}>
                  {g.label}
                </button>
              ))}
            </div>
            <select value={effAnchor ?? ''} onChange={(e) => setAnchor(e.target.value)}
              style={{
                background: C.panel, color: C.text, border: `1px solid ${C.border}`, borderRadius: 7,
                padding: '7px 10px', fontSize: 12, fontFamily: MONO, cursor: 'pointer',
              }}>
              {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <button onClick={() => runSync(qc)} disabled={syncBusy}
              title="Sync Xero + Cin7 across all finance apps"
              style={{
                display: 'flex', alignItems: 'center', gap: 6, cursor: syncBusy ? 'wait' : 'pointer',
                background: C.panel, color: syncState === 'error' ? C.red : syncState === 'done' ? C.green : C.text,
                border: `1px solid ${C.border}`, borderRadius: 7,
                padding: '7px 12px', fontSize: 11.5, fontFamily: MONO,
              }}>
              {SYNC_LABEL[syncState] ?? 'Sync all'}
            </button>
          </div>
        </div>

        {data.pending > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(224,159,62,0.12)', border: '1px solid rgba(224,159,62,0.3)', borderRadius: 8, padding: '11px 14px' }}>
            <TriangleAlertIcon size={16} strokeWidth={1.6} style={{ color: C.accent, flexShrink: 0 }} />
            <span style={{ fontSize: 12.5, color: C.muted }}>
              Sync in progress — <strong style={{ color: C.accent }}>{fmt0.format(data.pending)}</strong> sales still queued.
              Figures below are incomplete and will fill in automatically.
            </span>
            <button onClick={() => refetch()} style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: C.accent, cursor: 'pointer', fontSize: 11.5, fontFamily: MONO }}>refresh</button>
          </div>
        )}
        {data.state?.last_error && (
          <div style={{ fontSize: 11.5, color: C.red, fontFamily: MONO }}>Last sync error: {data.state.last_error}</div>
        )}

        {availableKeys.length === 0 ? (
          <Centered>No data yet — press Sync all to pull Cin7 sales.</Centered>
        ) : (
          <>
            <Breakdown title="By Customer Type" icon={TargetIcon} segments={CUSTOMER_SEGMENTS}
              rowsByMonth={customerByMonth} chartMonths={chartMonths} periodMonths={periodMonths}
              periodLabel={periodLabel} metric={metric} chartType={chartType} />
            <Breakdown title="By Product Category" icon={ChartBarIcon} segments={CATEGORY_SEGMENTS}
              rowsByMonth={categoryByMonth} chartMonths={chartMonths} periodMonths={periodMonths}
              periodLabel={periodLabel} metric={metric} chartType={chartType} />
            <span style={{ fontSize: 10.5, color: C.faint, fontFamily: MONO }}>
              Customer types from Cin7 customer tags (D = Distributors, F = Fleet, A = Bespoke, otherwise Consumers).
              Electrical = Lighting + Behind Grille Lighting + Electrical; Other = all remaining Cin7 categories.
              Product lines only (freight/charges excluded); credit notes subtracted in their month.
            </span>
          </>
        )}
      </div>
    </div>
  )
}

function Centered({ children, tone = C.muted }) {
  return (
    <div style={{ height: '100%', minHeight: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: tone, fontSize: 13, background: C.bg, gap: 8 }}>
      <LayersIcon size={14} strokeWidth={1.5} /> {children}
    </div>
  )
}
