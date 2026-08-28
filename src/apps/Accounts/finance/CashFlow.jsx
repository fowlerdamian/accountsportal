// Accounts › Cash Flow — 13-week cash forecast. One screen on a laptop, readable
// on a phone. All numbers come from the cashflow-forecast edge function, which
// pulls Xero + Cin7 live on every load. Configuration (floor, collection
// profiles, payroll, statutory dates) lives in the CONFIG block at the top of
// supabase/functions/cashflow-forecast/index.ts.

import { useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ResponsiveContainer, ComposedChart, Line, Area, XAxis, YAxis, Tooltip,
  CartesianGrid, ReferenceArea, ReferenceDot,
} from 'recharts'
import { WalletIcon, RefreshIcon } from '@portal/components/icons'
import { supabase } from '@portal/lib/supabase'
import { palette } from '@portal/lib/palette'
import { useIsMobile } from '../../../hooks/useIsMobile.js'
import { useFinanceSync, SYNC_LABEL } from './financeSync.js'

// ─── Colour — by cash direction only. `breach` is reserved for a floor breach. ──
const C = {
  bg: '#0a0a0a', panel: '#161616', surface: '#1e1e1e', border: '#2a2a2a',
  text: '#f8fafc', muted: '#a0a0a0', faint: '#666666',
  get inflow()  { return palette.aqua },
  get outflow() { return palette.orange },
  get breach()  { return palette.pink },
  get balance() { return palette.gold },
}
const MONO = '"JetBrains Mono", monospace'

// ─── Formatters ────────────────────────────────────────────────────────────────
const fmt0 = new Intl.NumberFormat('en-AU', { maximumFractionDigits: 0 })
const money = (v) => (v == null || Number.isNaN(v) ? '—' : `${v < 0 ? '-' : ''}$${fmt0.format(Math.abs(v))}`)
const compact = (v) => {
  if (v == null) return '—'
  const a = Math.abs(v), s = v < 0 ? '-' : ''
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(2)}m`
  if (a >= 1e3) return `${s}$${Math.round(a / 1e3)}k`
  return `${s}$${Math.round(a)}`
}
const pct = (v) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`)
const dShort = (s) => (s ? new Date(`${s}T00:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) : '—')
const dLong = (s) => (s ? new Date(`${s}T00:00:00`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }) : '—')
const tShort = (s) => (s ? new Date(s).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—')

// ─── Data ──────────────────────────────────────────────────────────────────────
function useCashFlow() {
  return useQuery({
    queryKey: ['cashflow-forecast'],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('cashflow-forecast', { body: {} })
      if (error) throw error
      if (data?.error) throw new Error(data.error)
      return data
    },
    staleTime: 0,
    refetchOnMount: 'always',
  })
}

// ─── Pieces ────────────────────────────────────────────────────────────────────
const Label = ({ children, color = C.muted }) => (
  <span style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color, fontWeight: 500 }}>{children}</span>
)
const Card = ({ children, style, accent }) => (
  <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderTop: accent ? `2px solid ${accent}` : `1px solid ${C.border}`, borderRadius: 8, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, ...style }}>
    {children}
  </div>
)
const Big = ({ children, color = C.text, size = '1.35rem' }) => (
  <span style={{ fontFamily: MONO, fontSize: size, lineHeight: 1.05, fontWeight: 500, color, whiteSpace: 'nowrap' }}>{children}</span>
)
const Sub = ({ children, color = C.muted }) => (
  <span style={{ fontSize: 11, color, fontFamily: MONO, lineHeight: 1.3 }}>{children}</span>
)

function StackBar({ segments, total }) {
  const sum = Math.max(total ?? segments.reduce((s, x) => s + x.value, 0), 1)
  return (
    <div style={{ display: 'flex', height: 10, borderRadius: 3, overflow: 'hidden', background: C.surface }}>
      {segments.map((s) => (
        <div key={s.label} title={`${s.label}: ${money(s.value)}`} style={{ width: `${(s.value / sum) * 100}%`, background: s.color, opacity: s.opacity ?? 1 }} />
      ))}
    </div>
  )
}

function Arrow({ curr, prev, lowerIsBetter = true }) {
  if (curr == null || prev == null) return <span style={{ color: C.faint }}>–</span>
  const d = curr - prev
  if (Math.abs(d) < 0.5) return <span style={{ color: C.faint }}>→</span>
  const up = d > 0
  const good = lowerIsBetter ? !up : up
  return <span style={{ color: good ? C.inflow : C.outflow }}>{up ? '▲' : '▼'}</span>
}

function ChartTip({ active, payload, floor }) {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload
  if (!d) return null
  const breach = d.close < floor
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 5, padding: '8px 10px', fontFamily: MONO, fontSize: 11 }}>
      <div style={{ color: C.muted, marginBottom: 4 }}>Wk {d.week} · {dShort(d.start)}–{dShort(d.end)}</div>
      <div style={{ color: breach ? C.breach : C.balance }}>Close {money(d.close)}</div>
      <div style={{ color: C.faint }}>Downside {money(d.closeDown)}</div>
      <div style={{ color: C.inflow }}>In {money(d.inflow)}</div>
      <div style={{ color: C.outflow }}>Out {money(d.outflow)}</div>
    </div>
  )
}

// ─── Page ──────────────────────────────────────────────────────────────────────
export default function CashFlow() {
  const isMobile = useIsMobile()
  const { data, isLoading, error, isFetching } = useCashFlow()
  const qc = useQueryClient()
  const { state: syncState, busy: syncBusy, run: runSync } = useFinanceSync()

  const chartData = useMemo(() => data?.weeks ?? [], [data])
  const yDomain = useMemo(() => {
    if (!data) return ['auto', 'auto']
    const vals = [0, data.config.minimumCashFloor, ...data.weeks.flatMap((w) => [w.close, w.closeDown]), data.bank.total]
    const lo = Math.min(...vals), hi = Math.max(...vals)
    const pad = (hi - lo) * 0.08 || 1000
    return [Math.floor((lo - pad) / 1000) * 1000, Math.ceil((hi + pad) / 1000) * 1000]
  }, [data])

  if (isLoading) return <Centered>Pulling Xero + Cin7…</Centered>
  if (error) return <Centered tone={C.breach}>Failed to load: {error.message}</Centered>
  if (!data) return null

  const { hero, bank, drivers, calendar, trust, monthly, config } = data
  const floor = config.minimumCashFloor
  const breach = hero.floorBreach
  const heroColor = breach ? C.breach : C.text
  const headroomColor = breach ? C.breach : C.inflow
  const ap4 = drivers.owedByUs.apNext4Weeks, po = drivers.owedByUs.poUnbilled
  const arTotal = drivers.owedToUs.total
  const ch = config.collections
  const prof = (k) => `${ch[k].label} ${Math.round(ch[k].days)}d${ch[k].source === 'observed' ? '' : '*'}`

  return (
    <div style={{ height: '100%', overflow: 'auto', background: C.bg, padding: isMobile ? 12 : 16, fontFamily: 'Inter, system-ui, sans-serif' }}>
      <div style={{ maxWidth: 1240, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 10 }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 16, fontWeight: 600, color: C.text, margin: 0 }}>Cash Flow</h1>
            <Sub>13-week forecast · Xero + Cin7 Core · AUD incl. GST</Sub>
          </div>
          <button onClick={() => runSync(qc)} disabled={syncBusy || isFetching} title="Sync Xero + Cin7 across all finance apps" style={{ background: 'transparent', border: `1px solid ${syncState === 'error' ? C.breach : C.border}`, color: syncState === 'done' ? C.inflow : syncState === 'error' ? C.breach : C.muted, borderRadius: 5, padding: '5px 8px', cursor: syncBusy ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontFamily: MONO }}>
            <RefreshIcon size={13} strokeWidth={1.5} /> {isFetching && syncState === 'idle' ? 'loading' : SYNC_LABEL[syncState]}
          </button>
        </div>

        {/* Hero + tiles */}
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1.6fr repeat(4, 1fr)', gap: 10 }}>
          <Card accent={breach ? C.breach : C.balance} style={{ gridRow: isMobile ? 'auto' : 'span 1', justifyContent: 'center', gap: 8, padding: '16px 18px' }}>
            <Label color={breach ? C.breach : C.muted}>{breach ? 'Floor breach · lowest projected balance' : 'Lowest projected balance'}</Label>
            <Big color={heroColor} size={isMobile ? '2.2rem' : '2.6rem'}>{money(hero.lowClose)}</Big>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'baseline' }}>
              <Sub color={C.text}>Week {hero.lowWeek} · {dShort(hero.lowWeekStart)}–{dShort(hero.lowWeekEnd)}</Sub>
              <Sub color={headroomColor}>{hero.headroom >= 0 ? '+' : ''}{money(hero.headroom)} vs {compact(floor)} floor</Sub>
            </div>
            <Sub color={C.faint}>Downside {money(hero.downsideLowClose)} wk {hero.downsideLowWeek}{hero.downsideBreach && !breach ? ' · below floor' : ''}</Sub>
          </Card>

          <Card>
            <Label>Cash at bank</Label>
            <Big>{money(bank.total)}</Big>
            <Sub>as at {dLong(bank.asAt)}</Sub>
          </Card>
          <Card>
            <Label>Low point</Label>
            <Big color={heroColor}>{money(hero.lowClose)}</Big>
            <Sub>wk {hero.lowWeek} · {dShort(hero.lowWeekStart)}</Sub>
          </Card>
          <Card>
            <Label>Headroom at low</Label>
            <Big color={headroomColor}>{money(hero.headroom)}</Big>
            <Sub>floor {money(floor)}</Sub>
          </Card>
          <Card>
            <Label>Days cash on hand</Label>
            <Big>{hero.daysCashOnHand ?? '—'}</Big>
            <Sub>at forecast burn</Sub>
          </Card>
        </div>

        {/* Chart + drivers */}
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1.6fr 1fr', gap: 10 }}>
          <Card style={{ padding: '12px 8px 6px 4px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0 10px' }}>
              <Label>Projected closing balance · weekly</Label>
              <Sub color={C.faint}>— base · ┄ downside · band = below floor</Sub>
            </div>
            <div style={{ height: isMobile ? 220 : 250 }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke={C.border} strokeDasharray="2 4" vertical={false} />
                  <XAxis dataKey="week" tickFormatter={(w) => `W${w}`} tick={{ fill: C.faint, fontSize: 10, fontFamily: MONO }} axisLine={{ stroke: C.border }} tickLine={false} />
                  <YAxis domain={yDomain} tickFormatter={compact} width={52} tick={{ fill: C.faint, fontSize: 10, fontFamily: MONO }} axisLine={false} tickLine={false} />
                  <Tooltip content={<ChartTip floor={floor} />} cursor={{ stroke: C.border }} />
                  <ReferenceArea y1={yDomain[0]} y2={floor} fill={C.surface} fillOpacity={0.9} stroke={C.border} strokeDasharray="3 3" ifOverflow="extendDomain" />
                  <Area type="monotone" dataKey="close" stroke="none" fill={C.balance} fillOpacity={0.06} isAnimationActive={false} />
                  <Line type="monotone" dataKey="closeDown" stroke={C.balance} strokeOpacity={0.35} strokeDasharray="4 4" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="close" stroke={C.balance} strokeWidth={2.2} dot={false} isAnimationActive={false} />
                  <ReferenceDot x={hero.lowWeek} y={hero.lowClose} r={5} fill={breach ? C.breach : C.bg} stroke={breach ? C.breach : C.balance} strokeWidth={2}
                    label={{ value: compact(hero.lowClose), position: 'bottom', fill: breach ? C.breach : C.text, fontSize: 10, fontFamily: MONO }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <div style={{ display: 'grid', gridTemplateRows: 'repeat(3, auto)', gap: 10 }}>
            <Card accent={C.inflow}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <Label>Owed to us</Label><Sub>{drivers.owedToUs.invoices} invoices</Sub>
              </div>
              <Big color={C.inflow}>{money(arTotal)}</Big>
              <StackBar total={arTotal} segments={[
                { label: 'DTC', value: drivers.owedToUs.byChannel.dtc, color: C.inflow },
                { label: 'Stockists', value: drivers.owedToUs.byChannel.stockist, color: C.inflow, opacity: 0.65 },
                { label: 'Fleet & Govt', value: drivers.owedToUs.byChannel.fleet_gov, color: C.inflow, opacity: 0.35 },
              ]} />
              <Sub>{prof('dtc')} · {prof('stockist')} · {prof('fleet_gov')}{drivers.owedToUs.overdue > 0 ? ` · ${compact(drivers.owedToUs.overdue)} past profile` : ''}</Sub>
            </Card>

            <Card accent={C.outflow}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <Label>Owed by us</Label><Sub>{drivers.owedByUs.apBills} bills · {drivers.owedByUs.poCount} POs</Sub>
              </div>
              <Big color={C.outflow}>{money(ap4 + po)}</Big>
              <StackBar total={ap4 + po} segments={[
                { label: 'Xero AP due ≤4 wks', value: ap4, color: C.outflow, opacity: 0.5 },
                { label: 'Cin7 POs not yet billed', value: po, color: C.outflow },
              ]} />
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <Sub>AP ≤4 wks <span style={{ color: C.text }}>{compact(ap4)}</span></Sub>
                <Sub color={C.outflow}>Cin7 POs unbilled <span style={{ color: C.text, fontWeight: 600 }}>{compact(po)}</span></Sub>
              </div>
            </Card>

            <Card>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <Label>Stock at cost</Label><Sub>{drivers.stock.skus} SKUs · Cin7</Sub>
              </div>
              <Big>{money(drivers.stock.onHandCost + drivers.stock.onOrderCost)}</Big>
              <StackBar segments={[
                { label: 'On hand', value: drivers.stock.onHandCost, color: C.muted },
                { label: 'On order', value: drivers.stock.onOrderCost, color: C.muted, opacity: 0.4 },
              ]} />
              <Sub>on hand {compact(drivers.stock.onHandCost)} · on order {compact(drivers.stock.onOrderCost)}</Sub>
            </Card>
          </div>
        </div>

        {/* Calendar strip */}
        <Card style={{ padding: '10px 14px' }}>
          <Label>Next large payments</Label>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(6, 1fr)', gap: 8 }}>
            {calendar.length === 0 && <Sub>No dated payments in horizon — add container balances / finance in CONFIG.</Sub>}
            {calendar.map((c, i) => (
              <div key={i} style={{ borderLeft: `2px solid ${C.outflow}`, paddingLeft: 8, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <Sub color={C.text}>{dLong(c.date)}</Sub>
                <span style={{ fontFamily: MONO, fontSize: 14, color: C.outflow }}>{money(c.amount)}</span>
                <Sub>{c.label}</Sub>
              </div>
            ))}
          </div>
        </Card>

        {/* Trust strip */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: isMobile ? 6 : 18, padding: '2px 4px', alignItems: 'center' }}>
          <Sub color={C.faint}>
            Last week&nbsp;
            {trust.variance
              ? <span style={{ color: C.muted }}>{trust.variance.dollars >= 0 ? '+' : ''}{money(trust.variance.dollars)} ({trust.variance.pct == null ? '—' : `${trust.variance.pct >= 0 ? '+' : ''}${pct(trust.variance.pct)}`}) vs forecast</span>
              : <span style={{ color: C.muted }}>variance available from next week</span>}
          </Sub>
          <Sub color={C.faint}>Xero synced {tShort(trust.freshness.xeroSyncedAt)}</Sub>
          <Sub color={C.faint}>Cin7 {tShort(trust.freshness.cin7SyncedAt)}</Sub>
          <Sub color={C.faint}>Bank balance as at {dLong(trust.freshness.bankAsAt)}</Sub>
          {Object.values(ch).some((p) => p.source !== 'observed') && <Sub color={C.faint}>* config profile (too few observed payments)</Sub>}
          {trust.warnings?.length > 0 && <Sub color={C.outflow}>{trust.warnings.join(' · ')}</Sub>}
        </div>

        {/* Monthly panel — below the fold */}
        <div style={{ marginTop: 18, borderTop: `1px solid ${C.border}`, paddingTop: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
            <Label>Working capital · monthly</Label>
            <Sub color={C.faint}>{monthly.period?.slice(0, 7)} vs {monthly.previous?.period?.slice(0, 7) ?? 'no prior month yet'}</Sub>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(6, 1fr)', gap: 10 }}>
            {[
              ['DSO · DTC', 'dso_dtc'], ['DSO · Stockists', 'dso_stockist'], ['DSO · Fleet & Govt', 'dso_fleet_gov'],
              ['DIO', 'dio'], ['DPO', 'dpo', false], ['Cash conversion', 'ccc'],
            ].map(([label, key, lowerBetter = true]) => (
              <Card key={key} style={{ padding: '10px 12px' }}>
                <Label>{label}</Label>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <Big size="1.2rem">{monthly.current[key] == null ? '—' : `${Math.round(monthly.current[key])}d`}</Big>
                  <span style={{ fontFamily: MONO, fontSize: 13 }}><Arrow curr={monthly.current[key]} prev={monthly.previous?.[key]} lowerIsBetter={lowerBetter} /></span>
                </div>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function Centered({ children, tone = '#a0a0a0' }) {
  return (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a0a0a', color: tone, fontFamily: MONO, fontSize: 12, gap: 8 }}>
      <WalletIcon size={14} strokeWidth={1.5} /> {children}
    </div>
  )
}
