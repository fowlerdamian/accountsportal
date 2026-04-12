import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@portal/lib/supabase'
import LogisticsNav from './LogisticsNav.jsx'
import { aud, invoiceOvercharge } from '../utils/helpers.js'

const STATUS_STYLE = {
  flagged:  { color: '#f3ca0f', background: 'rgba(243,202,15,0.1)', border: '1px solid rgba(243,202,15,0.3)' },
  disputed: { color: '#ff1744', background: 'rgba(239,68,68,0.1)',  border: '1px solid rgba(239,68,68,0.3)'  },
}

export default function Disputes() {
  const [invoices, setInvoices] = useState([])
  const [loading,  setLoading]  = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    supabase
      .from('freight_invoices')
      .select('*, carriers(*), freight_invoice_lines(*)')
      .in('status', ['flagged', 'disputed'])
      .order('invoice_date', { ascending: false })
      .then(({ data, error }) => {
        if (!error && data) setInvoices(data)
        setLoading(false)
      })
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center" style={{ flex: 1 }}>
        <div className="w-7 h-7 rounded-full border-2 animate-spin" style={{ borderColor: '#f3ca0f', borderTopColor: 'transparent' }} />
      </div>
    )
  }

  const totalOver = invoices.reduce((s, inv) => s + invoiceOvercharge(inv.freight_invoice_lines ?? []), 0)

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '32px 24px', maxWidth: '1200px', margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>

      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '18px', fontWeight: 600, color: '#ffffff', margin: 0 }}>Disputes</h1>
        <p style={{ fontSize: '13px', color: '#a0a0a0', margin: '4px 0 0', fontFamily: '"JetBrains Mono", monospace' }}>Flagged and disputed invoices requiring attention</p>
      </div>

      <LogisticsNav />

      {invoices.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', padding: '12px 16px', borderRadius: '8px', marginBottom: '20px', background: 'rgba(243,202,15,0.06)', border: '1px solid rgba(243,202,15,0.25)' }}>
          <span style={{ color: '#f3ca0f', fontSize: '14px', flexShrink: 0, marginTop: '1px' }}>!</span>
          <p style={{ margin: 0, fontSize: '13px', color: '#f3ca0f' }}>
            <span style={{ fontWeight: 600 }}>{invoices.length} invoice{invoices.length !== 1 ? 's' : ''} in dispute</span>
            {totalOver > 0 && <> · <span style={{ fontWeight: 600 }}>{aud(totalOver)}</span> total overcharge</>}
          </p>
        </div>
      )}

      <div style={{ background: '#0a0a0a', border: '1px solid #1e1e1e', borderRadius: '8px', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #1e1e1e' }}>
              {['Invoice #', 'Carrier', 'Status', 'Overcharge', 'Notes', ''].map((h, i) => (
                <th key={i} style={{ padding: '10px 14px', textAlign: h === 'Overcharge' ? 'right' : 'left', fontSize: '10px', fontFamily: '"JetBrains Mono", monospace', color: '#444', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {invoices.map(inv => {
              const lines = inv.freight_invoice_lines ?? []
              const over  = invoiceOvercharge(lines)
              const ss    = STATUS_STYLE[inv.status] ?? STATUS_STYLE.flagged
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
                  <td style={{ padding: '11px 14px' }}>
                    <span style={{ ...ss, display: 'inline-block', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontFamily: '"JetBrains Mono", monospace', textTransform: 'capitalize' }}>
                      {inv.status}
                    </span>
                  </td>
                  <td style={{ padding: '11px 14px', fontSize: '13px', textAlign: 'right' }}>
                    {over > 0
                      ? <span style={{ color: '#ff1744', fontWeight: 500 }}>{aud(over)}</span>
                      : <span style={{ color: '#444' }}>—</span>}
                  </td>
                  <td style={{ padding: '11px 14px', fontSize: '12px', color: '#a0a0a0', fontFamily: '"JetBrains Mono", monospace', maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {inv.notes || '—'}
                  </td>
                  <td style={{ padding: '11px 14px', color: '#333', fontSize: '14px' }}>›</td>
                </tr>
              )
            })}
            {invoices.length === 0 && (
              <tr><td colSpan={6} style={{ padding: '32px', textAlign: 'center', color: '#444', fontSize: '13px', fontFamily: '"JetBrains Mono", monospace' }}>No open disputes — all clear</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
