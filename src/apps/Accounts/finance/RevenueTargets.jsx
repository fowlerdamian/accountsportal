import { useMemo, useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ResponsiveContainer, ComposedChart, Line, XAxis, YAxis, Tooltip,
  CartesianGrid,
} from 'recharts'
import { CurrencyDollarIcon, TargetIcon, ChartLineIcon, GaugeIcon, TriangleAlertIcon } from '@portal/components/icons'
import { supabase } from '@portal/lib/supabase'
import { palette } from '@portal/lib/palette'
import { computeSeasonalityTargets, applyRollingReallocation } from './seasonalityTargets.js'

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

// Fixed year→hue assignment (stable by position in the full years list, so
// toggling selections never repaints a year). Brighter portal steps only —
// the dark --cat tokens fail 3:1 on the panel surface.
const YEAR_HUES = ['#e09f3e', '#5a8794', '#c14f50', '#eab768', '#fff3b0', '#9e2a2b']
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

function LegendRow({ years, hueForYear, single }) {
  return (
    <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
      {years.map((y) => (
        <span key={y} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: C.muted, fontFamily: '"JetBrains Mono", monospace' }}>
          <span style={{ width: 14, height: 2, background: hueForYear(y), display: 'inline-block' }} />
          {y}
        </span>
      ))}
      <span style={{ fontSize: 10, color: C.faint, fontFamily: '"JetBrains Mono", monospace' }}>
        solid actual · dashed target{single ? ' · dotted stretch' : ''}
      </span>
    </div>
  )
}

function YearChips({ years, selected, onToggle }) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {years.map((y) => {
        const on = selected.includes(y)
        return (
          <button
            key={y}
            onClick={() => onToggle(y)}
            style={{
              background: on ? 'rgba(224,159,62,0.12)' : C.panel,
              border: `1px solid ${on ? C.accent : C.border}`,
              color: on ? C.accent : C.muted,
              borderRadius: 6, padding: '5px 12px', fontSize: 12, cursor: 'pointer',
              fontFamily: '"JetBrains Mono", monospace', transition: 'all 120ms',
            }}
          >
            {y}
          </button>
        )
      })}
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

// ── MTD pacing gauge ─────────────────────────────────────────────────────────
const GAUGE_MAX = 1.5 // dial scale tops out at 150% of pace
const GAUGE_SWEEP = 240 // degrees, from -120° to +120°
function polarXY(cx, cy, r, deg) {
  const a = (deg - 90) * (Math.PI / 180)
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
}
function arcPath(cx, cy, r, startDeg, endDeg) {
  const [x1, y1] = polarXY(cx, cy, r, startDeg)
  const [x2, y2] = polarXY(cx, cy, r, endDeg)
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${endDeg - startDeg > 180 ? 1 : 0} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`
}
const ratioDeg = (v) => -GAUGE_SWEEP / 2 + (Math.min(Math.max(v, 0), GAUGE_MAX) / GAUGE_MAX) * GAUGE_SWEEP

// Shared status colour: green on pace, orange within 25% of pace, red below.
const paceHue = (v) => (v == null ? C.faint : v >= 1 ? C.green : v >= 0.75 ? palette.orange : C.red)
const GAUGE_ZONES = [[0, 0.75, () => C.red], [0.75, 1, () => palette.orange], [1, GAUGE_MAX, () => C.green]]

function PacingGauge({ ratio, label }) {
  const cx = 110; const cy = 104; const r = 80
  const hue = paceHue(ratio)
  const deg = ratioDeg(ratio ?? 0)
  const [nx, ny] = polarXY(cx, cy, r - 16, deg)
  return (
    <svg viewBox="0 0 220 150" style={{ width: 220, flexShrink: 0 }} role="img" aria-label={`${label} ${pct(ratio)}`}>
      {/* zone band (red / orange / green) + value arc */}
      {GAUGE_ZONES.map(([a, b, col]) => (
        <path key={a} d={arcPath(cx, cy, r, ratioDeg(a), ratioDeg(b))} fill="none" stroke={col()} strokeOpacity={0.2} strokeWidth={11} />
      ))}
      {ratio != null && ratio > 0 && (
        <path d={arcPath(cx, cy, r, -GAUGE_SWEEP / 2, deg)} fill="none" stroke={hue} strokeWidth={11} strokeLinecap="round" />
      )}
      {/* ticks */}
      {[0, 0.5, 1, 1.5].map((t) => {
        const d = ratioDeg(t)
        const [ox, oy] = polarXY(cx, cy, r + 9, d)
        const [ix, iy] = polarXY(cx, cy, r + 5, d)
        const [tx, ty] = polarXY(cx, cy, r + 20, d)
        const on100 = t === 1
        return (
          <g key={t}>
            <line x1={ix} y1={iy} x2={ox} y2={oy} stroke={on100 ? C.text : C.faint} strokeWidth={on100 ? 2 : 1} />
            <text x={tx} y={ty + 3} textAnchor="middle" fill={on100 ? C.muted : C.faint} fontSize={9} fontFamily='"JetBrains Mono", monospace'>
              {Math.round(t * 100)}%
            </text>
          </g>
        )
      })}
      {/* needle */}
      {ratio != null && (
        <>
          <line x1={cx} y1={cy} x2={nx} y2={ny} stroke={C.text} strokeWidth={2} strokeLinecap="round" />
          <circle cx={cx} cy={cy} r={4} fill={C.text} />
        </>
      )}
      <text x={cx} y={cy + 28} textAnchor="middle" fill={hue} fontSize={20} fontWeight={600} fontFamily='"JetBrains Mono", monospace'>
        {pct(ratio)}
      </text>
      <text x={cx} y={cy + 42} textAnchor="middle" fill={C.muted} fontSize={9} letterSpacing="0.1em" fontFamily='"JetBrains Mono", monospace'>
        {label}
      </text>
    </svg>
  )
}

// Dial + stat drawer for one pacing period (MTD or YTD). `proRata` is the
// elapsed-share of `fullTarget`; the estimate is a straight-line projection.
// The stat grid is hidden behind the dial and slides out on click.
function PacingPanel({ title, right, prefix, estWord, actual, proRata, fullTarget, emptyHint }) {
  const [open, setOpen] = useState(false)
  const pace = proRata ? (actual ?? 0) / proRata : null
  const projected = pace != null && fullTarget != null ? fullTarget * pace : null
  return (
    <Panel title={title} icon={GaugeIcon} right={right}>
      {fullTarget == null ? (
        <span style={{ fontSize: 12, color: C.muted, fontFamily: '"JetBrains Mono", monospace' }}>{emptyHint}</span>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', minHeight: 150, position: 'relative' }}>
          <button
            onClick={() => setOpen((o) => !o)}
            title={open ? 'Hide breakdown' : 'Show breakdown'}
            aria-expanded={open}
            style={{
              background: C.panel, border: 'none', padding: 0, cursor: 'pointer',
              position: 'relative', zIndex: 1, flexShrink: 0, lineHeight: 0,
            }}
          >
            <PacingGauge ratio={pace} label={`${prefix} PACE`} />
          </button>
          <div style={{ overflow: 'hidden', flex: 1 }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 16, paddingLeft: 20,
              transform: open ? 'translateX(0)' : 'translateX(-104%)',
              opacity: open ? 1 : 0,
              transition: 'transform 340ms cubic-bezier(0.22, 0.9, 0.3, 1), opacity 260ms ease',
            }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'auto auto', columnGap: 20, rowGap: 8, fontFamily: '"JetBrains Mono", monospace', fontSize: 12, whiteSpace: 'nowrap' }}>
                {[
                  { label: `${prefix} actual`, value: money(actual), color: C.accent },
                  { label: `${prefix} target (pro-rata)`, value: money(proRata), color: C.target },
                  {
                    label: `${prefix} variance`,
                    value: actual != null && proRata != null ? money(actual - proRata) : '—',
                    color: actual != null && proRata != null ? (actual >= proRata ? C.green : C.red) : C.faint,
                  },
                  { label: `Pro-rata ${estWord} estimate`, value: money(projected), color: C.text },
                  { label: `${estWord[0].toUpperCase()}${estWord.slice(1)} target`, value: money(fullTarget), color: C.muted },
                ].map((row) => (
                  <div key={row.label} style={{ display: 'contents' }}>
                    <span style={{ color: C.muted }}>{row.label}</span>
                    <span style={{ color: row.color, textAlign: 'right', fontWeight: 500 }}>{row.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          {!open && (
            <span style={{ position: 'absolute', right: 18, fontSize: 10, color: C.faint, fontFamily: '"JetBrains Mono", monospace', pointerEvents: 'none' }}>
              tap dial ›
            </span>
          )}
        </div>
      )}
    </Panel>
  )
}

const SYNC_LABEL = { idle: 'Sync Xero', syncing: 'Requesting…', waiting: 'Syncing… ~1 min', done: 'Synced ✓', cooldown: 'On cooldown', error: 'Failed' }
function SyncButton({ state, onClick, detail }) {
  const busy = state === 'syncing' || state === 'waiting'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
      <button
        onClick={onClick}
        disabled={busy}
        style={{
          background: state === 'done' ? 'rgba(51,92,103,0.2)' : C.panel,
          border: `1px solid ${state === 'error' ? C.red : C.border}`,
          color: state === 'error' ? C.red : state === 'done' ? C.green : C.text,
          borderRadius: 6, padding: '6px 14px', fontSize: 12, cursor: busy ? 'wait' : 'pointer',
          fontFamily: '"JetBrains Mono", monospace', opacity: busy ? 0.7 : 1,
        }}
      >
        {SYNC_LABEL[state]}{state === 'cooldown' && detail ? ` (${detail})` : ''}
      </button>
      <span style={{ fontSize: 10, color: C.faint, fontFamily: '"JetBrains Mono", monospace' }}>
        ⚠ uses Xero API quota — sparingly, max 1 per 10 min
      </span>
    </div>
  )
}

export default function RevenueTargets() {
  const { data, isLoading, error } = useTargetsData()
  const qc = useQueryClient()
  const now = new Date()
  const thisYear = now.getFullYear()
  const thisMonth = now.getMonth() + 1
  const [selYearsRaw, setSelYears] = useState(null) // null → default to current year
  const [syncState, setSyncState] = useState('idle')
  const [syncDetail, setSyncDetail] = useState(null)

  async function handleSync() {
    if (syncState === 'syncing' || syncState === 'waiting') return
    setSyncState('syncing')
    try {
      const { data: res, error: e } = await supabase.rpc('request_xero_invoice_sync')
      if (e) throw e
      if (!res?.ok) {
        if (res?.retry_in_seconds) {
          setSyncDetail(`${Math.ceil(res.retry_in_seconds / 60)}m left`)
          setSyncState('cooldown')
        } else throw new Error(res?.error || 'sync refused')
      } else {
        // pg_net fires the edge fn async — give it a minute, then refetch.
        setSyncState('waiting')
        setTimeout(async () => {
          await qc.invalidateQueries({ queryKey: ['revenue-targets'] })
          setSyncState('done')
          setTimeout(() => setSyncState('idle'), 4000)
        }, 75000)
        return
      }
    } catch (err) {
      console.error('[targets sync]', err)
      setSyncState('error')
    }
    setTimeout(() => setSyncState('idle'), 5000)
  }

  const upsert = useMutation({
    mutationFn: async (row) => {
      const { error: e } = await supabase.from('finance_revenue_targets')
        .upsert(row, { onConflict: 'year,month' })
      if (e) throw e
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['revenue-targets'] }),
  })

  // ── Seasonality model (client-side, pure) ────────────────────────────────────
  // Median-of-actuals seasonality plan for the current year, with rolling
  // reallocation: completed months lock to actuals (their STORED targets stay
  // untouched as the historical record), remaining months re-spread so the
  // year sums to exactly the annual totals.
  const BASE_TOTAL = 2_000_000
  const STRETCH_TOTAL = 2_500_000
  const seasonality = useMemo(() => {
    if (!data?.revenue?.length) return null
    const actuals = data.revenue.map((r) => {
      const d = new Date(r.period_month)
      return { year: d.getFullYear(), month: d.getMonth() + 1, revenue: Number(r.revenue) }
    })
    try {
      const model = computeSeasonalityTargets(actuals, { baseTotal: BASE_TOTAL, stretchTotal: STRETCH_TOTAL, now })
      const rolling = applyRollingReallocation(model, actuals, { year: thisYear, baseTotal: BASE_TOTAL, stretchTotal: STRETCH_TOTAL, now })
      for (const w of [...model.warnings, ...rolling.warnings]) console.warn('[seasonality]', w)
      for (const l of [...model.logs, ...rolling.logs]) console.info('[seasonality]', l)
      return { model, rolling }
    } catch (e) {
      console.error('[seasonality]', e)
      return null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, thisYear])

  // Auto-persist adjusted targets for OPEN months only — completed months keep
  // the target that was set at the time, so past hit/miss stays honest. Writes
  // only when the stored values differ, so this settles after one pass.
  const applying = useRef(false)
  useEffect(() => {
    if (!seasonality || !data?.targets || applying.current) return
    const stored = new Map(data.targets.filter((t) => t.year === thisYear).map((t) => [t.month, t]))
    // Smart targets own the whole current year: completed months carry the
    // static pro-rata plan (what the target WAS for that month), open months
    // carry the rolling-adjusted values.
    const wanted = seasonality.rolling.months.map((m) => ({
      month: m.month,
      target: m.completed ? m.planBase : m.base,
      stretch: m.completed ? m.planStretch : m.stretch,
    }))
    const dirty = wanted
      .filter((w) => {
        const s = stored.get(w.month)
        return !s || Math.round(Number(s.target ?? -1)) !== w.target || Math.round(Number(s.stretch ?? -1)) !== w.stretch
      })
      .map((w) => ({ year: thisYear, month: w.month, target: w.target, stretch: w.stretch, updated_at: new Date().toISOString() }))
    if (!dirty.length) return
    applying.current = true
    supabase.from('finance_revenue_targets').upsert(dirty, { onConflict: 'year,month' })
      .then(({ error: e }) => {
        if (e) console.error('[seasonality] auto-apply failed:', e)
        else console.info(`[seasonality] auto-applied adjusted targets to ${dirty.length} open month(s)`)
        applying.current = false
        qc.invalidateQueries({ queryKey: ['revenue-targets'] })
      })
  }, [seasonality, data, thisYear, qc])

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

  // MTD pacing — actual so far vs the pro-rata share of this month's target,
  // plus a straight-line projection of where the month lands at current pace.
  // Pro-rata runs on working days (Mon–Fri), not calendar days.
  const countWorkdays = (uptoDay) => {
    let n = 0
    for (let d = 1; d <= uptoDay; d++) {
      const dow = new Date(thisYear, thisMonth - 1, d).getDay()
      if (dow !== 0 && dow !== 6) n++
    }
    return n
  }
  const workdaysInMonth = countWorkdays(new Date(thisYear, thisMonth, 0).getDate())
  const workdaysElapsed = countWorkdays(now.getDate())
  const elapsedFrac = workdaysInMonth ? Math.min(workdaysElapsed / workdaysInMonth, 1) : 0
  const mtdActual = curr?.actual ?? null
  const mtdTarget = curr?.target != null ? curr.target * elapsedFrac : null
  // YTD pro-rata: completed months at full target + current month's elapsed share.
  const yearTarget = sumRow(thisYear, 'target', 12)
  const ytdProRataTarget = yearTarget == null ? null
    : (sumRow(thisYear, 'target', thisMonth - 1) ?? 0) + (curr?.target ?? 0) * elapsedFrac

  const selYears = useMemo(() => {
    const sel = selYearsRaw ?? [thisYear]
    const valid = sel.filter((y) => years.includes(y))
    return valid.length ? valid : years.slice(-1)
  }, [selYearsRaw, years, thisYear])
  const single = selYears.length === 1
  const hueForYear = (y) => YEAR_HUES[Math.max(0, years.indexOf(y)) % YEAR_HUES.length]
  const toggleYear = (y) => {
    const next = selYears.includes(y) ? selYears.filter((v) => v !== y) : [...selYears, y].sort((a, b) => a - b)
    if (next.length) setSelYears(next)
  }

  const chartData = useMemo(() => MONTHS.map((label, i) => {
    const row = { label }
    for (const y of selYears) {
      row[`a${y}`] = grid[y]?.[i + 1]?.actual ?? null
      row[`t${y}`] = grid[y]?.[i + 1]?.target ?? null
      row[`s${y}`] = grid[y]?.[i + 1]?.stretch ?? null
    }
    return row
  }), [grid, selYears])

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

        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 600, color: C.text, margin: 0 }}>Revenue &amp; Targets</h1>
            <span style={{ fontSize: 12, color: C.muted, fontFamily: '"JetBrains Mono", monospace' }}>
              Actuals: Xero sales invoices (GST-exclusive) · targets editable inline
            </span>
          </div>
          <SyncButton state={syncState} detail={syncDetail} onClick={handleSync} />
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

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(460px, 1fr))', gap: 16 }}>
          <PacingPanel
            title={`MTD Pacing — ${MONTHS[thisMonth - 1]} ${thisYear}`}
            prefix="MTD" estWord="month"
            actual={mtdActual} proRata={mtdTarget} fullTarget={curr?.target ?? null}
            right={
              <span style={{ fontSize: 11, color: C.faint, fontFamily: '"JetBrains Mono", monospace' }}>
                workday {workdaysElapsed} of {workdaysInMonth} · {pct(elapsedFrac)} elapsed
              </span>
            }
            emptyHint={`No target set for ${MONTHS[thisMonth - 1]} — enter one in the matrix below to enable pacing.`}
          />
          <PacingPanel
            title={`YTD Pacing — ${thisYear}`}
            prefix="YTD" estWord="year"
            actual={ytdActual} proRata={ytdProRataTarget} fullTarget={yearTarget}
            right={
              <span style={{ fontSize: 11, color: C.faint, fontFamily: '"JetBrains Mono", monospace' }}>
                {yearTarget ? `${pct(ytdProRataTarget / yearTarget)} of year target elapsed` : ''}
              </span>
            }
            emptyHint={`No ${thisYear} targets set — enter them in the matrix below to enable pacing.`}
          />
        </div>

        {/* Year filter — drives both the chart overlay and which tables show */}
        <YearChips years={years} selected={selYears} onToggle={toggleYear} />

        <Panel
          title={`Monthly Revenue vs Target — ${selYears.join(' · ')}`}
          icon={TargetIcon}
          right={<LegendRow years={selYears} hueForYear={hueForYear} single={single} />}
        >
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: 8, bottom: 0 }}>
              <CartesianGrid stroke={C.borderSoft} vertical={false} />
              <XAxis dataKey="label" tick={{ fill: C.muted, fontSize: 10 }} axisLine={{ stroke: C.border }} tickLine={false} />
              <YAxis tick={{ fill: C.muted, fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={compact} width={48} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
              {selYears.map((y) => {
                const hue = hueForYear(y)
                return [
                  <Line key={`a${y}`} dataKey={`a${y}`} name={`${y} Actual`} stroke={hue} strokeWidth={2}
                    dot={{ r: 2.5, fill: hue, strokeWidth: 0 }} activeDot={{ r: 4 }} />,
                  <Line key={`t${y}`} dataKey={`t${y}`} name={`${y} Target`} stroke={hue} strokeWidth={1.5}
                    strokeDasharray="6 4" strokeOpacity={0.75} dot={false} connectNulls />,
                  ...(single ? [
                    <Line key={`s${y}`} dataKey={`s${y}`} name={`${y} Stretch`} stroke={C.faint} strokeWidth={1.5}
                      strokeDasharray="2 4" dot={false} connectNulls />,
                  ] : []),
                ]
              })}
            </ComposedChart>
          </ResponsiveContainer>
        </Panel>

        {seasonality && (
          <Panel
            title={`${thisYear} Seasonality Model — $${(BASE_TOTAL / 1e6).toFixed(1)}m base / $${(STRETCH_TOTAL / 1e6).toFixed(1)}m stretch`}
            icon={GaugeIcon}
          >
            {[...seasonality.model.warnings, ...seasonality.rolling.warnings].map((w, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(158,42,43,0.12)', border: '1px solid rgba(158,42,43,0.4)', borderRadius: 6, padding: '8px 12px' }}>
                <TriangleAlertIcon size={14} strokeWidth={1.6} style={{ color: C.red, flexShrink: 0 }} />
                <span style={{ fontSize: 12, color: C.muted }}>{w}</span>
              </div>
            ))}
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 980 }}>
                <thead>
                  <tr>
                    <th style={{ padding: '7px 10px', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.muted, textAlign: 'left', borderBottom: `1px solid ${C.border}` }}>Series</th>
                    {seasonality.rolling.months.map((m) => (
                      <th key={m.month} style={{ padding: '7px 10px', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: m.completed ? C.faint : C.muted, textAlign: 'right', borderBottom: `1px solid ${C.border}` }}>
                        {m.name}{m.completed ? ' ✓' : ''}
                      </th>
                    ))}
                    <th style={{ padding: '7px 10px', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.text, textAlign: 'right', borderBottom: `1px solid ${C.border}` }}>Year</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { label: 'Index', render: (m) => `${(m.index * 100).toFixed(1)}%`, color: C.faint, total: '100%' },
                    {
                      label: 'Actual', color: C.text,
                      render: (m) => {
                        if (m.actual == null) return '—'
                        if (!m.completed) return `$${fmt0.format(Math.round(m.actual))}`
                        // ✓ hit, ~ within 5% of target (orange), ✗ miss
                        const near = m.actual < m.planBase && m.actual >= m.planBase * 0.95
                        const hit = m.actual >= m.planBase
                        const mark = hit ? ' ✓' : near ? ' ~' : ' ✗'
                        const color = hit ? C.green : near ? palette.orange : C.red
                        return <span style={{ color }}>{`$${fmt0.format(Math.round(m.actual))}${mark}`}</span>
                      },
                      total: money(seasonality.rolling.ytdActual),
                    },
                    { label: 'Target', render: (m) => `$${fmt0.format(m.completed ? m.planBase : m.base)}`, color: C.accent, total: money(seasonality.rolling.sums.base) },
                    { label: 'Stretch', render: (m) => `$${fmt0.format(m.completed ? m.planStretch : m.stretch)}`, color: C.muted, total: money(seasonality.rolling.sums.stretch) },
                  ].map((row) => (
                    <tr key={row.label}>
                      <td style={{ padding: '6px 10px', fontFamily: '"JetBrains Mono", monospace', fontSize: 11.5, color: row.color, whiteSpace: 'nowrap', borderBottom: `1px solid ${C.borderSoft}` }}>{row.label}</td>
                      {seasonality.rolling.months.map((m) => (
                        <td key={m.month} style={{ padding: '6px 10px', fontFamily: '"JetBrains Mono", monospace', fontSize: 11.5, textAlign: 'right', whiteSpace: 'nowrap', color: m.completed && (row.label === 'Target' || row.label === 'Stretch') ? C.faint : C.text, borderBottom: `1px solid ${C.borderSoft}` }}>
                          {row.render(m)}
                        </td>
                      ))}
                      <td style={{ padding: '6px 10px', fontFamily: '"JetBrains Mono", monospace', fontSize: 11.5, textAlign: 'right', fontWeight: 600, color: row.color, borderBottom: `1px solid ${C.borderSoft}` }}>{row.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        )}

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
                {selYears.map((y) => {
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
