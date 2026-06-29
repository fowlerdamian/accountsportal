import { useMemo, useState, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import html2canvas from 'html2canvas'
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip,
  CartesianGrid, Cell, ReferenceLine,
} from 'recharts'
import {
  CurrencyDollarIcon, ChartLineIcon, GaugeIcon, TargetIcon, WalletIcon,
  TriangleAlertIcon, LayersIcon, ChartBarIcon,
} from '@portal/components/icons'
import { supabase } from '@portal/lib/supabase'
import { palette } from '@portal/lib/palette'
import {
  GRAINS, buildOptions, periodKeys, chartKeys, aggregate, toKey,
  prevAnchor, ytdWindow, periodElapsed,
} from './periods.js'

// ─── Theme ────────────────────────────────────────────────────────────────────
// Every value maps to a portal design token (src/index.css). Concrete hex is used
// (not var(--x)) so the colours also resolve inside recharts SVG attributes.

const C = {
  bg:           '#0a0a0a',                 // --bg-primary (near-black)
  panel:        '#161616',                 // --bg-elevated (dark grey, card)
  surface:      '#1e1e1e',                 // --bg-surface
  track:        '#1e1e1e',                 // bar tracks
  border:       '#2a2a2a',                 // --border-default
  borderSoft:   '#1c1c1c',                 // --border-subtle
  text:         '#f8fafc',                 // --text-primary (Off White)
  muted:        '#a0a0a0',                 // --text-secondary
  faint:        '#666666',                 // --text-tertiary
  cost:         '#666666',                 // neutral grey
  accentSubtle: 'rgba(224,159,62,0.12)',   // --accent-subtle (orange)
  // Brand accent hues — single source (src/index.css --brand-* via palette.js)
  accent:       palette.accent,
  revenue:      palette.accent,
  gold:         palette.gold,
  orange:       palette.orange,
  pink:         palette.pink,
  blue:         palette.blue,
  aqua:         palette.aqua,
  purple:       palette.purple,
  green:        palette.aqua,              // positive/good
  red:          palette.pink,              // negative/bad
  warning:      palette.orange,
}

// ─── Formatters ────────────────────────────────────────────────────────────────

const fmt0 = new Intl.NumberFormat('en-AU', { maximumFractionDigits: 0 })
const fmt2 = new Intl.NumberFormat('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
function money(v, dp = 0) {
  if (v == null || Number.isNaN(v)) return '—'
  const f = dp === 2 ? fmt2 : fmt0
  return v < 0 ? `-$${f.format(Math.abs(v))}` : `$${f.format(v)}`
}
function compact(v) {
  if (v == null) return '—'
  const a = Math.abs(v)
  if (a >= 1e6) return `$${(v / 1e6).toFixed(1)}m`
  if (a >= 1e3) return `$${Math.round(v / 1e3)}k`
  return `$${Math.round(v)}`
}
function pct(v, dp = 1) { return v == null ? '—' : `${(v * 100).toFixed(dp)}%` }
function deltaPct(curr, prev) {
  if (prev == null || prev === 0 || curr == null) return null
  return (curr - prev) / Math.abs(prev)
}

// ─── Data hook ──────────────────────────────────────────────────────────────────

function useFinanceData() {
  return useQuery({
    queryKey: ['finance-dashboard'],
    queryFn: async () => {
      const [snap, lines, cases] = await Promise.all([
        supabase.from('finance_snapshot').select('*').order('period_month'),
        supabase.from('finance_expense_line').select('period_month, account_code, account_name, amount, bucket'),
        supabase.from('support_cases_rollup').select('*').order('period_month'),
      ])
      if (snap.error) throw snap.error
      if (lines.error) throw lines.error
      if (cases.error) throw cases.error
      return { snapshots: snap.data ?? [], lines: lines.data ?? [], cases: cases.data ?? [] }
    },
  })
}

// ─── Small UI pieces ─────────────────────────────────────────────────────────────

function Tile({ icon: Icon, label, value, sub, delta, valueColor = C.text, hue = C.accent }) {
  const dColor = delta == null ? C.muted : delta >= 0 ? C.green : C.red
  const dArrow = delta == null ? '' : delta >= 0 ? '▲' : '▼'
  return (
    <div style={{
      background: C.panel, border: `1px solid ${C.border}`, borderTop: `2px solid ${hue}`,
      borderRadius: 8, padding: '14px 18px 16px', display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {Icon && <Icon size={14} strokeWidth={1.5} style={{ color: hue }} />}
        <span style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: C.muted, fontWeight: 500 }}>{label}</span>
      </div>
      <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: '1.55rem', lineHeight: 1, fontWeight: 500, color: valueColor }}>{value}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 14 }}>
        {delta != null && (
          <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 11, color: dColor }}>{dArrow} {pct(Math.abs(delta))}</span>
        )}
        {sub && <span style={{ fontSize: 11, color: C.muted, fontFamily: '"JetBrains Mono", monospace' }}>{sub}</span>}
      </div>
    </div>
  )
}

function Panel({ title, icon: Icon, children, right }) {
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 8, padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          {Icon && <Icon size={15} strokeWidth={1.5} style={{ color: C.accent }} />}
          <span style={{ fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.text, fontWeight: 600 }}>{title}</span>
        </div>
        {right}
      </div>
      {children}
    </div>
  )
}

function ChartTooltip({ active, payload, label, formatter }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 5, padding: '8px 10px', fontFamily: '"JetBrains Mono", monospace', fontSize: 11 }}>
      <div style={{ color: C.muted, marginBottom: 4 }}>{label}</div>
      {payload.map((p) => (
        <div key={p.dataKey} style={{ color: p.color || C.text }}>{p.name}: {formatter ? formatter(p.value) : p.value}</div>
      ))}
    </div>
  )
}

// Waterfall hover: show each step's signed figure and its share of revenue.
function WaterfallTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload
  if (!d) return null
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 5, padding: '8px 10px', fontFamily: '"JetBrains Mono", monospace', fontSize: 11 }}>
      <div style={{ color: C.muted, marginBottom: 4 }}>{d.name}</div>
      <div style={{ color: d.color || C.text }}>{money(d.disp)} · {pct(d.pctOfRev)} of rev</div>
    </div>
  )
}

// ─── Main ────────────────────────────────────────────────────────────────────────

export default function FinanceDashboard() {
  const { data, isLoading, error, refetch } = useFinanceData()
  const [grain, setGrain] = useState('month')
  const [anchor, setAnchor] = useState(null)

  const snapByKey = useMemo(() => {
    const m = new Map()
    for (const r of data?.snapshots ?? []) m.set(toKey(r.period_month), r)
    return m
  }, [data])

  const casesByKey = useMemo(() => {
    const m = new Map()
    for (const r of data?.cases ?? []) m.set(toKey(r.period_month), r)
    return m
  }, [data])

  const availableKeys = useMemo(() => [...snapByKey.keys()], [snapByKey])
  const options = useMemo(() => buildOptions(grain, availableKeys), [grain, availableKeys])

  // Default anchor = latest available for the grain
  const effAnchor = anchor ?? options[options.length - 1]?.value ?? null

  const curr = useMemo(() => effAnchor ? aggregate(periodKeys(grain, effAnchor), snapByKey) : null, [grain, effAnchor, snapByKey])

  // Cases for the SELECTED period only (was previously summing the whole trend
  // window, so the tile ignored the month/period filter).
  const currCases = useMemo(() => {
    const acc = { total: 0, open: 0, resolved: 0 }
    if (!effAnchor) return acc
    for (const k of periodKeys(grain, effAnchor)) {
      const c = casesByKey.get(k)
      if (!c) continue
      acc.total += c.cases_total || 0
      acc.open += c.cases_open || 0
      acc.resolved += c.cases_resolved || 0
    }
    return acc
  }, [grain, effAnchor, casesByKey])

  // Number of leading months the current period has data for (its YTD length).
  // A partial CY/FY is compared against the same window of the prior period.
  const ytdLen = useMemo(
    () => effAnchor ? periodElapsed(grain, effAnchor, (k) => snapByKey.has(k)) : 0,
    [grain, effAnchor, snapByKey],
  )

  // Previous comparable period, restricted to the same YTD window (year-to-date
  // vs year-to-date). For a complete period this is the whole prior period.
  const prev = useMemo(
    () => effAnchor ? aggregate(ytdWindow(grain, prevAnchor(grain, effAnchor), ytdLen), snapByKey) : null,
    [grain, effAnchor, snapByKey, ytdLen],
  )

  const chartData = useMemo(() => {
    if (!effAnchor) return []
    return chartKeys(grain, effAnchor).map((k) => {
      const s = snapByKey.get(k)
      const c = casesByKey.get(k)
      return {
        key: k, label: k.slice(2), // 'YY-MM'
        revenue: s ? Number(s.revenue) : 0,
        breakeven: s ? Number(s.breakeven_revenue) : null,
        ebitda: s ? Number(s.ebitda) : 0,
        casesTotal: c ? c.cases_total : 0,
        casesOpen: c ? c.cases_open : 0,
        casesResolved: c ? c.cases_resolved : 0,
      }
    })
  }, [grain, effAnchor, snapByKey, casesByKey])

  // OpEx lines (feeding EBITDA) for the selected period, ranked. Each carries its
  // change vs the previous period and vs the average of the OTHER comparable
  // periods — all compared like-for-like on the current period's YTD window, so a
  // partial year isn't measured against full prior years.
  const expenseRows = useMemo(() => {
    if (!effAnchor) return []
    const otherAnchors = options.map((o) => o.value).filter((a) => a !== effAnchor)
    const byCode = new Map() // code → { name, perMonth: Map(monthKey → amount) }
    for (const l of data?.lines ?? []) {
      if (l.bucket !== 'opex') continue
      const mk = toKey(l.period_month)
      let rec = byCode.get(l.account_code)
      if (!rec) { rec = { name: l.account_name, perMonth: new Map() }; byCode.set(l.account_code, rec) }
      rec.name = l.account_name
      rec.perMonth.set(mk, (rec.perMonth.get(mk) ?? 0) + Number(l.amount))
    }
    const sumWindow = (rec, keys) => keys.reduce((s, k) => s + (rec.perMonth.get(k) ?? 0), 0)
    const currWin = ytdWindow(grain, effAnchor, ytdLen)
    const prevWin = ytdWindow(grain, prevAnchor(grain, effAnchor), ytdLen)
    // Revenue over the SAME window the OpEx amounts are summed on, so each line's
    // share is a true % of revenue for the period.
    const revenue = currWin.reduce((s, k) => s + (Number(snapByKey.get(k)?.revenue) || 0), 0)
    const rows = []
    for (const [, rec] of byCode) {
      const amount = sumWindow(rec, currWin)
      if (amount <= 0) continue
      const prevAmount = sumWindow(rec, prevWin)
      // Average across other comparable periods, each on the same YTD window.
      let total = 0, count = 0
      for (const a of otherAnchors) { total += sumWindow(rec, ytdWindow(grain, a, ytdLen)); count += 1 }
      const avg = count ? total / count : null
      rows.push({
        name: rec.name, amount, prevAmount, avg,
        changeFromPrev: prevAmount ? (amount - prevAmount) / prevAmount : null,
        changeFromAvg: avg ? (amount - avg) / avg : null,
      })
    }
    rows.sort((a, b) => b.amount - a.amount)
    return rows.map((r) => ({ ...r, revShare: revenue ? r.amount / revenue : null }))
  }, [grain, effAnchor, data, options, ytdLen, snapByKey])

  const periodLabel = options.find((o) => o.value === effAnchor)?.label ?? '—'

  // ── Waterfall steps: Revenue → −COGS → GP → −OpEx → EBITDA ──────────────────
  const waterfall = useMemo(() => {
    if (!curr) return []
    const { revenue, cogs, grossProfit, opex, ebitda } = curr
    // each bar drawn as [base (transparent), value]; one brand hue per step.
    // pctOfRev = signed step figure ÷ revenue, surfaced in the hover tooltip.
    const ofRev = (v) => (revenue ? v / revenue : null)
    return [
      { name: 'Revenue', base: 0, value: revenue, disp: revenue, pctOfRev: ofRev(revenue), color: C.gold },
      { name: '− COGS', base: grossProfit, value: cogs, disp: -cogs, pctOfRev: ofRev(-cogs), color: C.orange },
      { name: 'Gross Profit', base: 0, value: grossProfit, disp: grossProfit, pctOfRev: ofRev(grossProfit), color: C.aqua },
      { name: '− OpEx', base: ebitda, value: opex, disp: -opex, pctOfRev: ofRev(-opex), color: C.pink },
      { name: 'EBITDA', base: 0, value: ebitda, disp: ebitda, pctOfRev: ofRev(ebitda), color: ebitda >= 0 ? C.purple : C.red },
    ]
  }, [curr])

  // Calendar Year has no like-for-like prior period in range → hide comparisons.
  const showCmp = grain !== 'cy'
  const opexGrid = showCmp ? ROW_GRID : ROW_GRID_NO_CMP

  // OpEx table sorting — click any column header to toggle. Numeric columns
  // start descending; the Account name starts ascending. Nulls always sort last.
  const [sort, setSort] = useState({ key: 'amount', dir: 'desc' })
  const toggleSort = (key) =>
    setSort((s) => (s.key === key
      ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: key === 'name' ? 'asc' : 'desc' }))
  const sortedRows = useMemo(() => {
    const rows = [...expenseRows]
    const mul = sort.dir === 'asc' ? 1 : -1
    rows.sort((a, b) => {
      if (sort.key === 'name') return mul * a.name.localeCompare(b.name)
      const av = a[sort.key], bv = b[sort.key]
      if (av == null && bv == null) return 0
      if (av == null) return 1   // nulls last, regardless of direction
      if (bv == null) return -1
      return mul * (av - bv)
    })
    return rows
  }, [expenseRows, sort])

  // ── Manual Xero sync ──────────────────────────────────────────────────────────
  // Re-runs the Xero P&L snapshot on demand (same /api/finance-snapshot route the
  // nightly cron hits → xero-pl-snapshot edge fn → finance_snapshot), then refetches
  // so the dashboard shows live figures without waiting for the 01:00 AEST cron.
  const [syncState, setSyncState] = useState('idle') // idle|syncing|done|error
  async function handleSync() {
    if (syncState === 'syncing') return
    setSyncState('syncing')
    try {
      const resp = await fetch('/api/finance-snapshot', { method: 'POST' })
      if (!resp.ok) throw new Error(`finance-snapshot ${resp.status}: ${await resp.text()}`)
      await refetch()
      setSyncState('done')
    } catch (e) {
      console.error('[finance sync]', e)
      setSyncState('error')
    }
    setTimeout(() => setSyncState((s) => (s === 'syncing' ? s : 'idle')), 3000)
  }

  // ── Share current view as an image ────────────────────────────────────────────
  // Rasterises the dashboard exactly as it's currently filtered/sorted, then —
  // best available first — opens the native share sheet (mobile), copies the PNG
  // to the clipboard, or downloads it. So a snapshot of "what I'm looking at" is
  // one click away to drop into Slack / email.
  const shotRef = useRef(null)
  const [shareState, setShareState] = useState('idle') // idle|working|copied|saved|error
  async function handleShare() {
    if (!shotRef.current || shareState === 'working') return
    setShareState('working')
    try {
      const canvas = await html2canvas(shotRef.current, {
        backgroundColor: C.bg, scale: 2, useCORS: true, logging: false,
      })
      const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'))
      const fname = `finance-${String(periodLabel).replace(/\s+/g, '-').toLowerCase()}.png`
      const file = new File([blob], fname, { type: 'image/png' })
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Finance snapshot', text: `Finance Dashboard — ${periodLabel}` })
        setShareState('idle')
      } else if (navigator.clipboard && window.ClipboardItem) {
        await navigator.clipboard.write([new window.ClipboardItem({ 'image/png': blob })])
        setShareState('copied')
      } else {
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url; a.download = fname; a.click()
        URL.revokeObjectURL(url)
        setShareState('saved')
      }
    } catch (e) {
      console.error('[finance share]', e)
      setShareState('error')
    }
    setTimeout(() => setShareState((s) => (s === 'working' ? s : 'idle')), 2500)
  }

  // ── States ──────────────────────────────────────────────────────────────────
  if (isLoading) return <Centered>Loading finance snapshots…</Centered>
  if (error) return <Centered tone={C.red}>Failed to load: {error.message}</Centered>
  if (!availableKeys.length) return <Centered>No finance snapshots yet. Run the snapshot pipeline to populate.</Centered>

  return (
    <div style={{ height: '100%', overflow: 'auto', background: C.bg, padding: 20, fontFamily: 'Inter, system-ui, sans-serif' }}>
      <div ref={shotRef} style={{ maxWidth: 1180, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Header + filter bar */}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 600, color: C.text, margin: 0 }}>Finance Dashboard</h1>
            <span style={{ fontSize: 12, color: C.muted, fontFamily: '"JetBrains Mono", monospace' }}>
              {periodLabel} · GST-exclusive · source: Xero{curr?.months ? ` · ${curr.months} mo` : ''}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <FilterBar
              grain={grain} setGrain={(g) => { setGrain(g); setAnchor(null) }}
              options={options} anchor={effAnchor} setAnchor={setAnchor}
            />
            <SyncButton state={syncState} onClick={handleSync} />
            <ShareButton state={shareState} onClick={handleShare} />
          </div>
        </div>

        {/* Unmapped banner */}
        {curr && curr.unmappedCount > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: C.accentSubtle, border: '1px solid rgba(var(--brand-accent-rgb),0.3)', borderRadius: 8, padding: '11px 14px' }}>
            <TriangleAlertIcon size={16} strokeWidth={1.6} style={{ color: C.accent, flexShrink: 0 }} />
            <span style={{ fontSize: 12.5, color: C.muted }}>
              <strong style={{ color: C.accent }}>{curr.unmappedCount}</strong> P&L account line{curr.unmappedCount === 1 ? '' : 's'} ({money(curr.unmappedAmount)}) in this period are not in the account map — excluded from EBITDA. Add them in the account_map table.
            </span>
          </div>
        )}

        {/* Tiles */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          <Tile icon={CurrencyDollarIcon} label="Revenue" value={money(curr.revenue)} hue={C.gold} valueColor={C.gold}
            delta={showCmp ? deltaPct(curr.revenue, prev?.revenue) : null} sub={showCmp ? 'vs prev' : ''} />
          <Tile icon={ChartLineIcon} label="Gross Profit" value={money(curr.grossProfit)} hue={C.aqua} valueColor={curr.grossProfit >= 0 ? C.green : C.red}
            delta={showCmp ? deltaPct(curr.grossProfit, prev?.grossProfit) : null} sub={pct(curr.grossProfitPct)} />
          <Tile icon={WalletIcon} label="EBITDA" value={money(curr.ebitda)} hue={C.purple} valueColor={curr.ebitda >= 0 ? C.green : C.red}
            delta={showCmp ? deltaPct(curr.ebitda, prev?.ebitda) : null} sub={pct(curr.ebitdaPct)} />
          <Tile icon={GaugeIcon} label="% to Breakeven" value={pct(curr.pctToBreakeven, 0)} hue={C.orange}
            valueColor={curr.pctToBreakeven >= 1 ? C.green : C.red}
            delta={showCmp ? deltaPct(curr.pctToBreakeven, prev?.pctToBreakeven) : null}
            sub={curr.marginOfSafety != null ? `MoS ${money(curr.marginOfSafety)}` : ''} />
          <Tile icon={TargetIcon} label="Cases" value={fmt0.format(currCases.total)} hue={C.blue} valueColor={C.blue}
            sub={`${currCases.open} open`} />
        </div>

        {/* EBITDA waterfall + Breakeven — side by side (desktop only) */}
        <div className="finance-desktop-only" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 16 }}>
          <Panel title="EBITDA Waterfall" icon={ChartBarIcon} right={<Mono>{periodLabel}</Mono>}>
            <ResponsiveContainer width="100%" height={250}>
              <ComposedChart data={waterfall} margin={{ top: 16, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid stroke={C.borderSoft} vertical={false} />
                <XAxis dataKey="name" tick={{ fill: C.muted, fontSize: 10 }} axisLine={{ stroke: C.border }} tickLine={false} interval={0} />
                <YAxis tick={{ fill: C.muted, fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={compact} width={48} />
                <Tooltip content={<WaterfallTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                <Bar dataKey="base" stackId="w" fill="transparent" />
                <Bar dataKey="value" stackId="w" radius={[2, 2, 0, 0]} name="Amount">
                  {waterfall.map((s, i) => (
                    <Cell key={i} fill={s.color} />
                  ))}
                </Bar>
              </ComposedChart>
            </ResponsiveContainer>
          </Panel>

          <Panel title="Revenue vs Breakeven" icon={TargetIcon}
            right={<Mono>{curr.marginOfSafety != null ? `MoS ${money(curr.marginOfSafety)} · ${pct(curr.pctToBreakeven, 0)} of BE` : ''}</Mono>}>
            <ResponsiveContainer width="100%" height={250}>
              <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: 8, bottom: 0 }}>
                <CartesianGrid stroke={C.borderSoft} vertical={false} />
                <XAxis dataKey="label" tick={{ fill: C.muted, fontSize: 10 }} axisLine={{ stroke: C.border }} tickLine={false} />
                <YAxis tick={{ fill: C.muted, fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={compact} width={48} />
                <Tooltip content={<ChartTooltip formatter={(v) => money(v)} />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                <Bar dataKey="revenue" name="Revenue" radius={[2, 2, 0, 0]}>
                  {chartData.map((d, i) => (
                    <Cell key={i} fill={d.breakeven != null && d.revenue >= d.breakeven ? C.green : C.red} fillOpacity={0.55} />
                  ))}
                </Bar>
                <Line dataKey="breakeven" name="Breakeven" stroke={C.accent} strokeWidth={2} dot={false} connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          </Panel>
        </div>

        {/* Cases trend (desktop only) */}
        <div className="finance-desktop-only">
        <Panel title="Customer-Service Cases" icon={ChartLineIcon} right={<Mono>from SUPPORT module</Mono>}>
          <ResponsiveContainer width="100%" height={200}>
            <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: 8, bottom: 0 }}>
              <CartesianGrid stroke={C.borderSoft} vertical={false} />
              <XAxis dataKey="label" tick={{ fill: C.muted, fontSize: 10 }} axisLine={{ stroke: C.border }} tickLine={false} />
              <YAxis tick={{ fill: C.muted, fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals={false} width={32} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
              <Bar dataKey="casesResolved" name="Resolved" stackId="c" fill={C.green} fillOpacity={0.6} radius={[0, 0, 0, 0]} />
              <Bar dataKey="casesOpen" name="Open" stackId="c" fill={C.accent} fillOpacity={0.85} radius={[2, 2, 0, 0]} />
            </ComposedChart>
          </ResponsiveContainer>
        </Panel>
        </div>

        {/* OpEx breakdown — full-width table, bottom (desktop only) */}
        <div className="finance-desktop-only">
        <Panel title="OpEx Breakdown" icon={LayersIcon}
          right={<Mono>{expenseRows.length} lines{showCmp ? ` · Δ compared like-for-like${ytdLen > 0 && ytdLen < 12 && grain !== 'month' ? ` (first ${ytdLen} mo)` : ''}; avg = mean of other ${GRAINS.find((g) => g.key === grain)?.label.toLowerCase()} periods` : ''}</Mono>}>
          {expenseRows.length === 0 ? (
            <span style={{ color: C.muted, fontSize: 12 }}>No OpEx lines in this period.</span>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ ...opexGrid, color: C.muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.07em', paddingBottom: 9, borderBottom: `1px solid ${C.border}` }}>
                <SortHeader label="Account" colKey="name" sort={sort} onSort={toggleSort} />
                <SortHeader label="Amount" colKey="amount" align="right" sort={sort} onSort={toggleSort} />
                <SortHeader label="% of Revenue" colKey="revShare" sort={sort} onSort={toggleSort} />
                {showCmp && <SortHeader label="Δ vs prev period" colKey="changeFromPrev" align="right" sort={sort} onSort={toggleSort} />}
                {showCmp && <SortHeader label="Δ vs average" colKey="changeFromAvg" align="right" sort={sort} onSort={toggleSort} />}
              </div>
              {sortedRows.map((r) => (
                <div key={r.name} style={{ ...opexGrid, fontSize: 12.5, padding: '9px 0', borderBottom: `1px solid ${C.borderSoft}`, alignItems: 'center' }}>
                  <span style={{ color: C.text }}>{r.name}</span>
                  <span style={{ textAlign: 'right', color: C.text, fontFamily: MONO }}>{money(r.amount)}</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ flex: 1, height: 4, background: C.track, borderRadius: 2, overflow: 'hidden' }}>
                      <span style={{ display: 'block', width: `${Math.max(2, (r.revShare ?? 0) * 100)}%`, height: '100%', background: C.accent, opacity: 0.8 }} />
                    </span>
                    <span style={{ color: C.muted, fontFamily: MONO, width: 38, textAlign: 'right' }}>{pct(r.revShare, 0)}</span>
                  </span>
                  {showCmp && <DeltaCell v={r.changeFromPrev} />}
                  {showCmp && <DeltaCell v={r.changeFromAvg} />}
                </div>
              ))}
            </div>
          )}
        </Panel>
        </div>

      </div>
    </div>
  )
}

// ─── OpEx table helpers ─────────────────────────────────────────────────────────

const MONO = '"JetBrains Mono", monospace'
const ROW_GRID = { display: 'grid', gridTemplateColumns: '1.9fr 1fr 1.7fr 1fr 1fr', gap: 14, alignItems: 'center' }
// Without the two Δ comparison columns (e.g. Calendar Year view).
const ROW_GRID_NO_CMP = { display: 'grid', gridTemplateColumns: '2.2fr 1fr 2.4fr', gap: 14, alignItems: 'center' }

function signedPct(v) {
  if (v == null) return '—'
  return `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`
}

// Clickable column header for the OpEx table; shows the active sort arrow.
function SortHeader({ label, colKey, align = 'left', sort, onSort }) {
  const active = sort.key === colKey
  return (
    <span
      onClick={() => onSort(colKey)}
      style={{
        textAlign: align, cursor: 'pointer', userSelect: 'none',
        color: active ? C.text : 'inherit',
      }}>
      {label}{active ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
    </span>
  )
}

// For an expense, a rise is unfavourable → red; a fall → green.
function DeltaCell({ v }) {
  const color = v == null ? C.faint : v > 0 ? C.red : v < 0 ? C.green : C.muted
  return <span style={{ textAlign: 'right', fontFamily: MONO, color }}>{signedPct(v)}</span>
}

// ─── Filter bar ──────────────────────────────────────────────────────────────────

function FilterBar({ grain, setGrain, options, anchor, setAnchor }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ display: 'flex', background: C.panel, border: `1px solid ${C.border}`, borderRadius: 7, padding: 2 }}>
        {GRAINS.map((g) => (
          <button key={g.key} onClick={() => setGrain(g.key)}
            style={{
              border: 'none', cursor: 'pointer', padding: '6px 12px', borderRadius: 5, fontSize: 11.5,
              fontFamily: '"JetBrains Mono", monospace',
              background: grain === g.key ? C.accent : 'transparent',
              color: grain === g.key ? C.bg : C.muted, fontWeight: grain === g.key ? 600 : 400,
              transition: 'background 120ms, color 120ms',
            }}>
            {g.label}
          </button>
        ))}
      </div>
      <select value={anchor ?? ''} onChange={(e) => setAnchor(e.target.value)}
        style={{
          background: C.panel, color: C.text, border: `1px solid ${C.border}`, borderRadius: 7,
          padding: '7px 10px', fontSize: 12, fontFamily: '"JetBrains Mono", monospace', cursor: 'pointer',
        }}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  )
}

// Manually re-run the Xero snapshot, then refetch.
const SYNC_LABEL = { idle: 'Sync Xero', syncing: 'Syncing…', done: 'Synced ✓', error: 'Failed' }
function SyncButton({ state, onClick }) {
  const busy = state === 'syncing'
  const done = state === 'done'
  return (
    <button onClick={onClick} disabled={busy}
      title="Pull live data from Xero now"
      data-html2canvas-ignore="true"
      style={{
        display: 'flex', alignItems: 'center', gap: 6, cursor: busy ? 'default' : 'pointer',
        background: done ? C.accent : C.panel, color: done ? C.bg : (state === 'error' ? C.red : C.text),
        border: `1px solid ${done ? C.accent : C.border}`, borderRadius: 7,
        padding: '7px 12px', fontSize: 11.5, fontFamily: '"JetBrains Mono", monospace',
        transition: 'background 120ms, color 120ms',
      }}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        style={busy ? { animation: 'spin 0.8s linear infinite' } : undefined}>
        <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" />
        <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" /><path d="M21 21v-5h-5" />
      </svg>
      {SYNC_LABEL[state] ?? 'Sync Xero'}
    </button>
  )
}

// Share the current view as a PNG (native share → clipboard → download).
const SHARE_LABEL = { idle: 'Share', working: 'Capturing…', copied: 'Copied ✓', saved: 'Saved ✓', error: 'Failed' }
function ShareButton({ state, onClick }) {
  const active = state === 'copied' || state === 'saved'
  return (
    <button onClick={onClick} disabled={state === 'working'}
      title="Share a snapshot of the current view"
      data-html2canvas-ignore="true"
      style={{
        display: 'flex', alignItems: 'center', gap: 6, cursor: state === 'working' ? 'default' : 'pointer',
        background: active ? C.accent : C.panel, color: active ? C.bg : C.text,
        border: `1px solid ${active ? C.accent : C.border}`, borderRadius: 7,
        padding: '7px 12px', fontSize: 11.5, fontFamily: '"JetBrains Mono", monospace',
        transition: 'background 120ms, color 120ms',
      }}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7" />
        <path d="M12 16V3" /><path d="m8 7 4-4 4 4" />
      </svg>
      {SHARE_LABEL[state] ?? 'Share'}
    </button>
  )
}

function Mono({ children }) { return <span style={{ fontSize: 11, color: C.muted, fontFamily: '"JetBrains Mono", monospace' }}>{children}</span> }
function Centered({ children, tone = C.muted }) {
  return <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: tone, fontSize: 13, background: C.bg }}>{children}</div>
}
