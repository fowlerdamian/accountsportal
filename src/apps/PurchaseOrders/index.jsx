import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../../lib/supabase.js'

// ─── Constants ────────────────────────────────────────────────────────────────

const ACTIVE_STATUSES = ['Draft', 'Ordered']

const STATUS_STYLE = {
  Draft:      { color: '#555',    background: '#111',                  border: '1px solid #2a2a2a' },
  Authorised: { color: '#60a5fa', background: 'rgba(96,165,250,0.1)',  border: '1px solid rgba(96,165,250,0.3)' },
  Ordered:    { color: '#a78bfa', background: 'rgba(167,139,250,0.1)', border: '1px solid rgba(167,139,250,0.3)' },
  Receiving:  { color: '#E8A838', background: 'rgba(232,168,56,0.1)',  border: '1px solid rgba(232,168,56,0.3)' },
  Received:   { color: '#4ade80', background: 'rgba(74,222,128,0.1)',  border: '1px solid rgba(74,222,128,0.3)' },
  Cancelled:  { color: '#888',    background: '#111',                  border: '1px solid #222' },
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function aud(n) {
  return n == null ? '—' : new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(n)
}

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
  if (diff < 0)  return <span style={{ color: '#EF4444', fontWeight: 500 }}>{label} <span style={{ fontSize: '11px', fontFamily: '"JetBrains Mono", monospace' }}>({Math.abs(diff)}d overdue)</span></span>
  if (diff <= 7) return <span style={{ color: '#E8A838', fontWeight: 500 }}>{label} <span style={{ fontSize: '11px', fontFamily: '"JetBrains Mono", monospace' }}>({diff}d)</span></span>
  return <span style={{ color: '#AAA' }}>{label}</span>
}

// ─── Inline editable due date ─────────────────────────────────────────────────

function DueDateCell({ poId, due, onSaved }) {
  const [editing, setEditing] = useState(false)
  const [value,   setValue]   = useState(due ?? '')
  const [saving,  setSaving]  = useState(false)

  async function save(newVal) {
    setSaving(true)
    const { error } = await supabase
      .from('purchase_orders')
      .update({ due_date: newVal || null })
      .eq('id', poId)
    setSaving(false)
    if (!error) onSaved(poId, newVal || null)
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
          background: '#1a1a1a', border: '1px solid rgba(232,168,56,0.5)',
          borderRadius: '4px', color: '#E5E5E5', fontSize: '13px',
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
    <div style={{ background: '#0c0c0c', border: '1px solid #1e1e1e', borderRadius: '8px', padding: '16px' }}>
      <p style={{ fontSize: '10px', fontFamily: '"JetBrains Mono", monospace', color: '#555', textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>
        {label}
      </p>
      <p style={{ fontSize: '20px', fontWeight: 600, color: '#E5E5E5', margin: '6px 0 0', ...valueStyle }}>
        {value}
      </p>
    </div>
  )
}

// ─── Mobile card ──────────────────────────────────────────────────────────────

function PoCard({ po, onSaved }) {
  const diff = dueDiffDays(po.due_date)
  const isOverdue = diff !== null && diff < 0
  const ss = STATUS_STYLE[po.status] ?? STATUS_STYLE.Draft

  return (
    <div style={{
      background: isOverdue ? 'rgba(239,68,68,0.04)' : '#0c0c0c',
      border: `1px solid ${isOverdue ? 'rgba(239,68,68,0.2)' : '#1e1e1e'}`,
      borderRadius: '8px', padding: '14px 16px',
      display: 'flex', flexDirection: 'column', gap: '10px',
    }}>
      {/* Row 1: PO # + status + order sent */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
        <a
          href={`https://inventory.dearsystems.com/Purchase#${po.cin7_id}`}
          target="_blank" rel="noopener noreferrer"
          style={{ color: '#E8A838', textDecoration: 'none', fontSize: '14px', fontFamily: '"JetBrains Mono", monospace', fontWeight: 600 }}
        >
          {po.po_number}
        </a>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ ...ss, display: 'inline-block', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontFamily: '"JetBrains Mono", monospace' }}>
            {po.status}
          </span>
          {po.has_attachment && (
            <span title="Order sent" style={{ color: '#4ade80', fontSize: '15px' }}>✓</span>
          )}
        </div>
      </div>

      {/* Row 2: supplier + created date */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
        <p style={{ margin: 0, fontSize: '13px', color: '#AAA' }}>{po.supplier_name}</p>
        {po.order_date && (
          <span style={{ fontSize: '11px', fontFamily: '"JetBrains Mono", monospace', color: '#555' }}>
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
  const [orders,   setOrders]   = useState([])
  const [loading,  setLoading]  = useState(true)
  const [syncing,  setSyncing]  = useState(false)
  const [syncMsg,  setSyncMsg]  = useState(null)
  const [lastSync, setLastSync] = useState(null)
  const isMobile = useIsMobile()

  const fetchOrders = useCallback(async () => {
    const { data, error } = await supabase
      .from('purchase_orders')
      .select('*')
      .in('status', ACTIVE_STATUSES)
      .order('due_date', { ascending: true, nullsFirst: false })
    if (!error && data) {
      setOrders(data)
      if (data.length > 0) setLastSync(data[0].synced_at)
    }
    setLoading(false)
  }, [])

  useEffect(() => { fetchOrders() }, [fetchOrders])

  function handleDueSaved(poId, newDate) {
    setOrders(prev => prev.map(o => o.id === poId ? { ...o, due_date: newDate } : o))
  }

  async function handleSync() {
    setSyncing(true)
    setSyncMsg(null)
    try {
      const { data, error } = await supabase.functions.invoke('sync-cin7-pos')
      if (error) {
        let detail = error.message ?? 'Unknown error'
        try { const body = await error.context?.json?.(); detail = JSON.stringify(body) } catch {}
        throw new Error(detail)
      }
      setSyncMsg({ type: 'ok', text: `${data?.synced ?? 0} orders updated` })
      await fetchOrders()
    } catch (err) {
      setSyncMsg({ type: 'err', text: err.message ?? 'Sync failed' })
    } finally {
      setSyncing(false)
    }
  }

  const overdue    = orders.filter(o => { const d = dueDiffDays(o.due_date); return d !== null && d < 0 })
  const dueSoon    = orders.filter(o => { const d = dueDiffDays(o.due_date); return d !== null && d >= 0 && d <= 7 })
  const totalValue = orders.reduce((s, o) => s + (o.total_amount ?? 0), 0)

  if (loading) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 28, height: 28, borderRadius: '50%', border: '2px solid #E8A838', borderTopColor: 'transparent', animation: 'spin 0.7s linear infinite' }} />
      </div>
    )
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '20px 16px' : '32px 24px', maxWidth: '1200px', margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ fontSize: '18px', fontWeight: 600, color: '#E5E5E5', margin: 0, letterSpacing: '-0.01em' }}>
            Purchase Orders
          </h1>
          <p style={{ fontSize: '12px', color: '#555', margin: '4px 0 0', fontFamily: '"JetBrains Mono", monospace' }}>
            {lastSync
              ? `Synced ${new Date(lastSync).toLocaleString('en-AU', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}`
              : 'Synced from Cin7 Core'}
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          {syncMsg && (
            <span style={{ fontSize: '12px', fontFamily: '"JetBrains Mono", monospace', color: syncMsg.type === 'ok' ? '#4ade80' : '#EF4444' }}>
              {syncMsg.text}
            </span>
          )}
          <button
            onClick={handleSync}
            disabled={syncing}
            style={{
              padding: '8px 16px', fontSize: '12px', fontWeight: 500, letterSpacing: '0.04em',
              textTransform: 'uppercase', color: syncing ? '#555' : '#E8A838',
              border: `1px solid ${syncing ? '#333' : 'rgba(232,168,56,0.35)'}`,
              background: 'transparent', borderRadius: '6px',
              cursor: syncing ? 'not-allowed' : 'pointer', transition: 'background 150ms',
            }}
            onMouseEnter={e => { if (!syncing) e.currentTarget.style.background = 'rgba(232,168,56,0.08)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
          >
            {syncing ? '↻ Syncing…' : '↻ Sync Cin7'}
          </button>
        </div>
      </div>

      {/* ── KPI cards ──────────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: '10px', marginBottom: '24px' }}>
        <KpiCard label="Open POs"      value={orders.length} />
        <KpiCard label="Overdue"       value={overdue.length}  valueStyle={overdue.length  > 0 ? { color: '#EF4444' } : {}} />
        <KpiCard label="Due This Week" value={dueSoon.length}  valueStyle={dueSoon.length  > 0 ? { color: '#E8A838' } : {}} />
        <KpiCard label="Order Sent"    value={orders.filter(o => o.has_attachment).length} />
      </div>

      {/* ── Mobile: card list ──────────────────────────────────────────────── */}
      {isMobile ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {orders.length === 0 ? (
            <p style={{ textAlign: 'center', color: '#444', fontSize: '13px', fontFamily: '"JetBrains Mono", monospace', padding: '40px 0' }}>
              No open POs. Tap <strong style={{ color: '#666' }}>Sync Cin7</strong>.
            </p>
          ) : (
            orders.map(po => <PoCard key={po.id} po={po} onSaved={handleDueSaved} />)
          )}
        </div>
      ) : (

      /* ── Desktop: table ──────────────────────────────────────────────────── */
        <div style={{ background: '#0c0c0c', border: '1px solid #1e1e1e', borderRadius: '8px', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #1e1e1e' }}>
                {[['PO #', 'left'], ['Created', 'left'], ['Supplier', 'left'], ['Status', 'left'], ['Due Date', 'left'], ['Order Sent', 'center']].map(([h, align]) => (
                  <th key={h} style={{ padding: '10px 14px', textAlign: align, fontSize: '10px', fontFamily: '"JetBrains Mono", monospace', color: '#444', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500 }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {orders.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: '48px', textAlign: 'center', color: '#444', fontSize: '13px', fontFamily: '"JetBrains Mono", monospace' }}>
                    No open purchase orders. Click <strong style={{ color: '#666' }}>Sync Cin7</strong> to pull the latest data.
                  </td>
                </tr>
              ) : (
                orders.map(po => {
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
                          style={{ color: '#E8A838', textDecoration: 'none' }}
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
                        {po.has_attachment && <span title="Order sent" style={{ color: '#4ade80', fontSize: '15px' }}>✓</span>}
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
