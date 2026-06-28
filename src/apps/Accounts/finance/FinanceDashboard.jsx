import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip,
  CartesianGrid, Cell, ReferenceLine,
} from 'recharts'
import {
  CurrencyDollarIcon, ChartLineIcon, GaugeIcon, TargetIcon, WalletIcon,
  TriangleAlertIcon, LayersIcon, ChartBarIcon,
} from '@portal/components/icons'
import { supabase } from '@portal/lib/supabase'
import {
  GRAINS, buildOptions, periodKeys, prevPeriodKeys, chartKeys, aggregate, toKey,
} from './periods.js'

// ─── Theme ────────────────────────────────────────────────────────────────────

const C = {
  bg: '#0a0a0a', panel: '#0a0a0a', border: '#222', borderSoft: '#1a1a1a',
  accent: '#f3ca0f', text: '#fff', muted: '#a0a0a0', faint: '#555',
  green: '#60a57e', red: '#ff1744', revenue: '#f3ca0f', cost: '#5a5a5a',
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

function Tile({ icon: Icon, label, value, sub, delta, valueColor = C.text, accent = false }) {
  const dColor = delta == null ? C.muted : delta >= 0 ? C.green : C.red
  const dArrow = delta == null ? '' : delta >= 0 ? '▲' : '▼'
  return (
    <div style={{
      background: C.panel, border: `1px solid ${accent ? 'rgba(243,202,15,0.25)' : C.border}`,
      borderRadius: 8, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {Icon && <Icon size={14} strokeWidth={1.5} style={{ color: C.faint }} />}
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
    <div style={{ background: '#111', border: `1px solid ${C.border}`, borderRadius: 5, padding: '8px 10px', fontFamily: '"JetBrains Mono", monospace', fontSize: 11 }}>
      <div style={{ color: C.muted, marginBottom: 4 }}>{label}</div>
      {payload.map((p) => (
        <div key={p.dataKey} style={{ color: p.color || C.text }}>{p.name}: {formatter ? formatter(p.value) : p.value}</div>
      ))}
    </div>
  )
}

// ─── Main ────────────────────────────────────────────────────────────────────────

export default function FinanceDashboard() {
  const { data, isLoading, error } = useFinanceData()
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
  const prev = useMemo(() => effAnchor ? aggregate(prevPeriodKeys(grain, effAnchor), snapByKey) : null, [grain, effAnchor, snapByKey])

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

  // Expense lines (OpEx feeding EBITDA) for the selected period, ranked.
  const expenseRows = useMemo(() => {
    if (!effAnchor) return []
    const keys = new Set(periodKeys(grain, effAnchor))
    const byCode = new Map()
    for (const l of data?.lines ?? []) {
      if (l.bucket !== 'opex') continue
      if (!keys.has(toKey(l.period_month))) continue
      const prevAmt = byCode.get(l.account_code)?.amount ?? 0
      byCode.set(l.account_code, { name: l.account_name, amount: prevAmt + Number(l.amount) })
    }
    const arr = [...byCode.values()].filter((r) => r.amount > 0).sort((a, b) => b.amount - a.amount)
    const total = arr.reduce((s, r) => s + r.amount, 0)
    return arr.map((r) => ({ ...r, share: total ? r.amount / total : 0 }))
  }, [grain, effAnchor, data, snapByKey])

  const periodLabel = options.find((o) => o.value === effAnchor)?.label ?? '—'

  // ── Waterfall steps: Revenue → −COGS → GP → −OpEx → EBITDA ──────────────────
  const waterfall = useMemo(() => {
    if (!curr) return []
    const { revenue, cogs, grossProfit, opex, ebitda } = curr
    // each bar drawn as [base (transparent), value]
    return [
      { name: 'Revenue', base: 0, value: revenue, disp: revenue, kind: 'pos' },
      { name: '− COGS', base: grossProfit, value: cogs, disp: -cogs, kind: 'neg' },
      { name: 'Gross Profit', base: 0, value: grossProfit, disp: grossProfit, kind: 'sub' },
      { name: '− OpEx', base: ebitda, value: opex, disp: -opex, kind: 'neg' },
      { name: 'EBITDA', base: 0, value: ebitda, disp: ebitda, kind: ebitda >= 0 ? 'sub' : 'negsub' },
    ]
  }, [curr])

  // ── States ──────────────────────────────────────────────────────────────────
  if (isLoading) return <Centered>Loading finance snapshots…</Centered>
  if (error) return <Centered tone={C.red}>Failed to load: {error.message}</Centered>
  if (!availableKeys.length) return <Centered>No finance snapshots yet. Run the snapshot pipeline to populate.</Centered>

  return (
    <div style={{ height: '100%', overflow: 'auto', background: '#000', padding: 20, fontFamily: 'Inter, system-ui, sans-serif' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Header + filter bar */}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 600, color: C.text, margin: 0 }}>Finance Dashboard</h1>
            <span style={{ fontSize: 12, color: C.muted, fontFamily: '"JetBrains Mono", monospace' }}>
              {periodLabel} · GST-exclusive · source: Xero{curr?.months ? ` · ${curr.months} mo` : ''}
            </span>
          </div>
          <FilterBar
            grain={grain} setGrain={(g) => { setGrain(g); setAnchor(null) }}
            options={options} anchor={effAnchor} setAnchor={setAnchor}
          />
        </div>

        {/* Unmapped banner */}
        {curr && curr.unmappedCount > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(243,202,15,0.06)', border: '1px solid rgba(243,202,15,0.3)', borderRadius: 8, padding: '11px 14px' }}>
            <TriangleAlertIcon size={16} strokeWidth={1.6} style={{ color: C.accent, flexShrink: 0 }} />
            <span style={{ fontSize: 12.5, color: '#e7d68a' }}>
              <strong style={{ color: C.accent }}>{curr.unmappedCount}</strong> P&L account line{curr.unmappedCount === 1 ? '' : 's'} ({money(curr.unmappedAmount)}) in this period are not in the account map — excluded from EBITDA. Add them in the account_map table.
            </span>
          </div>
        )}

        {/* Tiles */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          <Tile icon={CurrencyDollarIcon} label="Revenue" value={money(curr.revenue)} delta={deltaPct(curr.revenue, prev?.revenue)} sub="vs prev" />
          <Tile icon={ChartLineIcon} label="Gross Profit" value={money(curr.grossProfit)} valueColor={curr.grossProfit >= 0 ? C.green : C.red}
            delta={deltaPct(curr.grossProfit, prev?.grossProfit)} sub={pct(curr.grossProfitPct)} />
          <Tile icon={WalletIcon} label="EBITDA" value={money(curr.ebitda)} valueColor={curr.ebitda >= 0 ? C.green : C.red}
            delta={deltaPct(curr.ebitda, prev?.ebitda)} sub="vs prev" accent />
          <Tile icon={GaugeIcon} label="% to Breakeven" value={pct(curr.pctToBreakeven, 0)}
            valueColor={curr.pctToBreakeven >= 1 ? C.green : C.red}
            delta={deltaPct(curr.pctToBreakeven, prev?.pctToBreakeven)}
            sub={curr.marginOfSafety != null ? `MoS ${money(curr.marginOfSafety)}` : ''} />
          <Tile icon={TargetIcon} label="Cases" value={fmt0.format(chartData.reduce((s, d) => s + d.casesTotal, 0))}
            sub={`${chartData.reduce((s, d) => s + d.casesOpen, 0)} open`} />
        </div>

        {/* Waterfall + Expense panel */}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.15fr) minmax(0,0.85fr)', gap: 16 }}>
          <Panel title="EBITDA Waterfall" icon={ChartBarIcon} right={<Mono>{periodLabel}</Mono>}>
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={waterfall} margin={{ top: 16, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid stroke={C.borderSoft} vertical={false} />
                <XAxis dataKey="name" tick={{ fill: C.muted, fontSize: 10 }} axisLine={{ stroke: C.border }} tickLine={false} interval={0} />
                <YAxis tick={{ fill: C.muted, fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={compact} width={48} />
                <Tooltip content={<ChartTooltip formatter={(v) => money(v)} />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                <Bar dataKey="base" stackId="w" fill="transparent" />
                <Bar dataKey="value" stackId="w" radius={[2, 2, 0, 0]} name="Amount">
                  {waterfall.map((s, i) => (
                    <Cell key={i} fill={s.kind === 'pos' ? C.revenue : s.kind === 'neg' ? C.cost : s.kind === 'negsub' ? C.red : C.green} />
                  ))}
                </Bar>
              </ComposedChart>
            </ResponsiveContainer>
          </Panel>

          <Panel title="OpEx Breakdown" icon={LayersIcon} right={<Mono>{expenseRows.length} lines</Mono>}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9, maxHeight: 260, overflow: 'auto', paddingRight: 4 }}>
              {expenseRows.length === 0 && <span style={{ color: C.muted, fontSize: 12 }}>No OpEx lines in this period.</span>}
              {expenseRows.map((r) => (
                <div key={r.name} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                    <span style={{ color: C.text }}>{r.name}</span>
                    <span style={{ color: C.muted, fontFamily: '"JetBrains Mono", monospace' }}>{money(r.amount)} · {pct(r.share, 0)}</span>
                  </div>
                  <div style={{ height: 4, background: '#161616', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ width: `${Math.max(2, r.share * 100)}%`, height: '100%', background: C.accent, opacity: 0.8 }} />
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </div>

        {/* Breakeven chart */}
        <Panel title="Revenue vs Breakeven" icon={TargetIcon}
          right={<Mono>{curr.marginOfSafety != null ? `Margin of safety ${money(curr.marginOfSafety)} · ${pct(curr.pctToBreakeven, 0)} of BE` : ''}</Mono>}>
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

        {/* Cases trend */}
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
    </div>
  )
}

// ─── Filter bar ──────────────────────────────────────────────────────────────────

function FilterBar({ grain, setGrain, options, anchor, setAnchor }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ display: 'flex', background: '#0c0c0c', border: `1px solid ${C.border}`, borderRadius: 7, padding: 2 }}>
        {GRAINS.map((g) => (
          <button key={g.key} onClick={() => setGrain(g.key)}
            style={{
              border: 'none', cursor: 'pointer', padding: '6px 12px', borderRadius: 5, fontSize: 11.5,
              fontFamily: '"JetBrains Mono", monospace',
              background: grain === g.key ? C.accent : 'transparent',
              color: grain === g.key ? '#000' : C.muted, fontWeight: grain === g.key ? 600 : 400,
              transition: 'background 120ms, color 120ms',
            }}>
            {g.label}
          </button>
        ))}
      </div>
      <select value={anchor ?? ''} onChange={(e) => setAnchor(e.target.value)}
        style={{
          background: '#0c0c0c', color: C.text, border: `1px solid ${C.border}`, borderRadius: 7,
          padding: '7px 10px', fontSize: 12, fontFamily: '"JetBrains Mono", monospace', cursor: 'pointer',
        }}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  )
}

function Mono({ children }) { return <span style={{ fontSize: 11, color: C.muted, fontFamily: '"JetBrains Mono", monospace' }}>{children}</span> }
function Centered({ children, tone = C.muted }) {
  return <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: tone, fontSize: 13, background: '#000' }}>{children}</div>
}
