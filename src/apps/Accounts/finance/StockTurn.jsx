// Accounts › Stock Turn — per-SKU stock turn and the overall Stock Turn Ratio.
//
//   Stock turn        = annualised COGS ÷ average stock value (at Cin7 average cost)
//   GP %              = (revenue − COGS) ÷ revenue
//   Stock Turn Ratio  = stock turn × GP% (as a number) — 5 turns × 40% GP = 200. Target 200+.
//   Days of stock     = 365 ÷ stock turn
//
// Sales come from Cin7 invoice lines (cin7_sale_product_lines, written by the
// stat-breakdown-sync edge fn; GST-exclusive, credit notes subtracted). Stock
// comes from daily snapshots (cin7_stock_snapshots, stock-turn-snapshot edge fn);
// the average stock value is the mean of the snapshots inside the window, or the
// latest snapshot while history is still accumulating. Both RPCs live in
// migration 20260903000001_stock_turn.sql. Drop-ship products (Cin7 DropShipMode
// other than "No Drop Ship") are excluded from stock, sales and the trend.

import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine, Cell,
} from 'recharts'
import { RefreshIcon, TriangleAlertIcon, ChartBarIcon, ChartLineIcon, StackIcon } from '@portal/components/icons'
import { supabase } from '@portal/lib/supabase'
import { palette } from '@portal/lib/palette'
import { useIsMobile } from '../../../hooks/useIsMobile.js'
import { monthLabel, toKey } from './periods.js'
import { useFinanceSync, SYNC_LABEL } from './financeSync.js'

const C = {
  bg: '#0a0a0a', panel: '#161616', surface: '#1e1e1e',
  border: '#2a2a2a', borderSoft: '#1c1c1c',
  text: '#f8fafc', muted: '#a0a0a0', faint: '#666666',
  accent: palette.accent, green: palette.aqua, red: palette.pink,
}
const MONO = '"JetBrains Mono", monospace'
const TARGET = 200

const WINDOWS = [
  { key: 3, label: '3 mo' },
  { key: 6, label: '6 mo' },
  { key: 12, label: '12 mo' },
]

// Status buckets, in display order. `none` = no stock and no sales in the window.
const STATUS = {
  target: { label: 'On target', hue: C.green,   desc: `Ratio ≥ ${TARGET}` },
  below:  { label: 'Below',     hue: C.accent,  desc: `Ratio 100–${TARGET - 1}` },
  poor:   { label: 'Poor',      hue: C.red,     desc: 'Ratio < 100' },
  dead:   { label: 'No sales',  hue: '#a0a0a0', desc: 'Stock held, nothing sold in the window' },
  none:   { label: 'No stock',  hue: C.faint,   desc: 'Sold in the window, none on hand now' },
}
const ratioStatus = (ratio) => (ratio == null ? 'poor' : ratio >= TARGET ? 'target' : ratio >= 100 ? 'below' : 'poor')

const fmt0 = new Intl.NumberFormat('en-AU', { maximumFractionDigits: 0 })
const fmt1 = new Intl.NumberFormat('en-AU', { maximumFractionDigits: 1, minimumFractionDigits: 1 })
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
const num = (v, dp = 0) => (v == null || !Number.isFinite(v) ? '—' : (dp ? fmt1 : fmt0).format(v))
const pct = (v, dp = 1) => (v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(dp)}%`)
const turnFmt = (v) => (v == null ? '—' : v === Infinity ? '∞' : `${fmt1.format(v)}×`)
const ratioFmt = (v) => (v == null ? '—' : v === Infinity ? '∞' : fmt0.format(v))

// Window = the last N complete calendar months (the current month is partial and
// would drag the annualised figures down). Returns first-of-month ISO dates.
function windowFor(months, now = new Date()) {
  const end = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const start = new Date(end.getFullYear(), end.getMonth() - (months - 1), 1)
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
  return { from: iso(start), to: iso(end), fromKey: toKey(iso(start)), toKey: toKey(iso(end)) }
}

// Turn / GP / ratio for any bundle of {cogs, revenue, avgStock, stockValue} over `months`.
function metricsOf({ cogs, revenue, avgStock, stockValue }, months) {
  const cogsAnn = cogs * (12 / months)
  // Net credit in the window (cogs ≤ 0, e.g. a returned item) is not a turn — treat as no sales
  const turn = cogs > 0 ? (avgStock > 0 ? cogsAnn / avgStock : Infinity) : null
  const gp = revenue > 0 ? ((revenue - cogs) / revenue) * 100 : null
  let ratio = null
  if (turn != null && gp != null) ratio = turn === Infinity ? (gp > 0 ? Infinity : null) : turn * gp
  const days = turn != null && turn !== Infinity && turn > 0 ? 365 / turn : null
  let status
  if (stockValue <= 0 && cogs <= 0 && revenue <= 0) status = 'none'
  else if (stockValue > 0 && cogs <= 0 && revenue <= 0) status = 'dead'
  else if (ratio == null) status = stockValue > 0 ? 'poor' : 'none'
  else status = ratioStatus(ratio)
  return { cogsAnn, turn, gp, ratio, days, status }
}

function useStockTurn(months) {
  const win = useMemo(() => windowFor(months), [months])
  return useQuery({
    queryKey: ['stock-turn', months],
    queryFn: async () => {
      const [report, trend, pending, state, snaps] = await Promise.all([
        supabase.rpc('stock_turn_report', { p_from: win.from, p_to: win.to }),
        supabase.rpc('stock_turn_trend'),
        supabase.from('cin7_stat_pending').select('*', { count: 'exact', head: true }),
        supabase.from('cin7_stat_sync_state').select('last_run, last_error, last_snapshot, last_snapshot_error').eq('id', 1).maybeSingle(),
        supabase.from('cin7_stock_snapshots').select('snapshot_date').order('snapshot_date', { ascending: false }).limit(1),
      ])
      if (report.error) throw report.error
      if (trend.error) throw trend.error
      return {
        rows: report.data ?? [],
        trend: trend.data ?? [],
        pending: pending.count ?? 0,
        state: state.data ?? null,
        latestSnapshot: snaps.data?.[0]?.snapshot_date ?? null,
        window: win,
      }
    },
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    refetchInterval: (query) => (query.state.data?.pending > 0 ? 30_000 : false),
  })
}

function Panel({ title, icon: Icon, right, children, style }) {
  const isMobile = useIsMobile()
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 8, padding: isMobile ? 12 : 18, display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0, ...style }}>
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

function Tile({ label, value, sub, hue, children }) {
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 8, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: C.muted, fontFamily: MONO }}>{label}</span>
      <span style={{ fontSize: 24, fontWeight: 600, color: hue ?? C.text, fontFamily: MONO, lineHeight: 1.15 }}>{value}</span>
      {sub && <span style={{ fontSize: 11, color: C.faint, fontFamily: MONO }}>{sub}</span>}
      {children}
    </div>
  )
}

// Progress toward the 200 target; the bar's scale runs to 1.5× target so
// over-achievement still has room to show.
function TargetBar({ ratio }) {
  const max = TARGET * 1.5
  const v = ratio == null ? 0 : ratio === Infinity ? max : Math.min(ratio, max)
  return (
    <div style={{ position: 'relative', height: 6, background: C.surface, borderRadius: 3, marginTop: 8 }}>
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${(v / max) * 100}%`, background: STATUS[ratioStatus(ratio)].hue, borderRadius: 3, transition: 'width 300ms' }} />
      <div title={`Target ${TARGET}`} style={{ position: 'absolute', left: `${(TARGET / max) * 100}%`, top: -3, bottom: -3, width: 2, background: C.text, opacity: 0.7 }} />
    </div>
  )
}

function Pill({ status }) {
  const s = STATUS[status]
  return (
    <span style={{ display: 'inline-block', padding: '2px 7px', borderRadius: 4, fontSize: 10, fontFamily: MONO, color: s.hue, background: `${s.hue}1f`, border: `1px solid ${s.hue}55`, whiteSpace: 'nowrap' }}>
      {s.label}
    </span>
  )
}

function SortHeader({ label, colKey, align = 'right', sort, onSort, style, title }) {
  const active = sort.key === colKey
  return (
    <span onClick={() => onSort(colKey)} title={title ?? 'Click to sort'}
      style={{ ...style, textAlign: align, cursor: 'pointer', userSelect: 'none', color: active ? C.text : style?.color, whiteSpace: 'nowrap' }}>
      {label}{active ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
    </span>
  )
}

function CategoryTip({ active, payload }) {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload
  if (!d) return null
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 5, padding: '8px 10px', fontFamily: MONO, fontSize: 11 }}>
      <div style={{ color: C.text, marginBottom: 3 }}>{d.name}</div>
      <div style={{ color: C.muted }}>Ratio {ratioFmt(d.ratio)} · Turn {turnFmt(d.turn)} · GP {pct(d.gp)}</div>
      <div style={{ color: C.faint }}>Stock {money(d.stockValue)} · COGS {money(d.cogs)} ({d.skus} SKUs)</div>
    </div>
  )
}

function TrendTip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload
  if (!d) return null
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 5, padding: '8px 10px', fontFamily: MONO, fontSize: 11 }}>
      <div style={{ color: C.muted, marginBottom: 3 }}>{label}</div>
      <div style={{ color: C.text }}>COGS {money(d.cogs)} · GP {pct(d.gp)}</div>
      <div style={{ color: d.ratio == null ? C.faint : C.accent }}>
        {d.ratio == null ? 'No stock snapshot for this month' : `Ratio ${ratioFmt(d.ratio)} · Turn ${turnFmt(d.turn)} · Stock ${compact(d.avgStock)}`}
      </div>
    </div>
  )
}

const PAGE = 100
const CHART_MIN_STOCK = 100 // categories holding less than this (at cost) are noise on the ratio chart

export default function StockTurn() {
  const isMobile = useIsMobile()
  const qc = useQueryClient()
  const { state: syncState, busy: syncBusy, run: runSync } = useFinanceSync()
  const [months, setMonths] = useState(12)
  const { data, isLoading, error, refetch } = useStockTurn(months)

  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [hideNone, setHideNone] = useState(true)
  const [sort, setSort] = useState({ key: 'ratio', dir: 'desc' })
  const [limit, setLimit] = useState(PAGE)
  const toggleSort = (key) => {
    setLimit(PAGE)
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'sku' || key === 'category' ? 'asc' : 'desc' }))
  }

  // Per-SKU rows with derived metrics
  const rows = useMemo(() => (data?.rows ?? []).map((r) => {
    const base = {
      id: r.product_id, sku: r.sku, name: r.name ?? '', category: r.category || 'Uncategorised', brand: r.brand ?? '', pstatus: r.status ?? '',
      onHand: Number(r.on_hand), available: Number(r.available), onOrder: Number(r.on_order), avgCost: Number(r.avg_cost),
      stockValue: Number(r.stock_value), avgStock: Number(r.avg_stock_value),
      qty: Number(r.qty_sold), revenue: Number(r.revenue), cogs: Number(r.cogs),
    }
    return { ...base, ...metricsOf(base, months) }
  }), [data, months])

  const categories = useMemo(() => [...new Set(rows.map((r) => r.category))].sort(), [rows])

  // Overall figures — every SKU, regardless of table filters
  const overall = useMemo(() => {
    const t = rows.reduce((a, r) => ({
      cogs: a.cogs + r.cogs, revenue: a.revenue + r.revenue, avgStock: a.avgStock + r.avgStock, stockValue: a.stockValue + r.stockValue,
      inStock: a.inStock + (r.stockValue > 0 ? 1 : 0), dead: a.dead + (r.status === 'dead' ? r.stockValue : 0), deadN: a.deadN + (r.status === 'dead' ? 1 : 0),
    }), { cogs: 0, revenue: 0, avgStock: 0, stockValue: 0, inStock: 0, dead: 0, deadN: 0 })
    return { ...t, ...metricsOf(t, months) }
  }, [rows, months])

  // Category rollup, best ratio first
  const byCategory = useMemo(() => {
    const m = new Map()
    for (const r of rows) {
      const c = m.get(r.category) ?? { name: r.category, cogs: 0, revenue: 0, avgStock: 0, stockValue: 0, skus: 0 }
      c.cogs += r.cogs; c.revenue += r.revenue; c.avgStock += r.avgStock; c.stockValue += r.stockValue; c.skus += 1
      m.set(r.category, c)
    }
    const rank = (v) => (v == null ? -1 : v === Infinity ? 1e9 : v)
    return [...m.values()].map((c) => ({ ...c, ...metricsOf(c, months) }))
      .filter((c) => c.stockValue > 0 || c.cogs > 0)
      .sort((a, b) => rank(b.ratio) - rank(a.ratio))
  }, [rows, months])

  // Monthly trend — ratio only where a stock snapshot exists for that month
  const trend = useMemo(() => {
    const cur = toKey(new Date().toISOString())
    return (data?.trend ?? []).map((t) => {
      const cogs = Number(t.cogs), revenue = Number(t.revenue)
      const avgStock = t.avg_stock_value == null ? null : Number(t.avg_stock_value)
      const gp = revenue > 0 ? ((revenue - cogs) / revenue) * 100 : null
      const turn = avgStock > 0 ? (cogs * 12) / avgStock : null
      const ratio = turn != null && gp != null ? turn * gp : null
      const key = toKey(String(t.period_month))
      return { key, label: monthLabel(key), cogs, revenue, gp, avgStock, turn, ratio }
    }).filter((t) => t.key <= cur).slice(-18) // drop stray future-dated invoices
  }, [data])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    let list = rows
    if (hideNone) list = list.filter((r) => r.status !== 'none')
    if (category) list = list.filter((r) => r.category === category)
    if (statusFilter) list = list.filter((r) => r.status === statusFilter)
    if (q) list = list.filter((r) => r.sku.toLowerCase().includes(q) || r.name.toLowerCase().includes(q) || r.brand.toLowerCase().includes(q))
    const rank = (v) => (v == null ? null : v === Infinity ? Number.MAX_VALUE : v)
    const val = (r) => (sort.key === 'sku' || sort.key === 'category' ? r[sort.key] : rank(r[sort.key]))
    const mul = sort.dir === 'asc' ? 1 : -1
    return [...list].sort((a, b) => {
      const av = val(a), bv = val(b)
      if (typeof av === 'string') return mul * av.localeCompare(bv)
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      return mul * (av - bv)
    })
  }, [rows, search, category, statusFilter, hideNone, sort])

  const filteredTotal = useMemo(() => {
    const t = filtered.reduce((a, r) => ({ cogs: a.cogs + r.cogs, revenue: a.revenue + r.revenue, avgStock: a.avgStock + r.avgStock, stockValue: a.stockValue + r.stockValue, qty: a.qty + r.qty, onHand: a.onHand + r.onHand }),
      { cogs: 0, revenue: 0, avgStock: 0, stockValue: 0, qty: 0, onHand: 0 })
    return { ...t, ...metricsOf(t, months) }
  }, [filtered, months])

  if (isLoading) return <Centered>Loading stock turn…</Centered>
  if (error) return <Centered tone={C.red}>Failed to load: {error.message}</Centered>

  const win = data.window
  const chartCategories = byCategory.filter((c) => c.stockValue >= CHART_MIN_STOCK)
  const windowLabel = `${monthLabel(win.fromKey)} – ${monthLabel(win.toKey)}`
  const snapshotDays = data.rows[0]?.snapshot_days ?? null
  const noSnapshot = !data.latestSnapshot
  const noSales = rows.every((r) => r.cogs === 0 && r.revenue === 0)

  const grid = {
    display: 'grid',
    gridTemplateColumns: isMobile
      ? 'minmax(0, 2fr) repeat(3, minmax(0, 1fr)) 64px'
      : 'minmax(0, 2.4fr) minmax(0, 1.1fr) repeat(8, minmax(0, 0.9fr)) 84px',
    gap: 8, alignItems: 'center',
  }
  const th = { fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.07em', color: C.muted, textAlign: 'right' }
  const cellR = { textAlign: 'right', fontFamily: MONO, fontSize: 12 }
  const input = { background: C.panel, color: C.text, border: `1px solid ${C.border}`, borderRadius: 7, padding: '7px 10px', fontSize: 12, fontFamily: MONO }

  return (
    <div style={{ height: '100%', overflow: 'auto', background: C.bg, padding: isMobile ? 12 : 20, fontFamily: 'Inter, system-ui, sans-serif' }}>
      <div style={{ maxWidth: 1280, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Header */}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 600, color: C.text, margin: 0 }}>Stock Turn</h1>
            <span style={{ fontSize: 12, color: C.muted, fontFamily: MONO }}>
              {windowLabel} · annualised · stock at Cin7 avg cost · Ratio = turn × GP% (target {TARGET}+)
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', background: C.panel, border: `1px solid ${C.border}`, borderRadius: 7, padding: 2 }}>
              {WINDOWS.map((w) => (
                <button key={w.key} onClick={() => { setMonths(w.key); setLimit(PAGE) }}
                  style={{
                    border: 'none', cursor: 'pointer', padding: '6px 12px', borderRadius: 5, fontSize: 11.5, fontFamily: MONO,
                    background: months === w.key ? C.accent : 'transparent',
                    color: months === w.key ? C.bg : C.muted, fontWeight: months === w.key ? 600 : 400,
                    transition: 'background 120ms, color 120ms',
                  }}>
                  {w.label}
                </button>
              ))}
            </div>
            <button onClick={() => runSync(qc)} disabled={syncBusy}
              title="Sync Xero + Cin7 across all finance apps (includes a fresh stock snapshot)"
              style={{
                display: 'flex', alignItems: 'center', gap: 6, cursor: syncBusy ? 'wait' : 'pointer',
                background: C.panel, color: syncState === 'error' ? C.red : syncState === 'done' ? C.green : C.text,
                border: `1px solid ${C.border}`, borderRadius: 7, padding: '7px 12px', fontSize: 11.5, fontFamily: MONO,
              }}>
              {SYNC_LABEL[syncState] ?? 'Sync all'}
            </button>
          </div>
        </div>

        {/* Notices */}
        {data.pending > 0 && (
          <Notice>
            <span>Sync in progress — <strong style={{ color: C.accent }}>{fmt0.format(data.pending)}</strong> sales still queued. Sales figures below are incomplete and will fill in automatically.</span>
            <button onClick={() => refetch()} style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: C.accent, cursor: 'pointer', fontSize: 11.5, fontFamily: MONO }}>refresh</button>
          </Notice>
        )}
        {noSnapshot && <Notice>No stock snapshot yet — press Sync all to take the first one.</Notice>}
        {!noSnapshot && snapshotDays != null && snapshotDays < 28 && (
          <Notice tone="info">
            Average stock value is based on {snapshotDays === 0 ? 'the latest snapshot only' : `${snapshotDays} daily snapshot${snapshotDays === 1 ? '' : 's'}`}
            {' '}(daily snapshots began {formatDate(data.latestSnapshot)}). It becomes a true average as history accumulates.
          </Notice>
        )}
        {(data.state?.last_error || data.state?.last_snapshot_error) && (
          <div style={{ fontSize: 11.5, color: C.red, fontFamily: MONO }}>
            Last sync error: {data.state.last_error || data.state.last_snapshot_error}
          </div>
        )}

        {rows.length === 0 ? (
          <Centered>No data yet — press Sync all to pull Cin7 stock and sales.</Centered>
        ) : (
          <>
            {/* KPI tiles */}
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(5, 1fr)', gap: 12 }}>
              <Tile label="Stock Turn Ratio" value={ratioFmt(overall.ratio)} hue={STATUS[ratioStatus(overall.ratio)].hue}
                sub={overall.ratio == null ? 'needs sales + stock' : overall.ratio >= TARGET ? `on target (${TARGET}+)` : `${fmt0.format(TARGET - overall.ratio)} below target`}>
                <TargetBar ratio={overall.ratio} />
              </Tile>
              <Tile label="Stock turn" value={turnFmt(overall.turn)} sub={overall.days ? `${fmt0.format(overall.days)} days of stock` : 'annualised'} />
              <Tile label="Gross profit" value={pct(overall.gp)} sub={`on ${compact(overall.revenue)} revenue`} />
              <Tile label="Stock at cost" value={compact(overall.stockValue)} sub={`${fmt0.format(overall.inStock)} SKUs on hand · avg ${compact(overall.avgStock)}`} />
              <Tile label="No-sales stock" value={compact(overall.dead)} hue={overall.dead > 0 ? C.red : undefined}
                sub={`${fmt0.format(overall.deadN)} SKUs unsold in ${months} mo · COGS ${compact(overall.cogsAnn)}/yr`} />
            </div>

            {/* Charts */}
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 16 }}>
              <Panel title="Ratio by category" icon={ChartBarIcon}
                right={<span style={{ fontSize: 10.5, color: C.faint, fontFamily: MONO }}>dashed line = target {TARGET} · categories with ≥ {money(CHART_MIN_STOCK)} stock</span>}>
                <ResponsiveContainer width="100%" height={Math.max(180, chartCategories.length * 26 + 30)}>
                  {/* Bars are clamped to 0…3× target for display; the tooltip shows the true ratio */}
                  <ComposedChart layout="vertical" data={chartCategories.map((c) => ({ ...c, value: c.ratio == null ? 0 : c.ratio === Infinity ? TARGET * 2 : Math.max(0, Math.min(c.ratio, TARGET * 3)) }))}
                    margin={{ top: 4, right: 12, left: 4, bottom: 0 }}>
                    <CartesianGrid stroke={C.borderSoft} horizontal={false} />
                    <XAxis type="number" domain={[0, 'auto']} tick={{ fill: C.muted, fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="name" width={isMobile ? 90 : 130} tick={{ fill: C.muted, fontSize: 10.5 }} axisLine={false} tickLine={false} />
                    <Tooltip content={<CategoryTip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                    <ReferenceLine x={TARGET} stroke={C.text} strokeOpacity={0.6} strokeDasharray="3 3" />
                    <Bar dataKey="value" isAnimationActive={false} radius={[0, 2, 2, 0]} fillOpacity={0.85}>
                      {chartCategories.map((c) => <Cell key={c.name} fill={STATUS[c.status].hue} />)}
                    </Bar>
                  </ComposedChart>
                </ResponsiveContainer>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1.6fr repeat(4, 1fr)', gap: 8, paddingBottom: 6, borderBottom: `1px solid ${C.border}` }}>
                    <span style={{ ...th, textAlign: 'left' }}>Category</span>
                    <span style={th}>Stock $</span>
                    <span style={th}>Turn</span>
                    <span style={th}>GP</span>
                    <span style={th}>Ratio</span>
                  </div>
                  {byCategory.map((c) => (
                    <div key={c.name} onClick={() => { setCategory(category === c.name ? '' : c.name); setLimit(PAGE) }}
                      title="Click to filter the table"
                      style={{ display: 'grid', gridTemplateColumns: '1.6fr repeat(4, 1fr)', gap: 8, padding: '6px 0', borderBottom: `1px solid ${C.borderSoft}`, cursor: 'pointer', background: category === c.name ? 'rgba(var(--brand-accent-rgb),0.06)' : 'transparent' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: C.text, minWidth: 0 }}>
                        <span style={{ width: 8, height: 8, borderRadius: 2, background: STATUS[c.status].hue, flexShrink: 0 }} />
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                        <span style={{ color: C.faint, fontSize: 10.5, fontFamily: MONO }}>{c.skus}</span>
                      </span>
                      <span style={{ ...cellR, color: C.muted }}>{money(c.stockValue)}</span>
                      <span style={{ ...cellR, color: C.muted }}>{turnFmt(c.turn)}</span>
                      <span style={{ ...cellR, color: C.muted }}>{pct(c.gp)}</span>
                      <span style={{ ...cellR, color: STATUS[c.status].hue, fontWeight: 600 }}>{ratioFmt(c.ratio)}</span>
                    </div>
                  ))}
                </div>
              </Panel>

              <Panel title="Monthly trend" icon={ChartLineIcon}
                right={<span style={{ fontSize: 10.5, color: C.faint, fontFamily: MONO }}>bars = COGS · line = ratio (month annualised)</span>}>
                <ResponsiveContainer width="100%" height={isMobile ? 200 : 250}>
                  <ComposedChart data={trend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke={C.borderSoft} vertical={false} />
                    <XAxis dataKey="label" tick={{ fill: C.muted, fontSize: 10 }} axisLine={{ stroke: C.border }} tickLine={false} />
                    <YAxis yAxisId="cogs" tick={{ fill: C.muted, fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={compact} width={44} />
                    <YAxis yAxisId="ratio" orientation="right" tick={{ fill: C.muted, fontSize: 10 }} axisLine={false} tickLine={false} width={36} domain={[0, (max) => Math.max(TARGET * 1.2, max || 0)]} />
                    <Tooltip content={<TrendTip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                    <ReferenceLine yAxisId="ratio" y={TARGET} stroke={C.text} strokeOpacity={0.5} strokeDasharray="3 3" />
                    <Bar yAxisId="cogs" dataKey="cogs" name="COGS" fill={C.faint} fillOpacity={0.55} isAnimationActive={false} radius={[2, 2, 0, 0]} />
                    <Line yAxisId="ratio" type="monotone" dataKey="ratio" name="Ratio" stroke={C.accent} strokeWidth={2} dot={{ r: 3, fill: C.accent }} connectNulls={false} isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
                <span style={{ fontSize: 10.5, color: C.faint, fontFamily: MONO }}>
                  The ratio line only appears for months with a stock snapshot — history builds from {data.latestSnapshot ? formatDate(data.latestSnapshot) : 'the first snapshot'} onward.
                </span>
              </Panel>
            </div>

            {/* Per-line table */}
            <Panel title="Stock turn by line" icon={StackIcon}
              right={
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <input value={search} onChange={(e) => { setSearch(e.target.value); setLimit(PAGE) }} placeholder="Search SKU / name / brand" style={{ ...input, width: isMobile ? 150 : 210 }} />
                  <select value={category} onChange={(e) => { setCategory(e.target.value); setLimit(PAGE) }} style={{ ...input, cursor: 'pointer' }}>
                    <option value="">All categories</option>
                    {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setLimit(PAGE) }} style={{ ...input, cursor: 'pointer' }}>
                    <option value="">All statuses</option>
                    {Object.entries(STATUS).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
                  </select>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: C.muted, fontFamily: MONO, cursor: 'pointer' }}>
                    <input type="checkbox" checked={hideNone} onChange={(e) => { setHideNone(e.target.checked); setLimit(PAGE) }} />
                    hide no-stock
                  </label>
                </div>
              }>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                {Object.entries(STATUS).map(([k, s]) => (
                  <span key={k} title={s.desc} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, color: C.muted, fontFamily: MONO }}>
                    <span style={{ width: 9, height: 9, borderRadius: 2, background: s.hue, display: 'inline-block' }} />
                    {s.label} <span style={{ color: C.faint }}>{fmt0.format(rows.filter((r) => r.status === k).length)}</span>
                  </span>
                ))}
              </div>
              <div style={{ overflowX: 'auto' }}>
                <div style={{ minWidth: isMobile ? 520 : 960, display: 'flex', flexDirection: 'column' }}>
                  <div style={{ ...grid, paddingBottom: 8, borderBottom: `1px solid ${C.border}` }}>
                    <SortHeader label="SKU / Product" colKey="sku" align="left" sort={sort} onSort={toggleSort} style={th} />
                    {!isMobile && <SortHeader label="Category" colKey="category" align="left" sort={sort} onSort={toggleSort} style={th} />}
                    {!isMobile && <SortHeader label="On hand" colKey="onHand" sort={sort} onSort={toggleSort} style={th} />}
                    <SortHeader label="Stock $" colKey="stockValue" sort={sort} onSort={toggleSort} style={th} title="Latest on hand × avg cost" />
                    {!isMobile && <SortHeader label="Sold" colKey="qty" sort={sort} onSort={toggleSort} style={th} title={`Units invoiced, ${windowLabel}`} />}
                    {!isMobile && <SortHeader label="Revenue" colKey="revenue" sort={sort} onSort={toggleSort} style={th} />}
                    {!isMobile && <SortHeader label="COGS" colKey="cogs" sort={sort} onSort={toggleSort} style={th} />}
                    {!isMobile && <SortHeader label="GP" colKey="gp" sort={sort} onSort={toggleSort} style={th} />}
                    <SortHeader label="Turn" colKey="turn" sort={sort} onSort={toggleSort} style={th} title="Annualised COGS ÷ average stock value" />
                    {!isMobile && <SortHeader label="Days" colKey="days" sort={sort} onSort={toggleSort} style={th} title="365 ÷ stock turn" />}
                    <SortHeader label="Ratio" colKey="ratio" sort={sort} onSort={toggleSort} style={th} title="Stock turn × GP%" />
                    <span style={{ ...th, textAlign: 'left' }}>Status</span>
                  </div>
                  {filtered.slice(0, limit).map((r) => (
                    <div key={r.id} style={{ ...grid, padding: '7px 0', borderBottom: `1px solid ${C.borderSoft}` }}>
                      <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                        <span style={{ fontFamily: MONO, fontSize: 12, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.sku}</span>
                        <span title={r.name} style={{ fontSize: 11, color: C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name || '—'}</span>
                      </span>
                      {!isMobile && <span style={{ fontSize: 11.5, color: C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.category}</span>}
                      {!isMobile && <span style={{ ...cellR, color: C.muted }} title={`Available ${num(r.available)} · on order ${num(r.onOrder)}`}>{num(r.onHand)}</span>}
                      <span style={{ ...cellR, color: C.text }} title={`Avg over window ${money(r.avgStock)} · avg cost ${money(r.avgCost)}`}>{money(r.stockValue)}</span>
                      {!isMobile && <span style={{ ...cellR, color: C.muted }}>{num(r.qty)}</span>}
                      {!isMobile && <span style={{ ...cellR, color: C.muted }}>{money(r.revenue)}</span>}
                      {!isMobile && <span style={{ ...cellR, color: C.muted }}>{money(r.cogs)}</span>}
                      {!isMobile && <span style={{ ...cellR, color: r.gp == null ? C.faint : r.gp >= 0 ? C.muted : C.red }}>{pct(r.gp)}</span>}
                      <span style={{ ...cellR, color: C.text }}>{turnFmt(r.turn)}</span>
                      {!isMobile && <span style={{ ...cellR, color: C.muted }}>{num(r.days)}</span>}
                      <span style={{ ...cellR, color: STATUS[r.status].hue, fontWeight: 600 }}>{ratioFmt(r.ratio)}</span>
                      <span><Pill status={r.status} /></span>
                    </div>
                  ))}
                  <div style={{ ...grid, padding: '9px 0 2px', fontWeight: 600 }}>
                    <span style={{ fontSize: 12, color: C.text }}>{fmt0.format(filtered.length)} lines</span>
                    {!isMobile && <span />}
                    {!isMobile && <span style={{ ...cellR, color: C.muted }}>{num(filteredTotal.onHand)}</span>}
                    <span style={{ ...cellR, color: C.text }}>{money(filteredTotal.stockValue)}</span>
                    {!isMobile && <span style={{ ...cellR, color: C.muted }}>{num(filteredTotal.qty)}</span>}
                    {!isMobile && <span style={{ ...cellR, color: C.muted }}>{money(filteredTotal.revenue)}</span>}
                    {!isMobile && <span style={{ ...cellR, color: C.muted }}>{money(filteredTotal.cogs)}</span>}
                    {!isMobile && <span style={{ ...cellR, color: C.muted }}>{pct(filteredTotal.gp)}</span>}
                    <span style={{ ...cellR, color: C.text }}>{turnFmt(filteredTotal.turn)}</span>
                    {!isMobile && <span style={{ ...cellR, color: C.muted }}>{num(filteredTotal.days)}</span>}
                    <span style={{ ...cellR, color: STATUS[filteredTotal.status].hue }}>{ratioFmt(filteredTotal.ratio)}</span>
                    <span />
                  </div>
                </div>
              </div>
              {filtered.length > limit && (
                <button onClick={() => setLimit((l) => l + PAGE)}
                  style={{ alignSelf: 'center', background: C.surface, color: C.text, border: `1px solid ${C.border}`, borderRadius: 7, padding: '7px 14px', fontSize: 11.5, fontFamily: MONO, cursor: 'pointer' }}>
                  Show {Math.min(PAGE, filtered.length - limit)} more of {fmt0.format(filtered.length - limit)}
                </button>
              )}
            </Panel>

            <span style={{ fontSize: 10.5, color: C.faint, fontFamily: MONO }}>
              Stock turn = COGS over the last {months} full months × {12 / months} ÷ average stock value (mean of daily snapshots in the window; latest snapshot until history exists).
              Ratio = stock turn × GP% as a number (e.g. 5 turns × 40% = 200). ∞ = sold in the window with no stock on hand now.
              Product lines only (freight/charges excluded; drop-ship products left out entirely); credit notes subtracted in their month.{noSales ? ' Sales backfill has not reached this window yet.' : ''}
            </span>
          </>
        )}
      </div>
    </div>
  )
}

function formatDate(iso) {
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`)
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
}

function Notice({ children, tone = 'warn' }) {
  const hue = tone === 'info' ? C.green : C.accent
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: `${hue}1f`, border: `1px solid ${hue}4d`, borderRadius: 8, padding: '11px 14px', fontSize: 12.5, color: C.muted }}>
      <TriangleAlertIcon size={16} strokeWidth={1.6} style={{ color: hue, flexShrink: 0 }} />
      <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', flex: 1 }}>{children}</span>
    </div>
  )
}

function Centered({ children, tone = C.muted }) {
  return (
    <div style={{ height: '100%', minHeight: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: tone, fontSize: 13, background: C.bg, gap: 8 }}>
      <RefreshIcon size={14} strokeWidth={1.5} /> {children}
    </div>
  )
}
