import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../../lib/supabase.js'
import LogisticsNav from './LogisticsNav.jsx'
import { aud, invoiceTotal, invoiceOvercharge } from '../utils/helpers.js'

const STATUS_STYLE = {
  pending:  { color: '#888',    background: '#1a1a1a',              border: '1px solid #2a2a2a' },
  flagged:  { color: '#E8A838', background: 'rgba(232,168,56,0.1)', border: '1px solid rgba(232,168,56,0.3)' },
  disputed: { color: '#EF4444', background: 'rgba(239,68,68,0.1)',  border: '1px solid rgba(239,68,68,0.3)'  },
  approved: { color: '#4ade80', background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.3)' },
  resolved: { color: '#60a5fa', background: 'rgba(96,165,250,0.1)', border: '1px solid rgba(96,165,250,0.3)' },
}

function KpiCard({ label, value, valueStyle }) {
  return (
    <div style={{ background: '#0c0c0c', border: '1px solid #1e1e1e', borderRadius: '8px', padding: '20px' }}>
      <p style={{ fontSize: '11px', fontFamily: '"JetBrains Mono", monospace', color: '#555', textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>
        {label}
      </p>
      <p style={{ fontSize: '22px', fontWeight: 600, color: '#E5E5E5', margin: '8px 0 0', ...valueStyle }}>
        {value}
      </p>
    </div>
  )
}

export default function LogisticsDashboard() {
  const [invoices, setInvoices] = useState([])
  const [loading,  setLoading]  = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    supabase
      .from('freight_invoices')
      .select('*, carriers(*), freight_invoice_lines(*)')
      .order('invoice_date', { ascending: false })
      .then(({ data, error }) => {
        if (!error && data) setInvoices(data)
        setLoading(false)
      })
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center" style={{ flex: 1 }}>
        <div className="w-7 h-7 rounded-full border-2 animate-spin" style={{ borderColor: '#E8A838', borderTopColor: 'transparent' }} />
      </div>
    )
  }

  const allLines    = invoices.flatMap(inv => inv.freight_invoice_lines ?? [])
  const totalInv    = invoiceTotal(allLines)
  const totalOver   = invoices.reduce((s, inv) => s + invoiceOvercharge(inv.freight_invoice_lines ?? []), 0)
  const openDisp    = invoices.filter(inv => inv.status === 'disputed').length
  const needAction  = invoices.filter(inv => inv.status === 'pending' || inv.status === 'flagged').length
  const recent      = invoices.slice(0, 5)

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '32px 24px', maxWidth: '1200px', margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>

      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '18px', fontWeight: 600, color: '#E5E5E5', margin: 0, letterSpacing: '-0.01em' }}>
          Logistics
        </h1>
        <p style={{ fontSize: '13px', color: '#555', margin: '4px 0 0', fontFamily: '"JetBrains Mono", monospace' }}>
          Freight invoice management and carrier reconciliation
        </p>
      </div>

      <LogisticsNav />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '12px', marginBottom: '32px' }}>
        <KpiCard label="Total Invoiced"    value={aud(totalInv)} />
        <KpiCard label="Total Overcharged" value={aud(totalOver)} valueStyle={totalOver > 0 ? { color: '#EF4444' } : {}} />
        <KpiCard label="Open Disputes"     value={openDisp}      valueStyle={openDisp > 0   ? { color: '#EF4444' } : {}} />
        <KpiCard label="Need Action"       value={needAction}    valueStyle={needAction > 0  ? { color: '#E8A838' } : {}} />
      </div>

      <p style={{ fontSize: '11px', fontFamily: '"JetBrains Mono", monospace', color: '#555', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '12px' }}>
        Recent invoices
      </p>

      <div style={{ background: '#0c0c0c', border: '1px solid #1e1e1e', borderRadius: '8px', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #1e1e1e' }}>
              {['Invoice #', 'Carrier', 'Date', 'Charged', 'Overcharge', 'Status'].map(h => (
                <th key={h} style={{ padding: '10px 14px', textAlign: h === 'Charged' || h === 'Overcharge' ? 'right' : 'left', fontSize: '10px', fontFamily: '"JetBrains Mono", monospace', color: '#444', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500 }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {recent.map(inv => {
              const lines = inv.freight_invoice_lines ?? []
              const over  = invoiceOvercharge(lines)
              const total = invoiceTotal(lines)
              const ss    = STATUS_STYLE[inv.status] ?? STATUS_STYLE.pending
              return (
                <tr
                  key={inv.id}
                  onClick={() => navigate(`/apps/logistics/invoices/${inv.id}`)}
                  style={{ borderBottom: '1px solid #181818', cursor: 'pointer', transition: 'background 120ms' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#111'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <td style={{ padding: '11px 14px', fontSize: '13px', color: '#E5E5E5', fontWeight: 500 }}>{inv.invoice_ref}</td>
                  <td style={{ padding: '11px 14px', fontSize: '13px', color: '#AAA' }}>{inv.carriers?.name ?? '—'}</td>
                  <td style={{ padding: '11px 14px', fontSize: '12px', fontFamily: '"JetBrains Mono", monospace', color: '#666' }}>{new Date(inv.invoice_date).toLocaleDateString('en-AU')}</td>
                  <td style={{ padding: '11px 14px', fontSize: '13px', color: '#E5E5E5', textAlign: 'right' }}>{aud(total)}</td>
                  <td style={{ padding: '11px 14px', fontSize: '13px', textAlign: 'right' }}>
                    {over > 0
                      ? <span style={{ color: '#EF4444', fontWeight: 500 }}>{aud(over)}</span>
                      : <span style={{ color: '#444' }}>—</span>}
                  </td>
                  <td style={{ padding: '11px 14px' }}>
                    <span style={{ ...ss, display: 'inline-block', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontFamily: '"JetBrains Mono", monospace', textTransform: 'capitalize' }}>
                      {inv.status}
                    </span>
                  </td>
                </tr>
              )
            })}
            {recent.length === 0 && (
              <tr><td colSpan={6} style={{ padding: '32px', textAlign: 'center', color: '#444', fontSize: '13px', fontFamily: '"JetBrains Mono", monospace' }}>No invoices yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
