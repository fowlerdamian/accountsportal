import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@portal/lib/supabase'
import LogisticsNav from './LogisticsNav.jsx'
import { aud, fmtDate, invoiceTotal, invoiceOvercharge } from '../utils/helpers.js'
import { pageWrap, card, mono, sectionLabel, thStyle, tdStyle, Badge, Spinner, INVOICE_STATUS_STYLE, PageHeader, rowHover } from '../utils/ui.jsx'

function KpiCard({ label, value, valueStyle }) {
  return (
    <div style={{ ...card, padding: '20px' }}>
      <p style={{ fontSize: '11px', fontFamily: mono, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>
        {label}
      </p>
      <p style={{ fontSize: '22px', fontWeight: 600, color: 'var(--text-primary)', margin: '8px 0 0', ...valueStyle }}>
        {value}
      </p>
    </div>
  )
}

export default function LogisticsDashboard() {
  const [invoices, setInvoices] = useState([])
  const [disputes, setDisputes] = useState([])
  const [loading,  setLoading]  = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    Promise.all([
      supabase.from('freight_invoices').select('*, carriers(*), freight_invoice_lines(*)').order('invoice_date', { ascending: false }),
      supabase.from('disputes').select('status, amount_claimed, amount_recovered'),
    ]).then(([invRes, dispRes]) => {
      if (invRes.data)  setInvoices(invRes.data)
      if (dispRes.data) setDisputes(dispRes.data)
    }).finally(() => setLoading(false))
  }, [])

  if (loading) return <Spinner />

  const allLines   = invoices.flatMap(inv => inv.freight_invoice_lines ?? [])
  const totalInv   = invoiceTotal(allLines)
  const totalOver  = invoices.reduce((s, inv) => s + invoiceOvercharge(inv.freight_invoice_lines ?? []), 0)
  const recovered  = disputes.reduce((s, d) => s + Number(d.amount_recovered ?? 0), 0)
  const openDisp   = disputes.filter(d => ['draft', 'sent', 'acknowledged'].includes(d.status)).length
  const needAction = invoices.filter(inv => inv.status === 'pending' || inv.status === 'flagged').length
  const recent     = invoices.slice(0, 5)

  return (
    <div style={pageWrap}>
      <PageHeader title="Logistics" subtitle="Freight invoice management and carrier reconciliation" />
      <LogisticsNav />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px', marginBottom: '32px' }}>
        <KpiCard label="Total Invoiced"        value={aud(totalInv)} />
        <KpiCard label="Overcharge Identified" value={aud(totalOver)} valueStyle={totalOver > 0 ? { color: 'var(--brand-pink)' } : {}} />
        <KpiCard label="Recovered"             value={aud(recovered)} valueStyle={recovered > 0 ? { color: 'var(--brand-aqua)' } : {}} />
        <KpiCard label="Open Disputes"         value={openDisp}      valueStyle={openDisp > 0   ? { color: 'var(--brand-pink)' } : {}} />
        <KpiCard label="Need Action"           value={needAction}    valueStyle={needAction > 0 ? { color: 'var(--brand-accent)' } : {}} />
      </div>

      <p style={sectionLabel}>Recent invoices</p>

      <div style={{ ...card, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              {['Invoice #', 'Carrier', 'Date', 'Charged', 'Overcharge', 'Status'].map(h => (
                <th key={h} style={thStyle(h === 'Charged' || h === 'Overcharge')}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {recent.map(inv => {
              const lines = inv.freight_invoice_lines ?? []
              const over  = invoiceOvercharge(lines)
              const total = invoiceTotal(lines)
              return (
                <tr
                  key={inv.id}
                  onClick={() => navigate(`/logistics/invoices/${inv.id}`)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/logistics/invoices/${inv.id}`) } }}
                  tabIndex={0}
                  role="button"
                  aria-label={`Invoice ${inv.invoice_ref}`}
                  style={{ borderBottom: '1px solid var(--border-subtle)', cursor: 'pointer', transition: 'background 120ms', outline: 'none' }}
                  {...rowHover}
                  onFocus={e => e.currentTarget.style.background = 'var(--bg-hover)'}
                  onBlur={e => e.currentTarget.style.background = 'transparent'}
                >
                  <td style={{ ...tdStyle, color: 'var(--text-primary)', fontWeight: 500 }}>{inv.invoice_ref}</td>
                  <td style={{ ...tdStyle, color: 'var(--text-secondary)' }}>{inv.carriers?.name ?? '—'}</td>
                  <td style={{ ...tdStyle, fontSize: '12px', fontFamily: mono, color: 'var(--text-tertiary)' }}>{fmtDate(inv.invoice_date)}</td>
                  <td style={{ ...tdStyle, color: 'var(--text-primary)', textAlign: 'right' }}>{aud(total)}</td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>
                    {over > 0
                      ? <span style={{ color: 'var(--brand-pink)', fontWeight: 500 }}>{aud(over)}</span>
                      : <span style={{ color: 'var(--text-disabled)' }}>—</span>}
                  </td>
                  <td style={tdStyle}><Badge map={INVOICE_STATUS_STYLE} value={inv.status} /></td>
                </tr>
              )
            })}
            {recent.length === 0 && (
              <tr><td colSpan={6} style={{ padding: '32px', textAlign: 'center', color: 'var(--text-disabled)', fontSize: '13px', fontFamily: mono }}>No invoices yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
