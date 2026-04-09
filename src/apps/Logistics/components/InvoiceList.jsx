import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../../lib/supabase.js'
import LogisticsNav from './LogisticsNav.jsx'
import { aud, invoiceTotal, invoiceOvercharge } from '../utils/helpers.js'

const STATUS_STYLE = {
  pending:  { color: '#888',    background: '#1a1a1a',              border: '1px solid #222222' },
  flagged:  { color: '#f3ca0f', background: 'rgba(243,202,15,0.1)', border: '1px solid rgba(243,202,15,0.3)' },
  disputed: { color: '#ff1744', background: 'rgba(239,68,68,0.1)',  border: '1px solid rgba(239,68,68,0.3)'  },
  approved: { color: '#4ade80', background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.3)' },
  resolved: { color: '#60a5fa', background: 'rgba(96,165,250,0.1)', border: '1px solid rgba(96,165,250,0.3)' },
}

const ALL_STATUSES = ['pending', 'flagged', 'disputed', 'approved', 'resolved']

function SelectFilter({ label, value, onChange, options }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      style={{
        background: '#0a0a0a', border: '1px solid #222222', borderRadius: '6px',
        color: '#AAA', fontSize: '12px', fontFamily: '"JetBrains Mono", monospace',
        padding: '6px 10px', cursor: 'pointer', outline: 'none',
      }}
    >
      <option value="all">{label}</option>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

export default function InvoiceList() {
  const [invoices,      setInvoices]      = useState([])
  const [carriers,      setCarriers]      = useState([])
  const [statusFilter,  setStatusFilter]  = useState('all')
  const [carrierFilter, setCarrierFilter] = useState('all')
  const [loading,       setLoading]       = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    Promise.all([
      supabase.from('freight_invoices').select('*, carriers(*), freight_invoice_lines(*)').order('invoice_date', { ascending: false }),
      supabase.from('carriers').select('*').order('name'),
    ]).then(([invRes, carRes]) => {
      if (invRes.data) setInvoices(invRes.data)
      if (carRes.data) setCarriers(carRes.data)
      setLoading(false)
    })
  }, [])

  const filtered = invoices.filter(inv => {
    if (statusFilter  !== 'all' && inv.status      !== statusFilter)  return false
    if (carrierFilter !== 'all' && inv.carrier_id  !== carrierFilter) return false
    return true
  })

  if (loading) {
    return (
      <div className="flex items-center justify-center" style={{ flex: 1 }}>
        <div className="w-7 h-7 rounded-full border-2 animate-spin" style={{ borderColor: '#f3ca0f', borderTopColor: 'transparent' }} />
      </div>
    )
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '32px 24px', maxWidth: '1200px', margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>

      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '18px', fontWeight: 600, color: '#ffffff', margin: 0 }}>Invoices</h1>
        <p style={{ fontSize: '13px', color: '#a0a0a0', margin: '4px 0 0', fontFamily: '"JetBrains Mono", monospace' }}>All carrier freight invoices</p>
      </div>

      <LogisticsNav />

      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap' }}>
        <SelectFilter
          label="All statuses"
          value={statusFilter}
          onChange={setStatusFilter}
          options={ALL_STATUSES.map(s => ({ value: s, label: s.charAt(0).toUpperCase() + s.slice(1) }))}
        />
        <SelectFilter
          label="All carriers"
          value={carrierFilter}
          onChange={setCarrierFilter}
          options={carriers.map(c => ({ value: c.id, label: c.name }))}
        />
        <span style={{ marginLeft: 'auto', fontSize: '11px', fontFamily: '"JetBrains Mono", monospace', color: '#444' }}>
          {filtered.length} invoice{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div style={{ background: '#0a0a0a', border: '1px solid #1e1e1e', borderRadius: '8px', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #1e1e1e' }}>
              {['Invoice #', 'Carrier', 'Date', 'Due', 'Charged', 'Overcharge', 'Status', ''].map((h, i) => (
                <th key={i} style={{ padding: '10px 14px', textAlign: ['Charged', 'Overcharge'].includes(h) ? 'right' : 'left', fontSize: '10px', fontFamily: '"JetBrains Mono", monospace', color: '#444', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500 }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(inv => {
              const lines = inv.freight_invoice_lines ?? []
              const over  = invoiceOvercharge(lines)
              const total = invoiceTotal(lines)
              const ss    = STATUS_STYLE[inv.status] ?? STATUS_STYLE.pending
              return (
                <tr
                  key={inv.id}
                  onClick={() => navigate(`/apps/logistics/invoices/${inv.id}`)}
                  style={{ borderBottom: '1px solid #181818', cursor: 'pointer', transition: 'background 120ms' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#0a0a0a'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <td style={{ padding: '11px 14px', fontSize: '13px', color: '#ffffff', fontWeight: 500 }}>{inv.invoice_ref}</td>
                  <td style={{ padding: '11px 14px', fontSize: '13px', color: '#AAA' }}>{inv.carriers?.name ?? '—'}</td>
                  <td style={{ padding: '11px 14px', fontSize: '12px', fontFamily: '"JetBrains Mono", monospace', color: '#666' }}>{new Date(inv.invoice_date).toLocaleDateString('en-AU')}</td>
                  <td style={{ padding: '11px 14px', fontSize: '12px', fontFamily: '"JetBrains Mono", monospace', color: '#a0a0a0' }}>{inv.due_date ? new Date(inv.due_date).toLocaleDateString('en-AU') : '—'}</td>
                  <td style={{ padding: '11px 14px', fontSize: '13px', color: '#ffffff', textAlign: 'right' }}>{aud(total)}</td>
                  <td style={{ padding: '11px 14px', fontSize: '13px', textAlign: 'right' }}>
                    {over > 0
                      ? <span style={{ color: '#ff1744', fontWeight: 500 }}>{aud(over)}</span>
                      : <span style={{ color: '#444' }}>—</span>}
                  </td>
                  <td style={{ padding: '11px 14px' }}>
                    <span style={{ ...ss, display: 'inline-block', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontFamily: '"JetBrains Mono", monospace', textTransform: 'capitalize' }}>
                      {inv.status}
                    </span>
                  </td>
                  <td style={{ padding: '11px 14px', color: '#333', fontSize: '14px' }}>›</td>
                </tr>
              )
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={8} style={{ padding: '32px', textAlign: 'center', color: '#444', fontSize: '13px', fontFamily: '"JetBrains Mono", monospace' }}>No invoices match the selected filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
