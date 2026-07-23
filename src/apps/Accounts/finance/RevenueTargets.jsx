import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ResponsiveContainer, ComposedChart, Line, XAxis, YAxis, Tooltip,
  CartesianGrid,
} from 'recharts'
import { CurrencyDollarIcon, TargetIcon, ChartLineIcon, GaugeIcon } from '@portal/components/icons'
import { supabase } from '@portal/lib/supabase'
import { palette } from '@portal/lib/palette'

// Theme mirrors FinanceDashboard.jsx (concrete hex so recharts SVG resolves).
const C = {
  bg: '#0a0a0a', panel: '#161616', surface: '#1e1e1e',
  border: '#2a2a2a', borderSoft: '#1c1c1c',
  text: '#f8fafc', muted: '#a0a0a0', faint: '#666666',
  accent: palette.accent,
  // Lighter blue step (--cat-7): brand blue #335c67 fails 3:1 on the panel surface.
  target: '#5a8794',
  green: palette.aqua, red: palette.pink,
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const fmt0 = new Intl.NumberFormat('en-AU', { maximumFractionDigits: 0 })
function money(v) {
  if (v == null || Number.isNaN(v)) return '—'
  return v < 0 ? `-$${fmt0.format(Math.abs(v))}` : `$${fmt0.format(v)}`
}
function compact(v) {
  if (v == null) return '—'
  const a = Math.abs(v)
  if (a >= 1e6) return `$${(v / 1e6).toFixed(1)}m`
  if (a >= 1e3) return `$${Math.round(v / 1e3)}k`
  return `$${Math.round(v)}`
}
function pct(v, dp = 0) { return v == null ? '—' : `${(v * 100).toFixed(dp)}%` }

function useTargetsData() {
  return useQuery({
    queryKey: ['revenue-targets'],
    queryFn: async () => {
      const [rev, tgt] = await Promise.all([
        supabase.from('xero_monthly_revenue').select('*').order('period_month'),
        supabase.from('finance_revenue_targets').select('*'),
      ])
      if (rev.error) throw rev.error
      if (tgt.error) throw tgt.error
      return { revenue: rev.data ?? [], targets: tgt.data ?? [] }
    },
  })
}

function Tile({ icon: Icon, label, value, sub, hue = C.accent, valueColor = C.text }) {
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
      <span style={{ fontSize: 11, color: C.muted, fontFamily: '"JetBrains Mono", monospace', minHeight: 14 }}>{sub || ''}</span>
    </div>
  )
}

function Panel({ title, icon: Icon, right, children }) {
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 8, padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
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

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6, padding: '8px 12px', fontFamily: '"JetBrains Mono", monospace', fontSize: 11 }}>
      <div style={{ color: C.muted, marginBottom: 4 }}>{label}</div>
      {payload.filter((p) => p.value != null).map((p) => (
        <div key={p.dataKey} style={{ color: p.color === 'transparent' ? C.text : p.color }}>
          {p.name}: {money(p.value)}
        </div>
      ))}
    </div>
  )
}

function LegendRow() {
  const item = (color, label, line) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: C.muted, fontFamily: '"JetBrains Mono", monospace' }}>
      <span style={{ width: 14, height: line ? 2 : 10, background: color, borderRadius: line ? 0 : 2, display: 'inline-block' }} />
      {label}
    </span>
  )
  return (
    <div style={{ display: 'flex', gap: 16 }}>
      {item(C.accent, 'Actual', true)}
      {item(C.target, 'Target', true)}
      {item(C.faint, 'Stretch', true)}
    </div>
  )
}

// Editable target/stretch cell — commits on blur or Enter.
function EditCell({ value, onCommit, color }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const commit = () => {
    setEditing(false)
    const trimmed = draft.trim()
    if (trimmed === '') { onCommit(null); return }
    const n = Number(trimmed.replace(/[$,\s]/g, ''))
    if (!Number.isNaN(n)) onCommit(n)
  }
  if (editing) {
    return (
      <input
        autoFocus
        defaultValue={value ?? ''}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setEditing(false) }}
        style={{
          width: 72, background: C.surface, border: `1px solid ${C.accent}`, borderRadius: 3,
          color: C.text, fontFamily: '"JetBrains Mono", monospace', fontSize: 11, padding: '2px 4px', textAlign: 'right',
        }}
      />
    )
  }
  return (
    <span
      onClick={() => setEditing(true)}
      title="Click to edit"
      style={{ cursor: 'pointer', color: value == null ? C.faint : color, borderBottom: `1px dashed ${C.borderSoft}` }}
    >
      {value == null ? '—' : `$${fmt0.format(value)}`}
    </span>
  )
}

export default function RevenueTargets() {
  const { data, isLoading, error } = useTargetsData()
  const qc = useQueryClient()
  const now = new Date()
  const thisYear = now.getFullYear()
  const thisMonth = now.getMonth() + 1
  const [chartYear, setChartYear] = useState(thisYear)

  const upsert = useMutation({
    mutationFn: async (row) => {
      const { error: e } = await supabase.from('finance_revenue_targets')
        .upsert(row, { onConflict: 'year,month' })
      if (e) throw e
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['revenue-targets'] }),
  })

  // year -> month -> { actual, target, stretch }
  const grid = useMemo(() => {
    if (!data) return {}
    const g = {}
    const ensure = (y, m) => {
      g[y] ??= {}
      g[y][m] ??= { actual: null, target: null, stretch: null }
      return g[y][m]
    }
    for (const r of data.revenue) {
      const d = new Date(r.period_month)
      ensure(d.getFullYear(), d.getMonth() + 1).actual = Number(r.revenue)
    }
    for (const t of data.targets) {
      const cell = ensure(t.year, t.month)
      cell.target = t.target == null ? null : Number(t.target)
      cell.stretch = t.stretch == null ? null : Number(t.stretch)
    }
    return g
  }, [data])

  const years = useMemo(() => {
    const ys = Object.keys(grid).map(Number).sort((a, b) => a - b)
    // Always include the current year so targets can be entered ahead of actuals.
    if (ys.length && !ys.includes(thisYear)) ys.push(thisYear)
    return ys
  }, [grid, thisYear])

  const sumRow = (y, key, uptoMonth = 12) => {
    let s = null
    for (let m = 1; m <= uptoMonth; m++) {
      const v = grid[y]?.[m]?.[key]
      if (v != null) s = (s ?? 0) + v
    }
    return s
  }

  // Tiles — current month + YTD vs target
  const curr = grid[thisYear]?.[thisMonth]
  const ytdActual = sumRow(thisYear, 'actual', thisMonth)
  const ytdTarget = sumRow(thisYear, 'target', thisMonth)
  const ytdRatio = ytdTarget ? ytdActual / ytdTarget : null
  const prevYtd = sumRow(thisYear - 1, 'actual', thisMonth)

  const chartData = useMemo(() => MONTHS.map((label, i) => ({
    label,
    actual: grid[chartYear]?.[i + 1]?.actual ?? null,
    target: grid[chartYear]?.[i + 1]?.target ?? null,
    stretch: grid[chartYear]?.[i + 1]?.stretch ?? null,
  })), [grid, chartYear])

  if (isLoading) {
    return <div style={{ height: '100%', display: 'grid', placeItems: 'center', background: C.bg, color: C.muted, fontFamily: '"JetBrains Mono", monospace', fontSize: 13 }}>Loading revenue &amp; targets…</div>
  }
  if (error) {
    return <div style={{ height: '100%', display: 'grid', placeItems: 'center', background: C.bg, color: C.red, fontFamily: '"JetBrains Mono", monospace', fontSize: 13 }}>Failed to load: {error.message}</div>
  }

  const commitCell = (year, month, field, value) => {
    const existing = grid[year]?.[month] ?? {}
    upsert.mutate({
      year, month,
      target: field === 'target' ? value : existing.target ?? null,
      stretch: field === 'stretch' ? value : existing.stretch ?? null,
      updated_at: new Date().toISOString(),
    })
  }

  const th = { padding: '7px 10px', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.muted, textAlign: 'right', whiteSpace: 'nowrap', borderBottom: `1px solid ${C.border}` }
  const td = { padding: '6px 10px', fontFamily: '"JetBrains Mono", monospace', fontSize: 11.5, textAlign: 'right', whiteSpace: 'nowrap', borderBottom: `1px solid ${C.borderSoft}` }

  return (
    <div style={{ height: '100%', overflow: 'auto', background: C.bg, padding: 20, fontFamily: 'Inter, system-ui, sans-serif' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>

        <div>
          <h1 style={{ fontSize: 18, fontWeight: 600, color: C.text, margin: 0 }}>Revenue &amp; Targets</h1>
          <span style={{ fontSize: 12, color: C.muted, fontFamily: '"JetBrains Mono", monospace' }}>
            Actuals: Xero sales invoices (GST-exclusive) · targets editable inline
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          <Tile icon={CurrencyDollarIcon} label={`${MONTHS[thisMonth - 1]} ${thisYear} Actual`} value={money(curr?.actual)} hue={C.accent} valueColor={C.accent}
            sub={curr?.target != null ? `target ${money(curr.target)}` : 'no target set'} />
          <Tile icon={GaugeIcon} label="Month vs Target"
            value={curr?.target ? pct(curr.actual != null ? curr.actual / curr.target : null) : '—'}
            hue={C.target}
            valueColor={curr?.target && curr?.actual >= curr.target ? C.green : C.text} />
          <Tile icon={ChartLineIcon} label={`YTD ${thisYear}`} value={money(ytdActual)} hue={C.green}
            sub={prevYtd != null ? `prev yr YTD ${money(prevYtd)}` : ''} />
          <Tile icon={TargetIcon} label="YTD vs Target" value={pct(ytdRatio)} hue={C.accent}
            valueColor={ytdRatio == null ? C.text : ytdRatio >= 1 ? C.green : C.red}
            sub={ytdTarget != null ? `target ${money(ytdTarget)}` : 'no targets set'} />
        </div>

        <Panel
          title={`Monthly Revenue vs Target — ${chartYear}`}
          icon={TargetIcon}
          right={
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <LegendRow />
              <select
                value={chartYear}
                onChange={(e) => setChartYear(Number(e.target.value))}
                style={{ background: C.surface, color: C.text, border: `1px solid ${C.border}`, borderRadius: 5, padding: '4px 8px', fontSize: 12, fontFamily: '"JetBrains Mono", monospace' }}
              >
                {years.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          }
        >
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: 8, bottom: 0 }}>
              <CartesianGrid stroke={C.borderSoft} vertical={false} />
              <XAxis dataKey="label" tick={{ fill: C.muted, fontSize: 10 }} axisLine={{ stroke: C.border }} tickLine={false} />
              <YAxis tick={{ fill: C.muted, fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={compact} width={48} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
              <Line dataKey="actual" name="Actual" stroke={C.accent} strokeWidth={2} dot={{ r: 2.5, fill: C.accent, strokeWidth: 0 }} activeDot={{ r: 4 }} />
              <Line dataKey="target" name="Target" stroke={C.target} strokeWidth={2} dot={false} connectNulls />
              <Line dataKey="stretch" name="Stretch" stroke={C.faint} strokeWidth={1.5} strokeDasharray="5 4" dot={false} connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
        </Panel>

        <Panel title="Sales Targets Matrix" icon={CurrencyDollarIcon}
          right={<span style={{ fontSize: 11, color: C.faint, fontFamily: '"JetBrains Mono", monospace' }}>click a target/stretch cell to edit</span>}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 980 }}>
              <thead>
                <tr>
                  <th style={{ ...th, textAlign: 'left' }}>Year</th>
                  <th style={{ ...th, textAlign: 'left' }}>Series</th>
                  {MONTHS.map((m) => <th key={m} style={th}>{m}</th>)}
                  <th style={{ ...th, color: C.text }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {years.map((y) => {
                  const hasStretch = MONTHS.some((_, i) => grid[y]?.[i + 1]?.stretch != null) || y >= thisYear
                  const rows = [
                    { key: 'actual', label: 'Actual', color: C.accent, editable: false },
                    { key: 'target', label: 'Target', color: C.target, editable: true },
                    ...(hasStretch ? [{ key: 'stretch', label: 'Stretch', color: C.faint, editable: true }] : []),
                  ]
                  return rows.map((row, ri) => (
                    <tr key={`${y}-${row.key}`} style={{ background: row.key === 'actual' ? 'rgba(255,255,255,0.015)' : 'transparent' }}>
                      {ri === 0 && (
                        <td rowSpan={rows.length} style={{ ...td, textAlign: 'left', color: C.text, fontWeight: 600, fontSize: 13, verticalAlign: 'top', borderBottom: `1px solid ${C.border}` }}>
                          {y}
                        </td>
                      )}
                      <td style={{ ...td, textAlign: 'left', color: row.color, borderBottom: ri === rows.length - 1 ? `1px solid ${C.border}` : td.borderBottom }}>{row.label}</td>
                      {MONTHS.map((_, i) => {
                        const cell = grid[y]?.[i + 1]
                        const v = cell?.[row.key]
                        const isFuture = y > thisYear || (y === thisYear && i + 1 > thisMonth)
                        return (
                          <td key={i} style={{ ...td, borderBottom: ri === rows.length - 1 ? `1px solid ${C.border}` : td.borderBottom }}>
                            {row.editable
                              ? <EditCell value={v} color={row.color} onCommit={(n) => commitCell(y, i + 1, row.key, n)} />
                              : <span style={{
                                  color: v == null ? C.faint : C.text,
                                  opacity: isFuture ? 0.5 : 1,
                                  fontWeight: cell?.target != null && v != null && v >= cell.target ? 600 : 400,
                                }}>
                                  {v == null ? '—' : `$${fmt0.format(v)}`}
                                </span>}
                          </td>
                        )
                      })}
                      <td style={{ ...td, color: row.key === 'actual' ? C.accent : row.color, fontWeight: 600, borderBottom: ri === rows.length - 1 ? `1px solid ${C.border}` : td.borderBottom }}>
                        {money(sumRow(y, row.key))}
                      </td>
                    </tr>
                  ))
                })}
              </tbody>
            </table>
          </div>
        </Panel>

      </div>
    </div>
  )
}
