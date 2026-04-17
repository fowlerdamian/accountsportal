import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { ArrowUpDown, CheckCircle2 } from 'lucide-react'
import { supabase } from '@portal/lib/supabase'

// ─── Constants ────────────────────────────────────────────────────────────────

const ALL_STATUSES   = ['Draft', 'Authorised', 'Ordered', 'Invoiced']
const DEFAULT_FILTER = ['Draft', 'Authorised', 'Ordered']

const STATUS_STYLE = {
  Draft:      { color: '#a0a0a0',    background: '#0a0a0a',                  border: '1px solid #222222' },
  Authorised: { color: '#60a5fa', background: 'rgba(96,165,250,0.1)',  border: '1px solid rgba(96,165,250,0.3)' },
  Ordered:    { color: '#a78bfa', background: 'rgba(167,139,250,0.1)', border: '1px solid rgba(167,139,250,0.3)' },
  Invoiced:   { color: '#34d399', background: 'rgba(52,211,153,0.1)',  border: '1px solid rgba(52,211,153,0.3)' },
  Receiving:  { color: '#f3ca0f', background: 'rgba(243,202,15,0.1)',  border: '1px solid rgba(243,202,15,0.3)' },
  Received:   { color: '#4ade80', background: 'rgba(74,222,128,0.1)',  border: '1px solid rgba(74,222,128,0.3)' },
  Cancelled:  { color: '#888',    background: '#0a0a0a',                  border: '1px solid #222' },
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function dueDiffDays(due) {
  if (!due) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.floor((localDate(due).getTime() - today.getTime()) / 86_400_000)
}

function localDate(str) {
  return str ? new Date(`${str}T00:00:00`) : null
}

function fmtDate(str) {
  const d = localDate(str)
  return d ? d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
}

function DueLabel({ due }) {
  if (!due) return <span style={{ color: '#333' }}>—</span>
  const diff = dueDiffDays(due)
  const label = fmtDate(due)
  if (diff < 0)  return <span style={{ color: '#ff1744', fontWeight: 500 }}>{label} <span style={{ fontSize: '11px', fontFamily: '"JetBrains Mono", monospace' }}>({Math.abs(diff)}d overdue)</span></span>
  if (diff <= 7) return <span style={{ color: '#f3ca0f', fontWeight: 500 }}>{label} <span style={{ fontSize: '11px', fontFamily: '"JetBrains Mono", monospace' }}>({diff}d)</span></span>
  return <span style={{ color: '#AAA' }}>{label}</span>
}

// ─── Inline editable due date ─────────────────────────────────────────────────

function DueDateCell({ poId, due, onSaved }) {
  const [editing, setEditing] = useState(false)
  const [value,   setValue]   = useState(due ?? '')
  const [saving,  setSaving]  = useState(false)
  const saveInProgress = useRef(false)

  async function save(newVal) {
    if (saveInProgress.current) return
    saveInProgress.current = true
    setSaving(true)
    const { error } = await supabase
      .from('purchase_orders')
      .update({ due_date: newVal || null })
      .eq('id', poId)
    setSaving(false)
    saveInProgress.current = false
    if (error) {
      alert(`Failed to save due date: ${error.message}`)
      return
    }
    onSaved(poId, newVal || null)
    setEditing(false)
  }

  if (editing) {
    return (
      <input
        type="date"
        autoFocus
        value={value}
        onChange={e => setValue(e.target.value)}
        onBlur={() => save(value)}
        onKeyDown={e => { if (e.key === 'Enter') save(value); if (e.key === 'Escape') setEditing(false) }}
        style={{
          background: '#1a1a1a', border: '1px solid rgba(243,202,15,0.5)',
          borderRadius: '4px', color: '#ffffff', fontSize: '13px',
          padding: '6px 8px', outline: 'none',
          fontFamily: '"JetBrains Mono", monospace', width: '100%',
          opacity: saving ? 0.5 : 1, boxSizing: 'border-box',
        }}
      />
    )
  }

  return (
    <div onClick={() => { setValue(due ?? ''); setEditing(true) }} title="Tap to set due date"
      style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '6px', minHeight: '32px' }}>
      <DueLabel due={due} />
      <span style={{ fontSize: '10px', color: '#333', flexShrink: 0 }}>✎</span>
    </div>
  )
}

// ─── KPI card ─────────────────────────────────────────────────────────────────

function KpiCard({ label, value, valueStyle }) {
  return (
    <div style={{ background: '#0a0a0a', border: '1px solid #1e1e1e', borderRadius: '8px', padding: '16px' }}>
      <p style={{ fontSize: '10px', fontFamily: '"JetBrains Mono", monospace', color: '#a0a0a0', textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>
        {label}
      </p>
      <p style={{ fontSize: '20px', fontWeight: 600, color: '#ffffff', margin: '6px 0 0', ...valueStyle }}>
        {value}
      </p>
    </div>
  )
}

// ─── Filter toggle ────────────────────────────────────────────────────────────

function FilterToggle({ status, active, onToggle }) {
  const ss = STATUS_STYLE[status] ?? STATUS_STYLE.Draft
  return (
    <button
      onClick={() => onToggle(status)}
      style={{
        padding: '4px 12px',
        fontSize: '11px',
        fontFamily: '"JetBrains Mono", monospace',
        borderRadius: '20px',
        cursor: 'pointer',
        transition: 'opacity 150ms',
        border: ss.border,
        background: active ? ss.background : 'transparent',
        color: active ? ss.color : '#444',
        opacity: active ? 1 : 0.6,
      }}
    >
      {status}
    </button>
  )
}

// ─── Mobile card ──────────────────────────────────────────────────────────────

function PoCard({ po, onSaved }) {
  const diff = dueDiffDays(po.due_date)
  const isOverdue = diff !== null && diff < 0
  const ss = STATUS_STYLE[po.status] ?? STATUS_STYLE.Draft

  return (
    <div style={{
      background: isOverdue ? 'rgba(239,68,68,0.04)' : '#0a0a0a',
      border: `1px solid ${isOverdue ? 'rgba(239,68,68,0.2)' : '#222222'}`,
      borderRadius: '8px', padding: '14px 16px',
      display: 'flex', flexDirection: 'column', gap: '10px',
    }}>
      {/* Row 1: PO # + status + order sent */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
        <a
          href={`https://inventory.dearsystems.com/Purchase#${po.cin7_id}`}
          target="_blank" rel="noopener noreferrer"
          style={{ color: '#f3ca0f', textDecoration: 'none', fontSize: '14px', fontFamily: '"JetBrains Mono", monospace', fontWeight: 600 }}
        >
          {po.po_number}
        </a>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ ...ss, display: 'inline-block', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontFamily: '"JetBrains Mono", monospace' }}>
            {po.status}
          </span>
          {po.has_attachment && (
            <CheckCircle2 size={16} strokeWidth={1.5} style={{ color: 'var(--status-success)' }} />
          )}
        </div>
      </div>

      {/* Row 2: supplier + created date */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
        <p style={{ margin: 0, fontSize: '13px', color: '#AAA' }}>{po.supplier_name}</p>
        {po.order_date && (
          <span style={{ fontSize: '11px', fontFamily: '"JetBrains Mono", monospace', color: '#a0a0a0' }}>
            {fmtDate(po.order_date)}
          </span>
        )}
      </div>

      {/* Row 3: due date */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span style={{ fontSize: '10px', fontFamily: '"JetBrains Mono", monospace', color: '#444', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Due</span>
        <DueDateCell poId={po.id} due={po.due_date} onSaved={onSaved} />
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

function useIsMobile() {
  const [mobile, setMobile] = useState(() => window.innerWidth < 700)
  useEffect(() => {
    const fn = () => setMobile(window.innerWidth < 700)
    window.addEventListener('resize', fn)
    return () => window.removeEventListener('resize', fn)
  }, [])
  return mobile
}

export default function PurchaseOrders() {
  const [orders,        setOrders]        = useState([])
  const [loading,       setLoading]       = useState(true)
  const [fetchError,    setFetchError]    = useState(null)
  const [syncing,       setSyncing]       = useState(false)
  const [syncMsg,       setSyncMsg]       = useState(null)
  const [lastSync,      setLastSync]      = useState(null)
  const [activeFilters, setActiveFilters] = useState(DEFAULT_FILTER)
  const [sortCol, setSortCol] = useState('due_date')
  const [sortDir, setSortDir] = useState('asc')
  const isMobile = useIsMobile()

  const fetchOrders = useCallback(async () => {
    const { data, error } = await supabase
      .from('purchase_orders')
      .select('*')
      .in('status', ALL_STATUSES)
      .order('due_date', { ascending: true, nullsFirst: false })
    if (error) {
      setFetchError(error.message ?? 'Failed to load orders')
    } else if (data) {
      setFetchError(null)
      setOrders(data)
      if (data.length > 0) {
        const latest = data.reduce((best, o) => o.synced_at > best ? o.synced_at : best, data[0].synced_at)
        setLastSync(latest)
      }
    }
    setLoading(false)
  }, [])

  useEffect(() => { fetchOrders() }, [fetchOrders])

  function handleDueSaved(poId, newDate) {
    setOrders(prev => prev.map(o => o.id === poId ? { ...o, due_date: newDate } : o))
  }

  function toggleFilter(status) {
    setActiveFilters(prev => {
      if (prev.includes(status)) {
        // Keep at least one active
        if (prev.length === 1) return prev
        return prev.filter(s => s !== status)
      }
      return [...prev, status]
    })
  }

  async function handleSync() {
    setSyncing(true)
    setSyncMsg(null)
    try {
      const { data, error } = await supabase.functions.invoke('sync-cin7-pos', {
        headers: { Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}` },
      })
      if (error) {
        let detail = error.message ?? 'Unknown error'
        try { const body = await error.context?.json?.(); detail = JSON.stringify(body) } catch {}
        throw new Error(detail)
      }
      const errCount = data?.errors?.length ?? 0
      const text = errCount > 0
        ? `${data?.synced ?? 0} updated, ${errCount} error${errCount > 1 ? 's' : ''}`
        : `${data?.synced ?? 0} orders updated`
      setSyncMsg({ type: errCount > 0 ? 'err' : 'ok', text })
      await fetchOrders()
    } catch (err) {
      setSyncMsg({ type: 'err', text: err.message ?? 'Sync failed' })
    } finally {
      setSyncing(false)
    }
  }

  function handleSort(col) {
    if (sortCol === col) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortCol(col)
      setSortDir('asc')
    }
  }

  const visible = useMemo(() => {
    const filtered = orders.filter(o => activeFilters.includes(o.status))
    if (!sortCol) return filtered
    return [...filtered].sort((a, b) => {
      let av = a[sortCol], bv = b[sortCol]
      // Handle nulls — push to end
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      // Booleans
      if (typeof av === 'boolean') { av = av ? 1 : 0; bv = bv ? 1 : 0 }
      // Strings
      if (typeof av === 'string') {
        const cmp = av.localeCompare(bv)
        return sortDir === 'asc' ? cmp : -cmp
      }
      // Numbers
      return sortDir === 'asc' ? av - bv : bv - av
    })
  }, [orders, activeFilters, sortCol, sortDir])
  const overdue   = visible.filter(o => { const d = dueDiffDays(o.due_date); return d !== null && d < 0 })
  const dueSoon   = visible.filter(o => { const d = dueDiffDays(o.due_date); return d !== null && d >= 0 && d <= 7 })

  if (loading) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 28, height: 28, borderRadius: '50%', border: '2px solid #f3ca0f', borderTopColor: 'transparent', animation: 'spin 0.7s linear infinite' }} />
      </div>
    )
  }

  if (fetchError) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px' }}>
        <p style={{ color: '#ff1744', fontFamily: '"JetBrains Mono", monospace', fontSize: '13px', margin: 0 }}>
          Failed to load orders: {fetchError}
        </p>
        <button
          onClick={() => { setFetchError(null); setLoading(true); fetchOrders() }}
          style={{ padding: '6px 14px', fontSize: '12px', color: '#f3ca0f', border: '1px solid rgba(243,202,15,0.35)', background: 'transparent', borderRadius: '6px', cursor: 'pointer' }}
        >
          Retry
        </button>
      </div>
    )
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '20px 16px' : '32px 24px', maxWidth: '1200px', margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ fontSize: '18px', fontWeight: 600, color: '#ffffff', margin: 0, letterSpacing: '-0.01em' }}>
            Purchase Orders
          </h1>
          <p style={{ fontSize: '12px', color: '#a0a0a0', margin: '4px 0 0', fontFamily: '"JetBrains Mono", monospace' }}>
            {lastSync
              ? `Synced ${new Date(lastSync).toLocaleString('en-AU', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}`
              : 'Synced from Cin7 Core'}
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          {syncMsg && (
            <span style={{ fontSize: '12px', fontFamily: '"JetBrains Mono", monospace', color: syncMsg.type === 'ok' ? '#4ade80' : '#ff1744' }}>
              {syncMsg.text}
            </span>
          )}
          <button
            onClick={handleSync}
            disabled={syncing}
            style={{
              padding: '8px 16px', fontSize: '12px', fontWeight: 500, letterSpacing: '0.04em',
              textTransform: 'uppercase', color: syncing ? '#555' : '#f3ca0f',
              border: `1px solid ${syncing ? '#333' : 'rgba(243,202,15,0.35)'}`,
              background: 'transparent', borderRadius: '6px',
              cursor: syncing ? 'not-allowed' : 'pointer', transition: 'background 150ms',
            }}
            onMouseEnter={e => { if (!syncing) e.currentTarget.style.background = 'rgba(243,202,15,0.08)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
          >
            {syncing ? '↻ Syncing…' : '↻ Sync Cin7'}
          </button>
        </div>
      </div>

      {/* ── Filter toggles ─────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '20px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '10px', fontFamily: '"JetBrains Mono", monospace', color: '#444', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Show:
        </span>
        {ALL_STATUSES.map(s => (
          <FilterToggle key={s} status={s} active={activeFilters.includes(s)} onToggle={toggleFilter} />
        ))}
      </div>

      {/* ── KPI cards ──────────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: '10px', marginBottom: '24px' }}>
        <KpiCard label="Showing"       value={visible.length} />
        <KpiCard label="Overdue"       value={overdue.length} valueStyle={overdue.length > 0 ? { color: '#ff1744' } : {}} />
        <KpiCard label="Due This Week" value={dueSoon.length} valueStyle={dueSoon.length > 0 ? { color: '#f3ca0f' } : {}} />
        <KpiCard label="Order Sent"    value={visible.filter(o => o.has_attachment).length} />
      </div>

      {/* ── Mobile: card list ──────────────────────────────────────────────── */}
      {isMobile ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {visible.length === 0 ? (
            <p style={{ textAlign: 'center', color: '#444', fontSize: '13px', fontFamily: '"JetBrains Mono", monospace', padding: '40px 0' }}>
              No orders match the current filter.
            </p>
          ) : (
            visible.map(po => <PoCard key={po.id} po={po} onSaved={handleDueSaved} />)
          )}
        </div>
      ) : (

      /* ── Desktop: table ──────────────────────────────────────────────────── */
        <div style={{ background: '#0a0a0a', border: '1px solid #1e1e1e', borderRadius: '8px', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-default)' }}>
                {[
                  { label: 'PO #',       key: 'po_number',     align: 'left' },
                  { label: 'Created',     key: 'order_date',    align: 'left' },
                  { label: 'Supplier',    key: 'supplier_name', align: 'left' },
                  { label: 'Status',      key: 'status',        align: 'left' },
                  { label: 'Due Date',    key: 'due_date',      align: 'left' },
                  { label: 'Order Sent',  key: 'has_attachment', align: 'center' },
                ].map(col => {
                  const active = sortCol === col.key
                  return (
                    <th
                      key={col.key}
                      onClick={() => handleSort(col.key)}
                      style={{
                        padding: '10px 14px', textAlign: col.align,
                        fontSize: '10px', fontFamily: 'var(--font-mono)',
                        color: active ? 'var(--accent)' : 'var(--text-disabled)',
                        textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500,
                        cursor: 'pointer', userSelect: 'none', transition: 'color 150ms',
                      }}
                    >
                      {col.label}
                      <ArrowUpDown size={10} strokeWidth={1.5} style={{
                        display: 'inline', marginLeft: 4, verticalAlign: 'middle',
                        opacity: active ? 1 : 0.3,
                      }} />
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: '48px', textAlign: 'center', color: '#444', fontSize: '13px', fontFamily: '"JetBrains Mono", monospace' }}>
                    No orders match the current filter.
                  </td>
                </tr>
              ) : (
                visible.map(po => {
                  const diff = dueDiffDays(po.due_date)
                  const isOverdue = diff !== null && diff < 0
                  const ss = STATUS_STYLE[po.status] ?? STATUS_STYLE.Draft
                  return (
                    <tr
                      key={po.id}
                      style={{ borderBottom: '1px solid #181818', background: isOverdue ? 'rgba(239,68,68,0.04)' : 'transparent', transition: 'background 120ms' }}
                      onMouseEnter={e => { e.currentTarget.style.background = isOverdue ? 'rgba(239,68,68,0.08)' : '#111' }}
                      onMouseLeave={e => { e.currentTarget.style.background = isOverdue ? 'rgba(239,68,68,0.04)' : 'transparent' }}
                    >
                      <td style={{ padding: '11px 14px', fontSize: '13px', fontFamily: '"JetBrains Mono", monospace', fontWeight: 500 }}>
                        <a href={`https://inventory.dearsystems.com/Purchase#${po.cin7_id}`} target="_blank" rel="noopener noreferrer"
                          style={{ color: '#f3ca0f', textDecoration: 'none' }}
                          onMouseEnter={e => { e.currentTarget.style.textDecoration = 'underline' }}
                          onMouseLeave={e => { e.currentTarget.style.textDecoration = 'none' }}>
                          {po.po_number}
                        </a>
                      </td>
                      <td style={{ padding: '11px 14px', fontSize: '12px', color: '#666', fontFamily: '"JetBrains Mono", monospace' }}>
                        {po.order_date ? fmtDate(po.order_date) : '—'}
                      </td>
                      <td style={{ padding: '11px 14px', fontSize: '13px', color: '#AAA' }}>{po.supplier_name}</td>
                      <td style={{ padding: '11px 14px' }}>
                        <span style={{ ...ss, display: 'inline-block', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontFamily: '"JetBrains Mono", monospace' }}>
                          {po.status}
                        </span>
                      </td>
                      <td style={{ padding: '11px 14px', fontSize: '13px' }}>
                        <DueDateCell poId={po.id} due={po.due_date} onSaved={handleDueSaved} />
                      </td>
                      <td style={{ padding: '11px 14px', textAlign: 'center' }}>
                        {po.has_attachment && <CheckCircle2 size={16} strokeWidth={1.5} style={{ color: 'var(--status-success)' }} />}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
