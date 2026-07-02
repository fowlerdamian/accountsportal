import { useEffect, useState } from 'react'
import { supabase } from '@portal/lib/supabase'
import { aud } from '../utils/helpers.js'
import { mono, btnGhost, FieldLabel, inputStyle } from '../utils/ui.jsx'

// TNT lodges invoice disputes via its public invoice-query form — ONE
// SUBMISSION PER QUERY (per disputed con-note line), not per invoice. This
// panel builds a query per disputed line and submits them through the
// logistics-submit-tnt-query edge function, tracking progress per line.

const CONTACT_KEY = 'logistics_tnt_contact'

// Build the query list from the invoice's disputed lines
export function buildTntQueries(lines) {
  const queries = []
  for (const l of lines ?? []) {
    const variance = l.expected_total != null ? l.charged_total - l.expected_total : null
    if (l.fee_check === 'mhp_unjustified') {
      queries.push({
        line: l,
        type: 'Price discrepancy',
        info: `Manual Handling Processing Fee of ${aud(l.charged_total)} has been charged on con note ${l.tracking_ref}. Our dispatch records show this item measures ${l.actual_dims ?? 'within published parameters'} and weighs ${l.actual_weight_kg != null ? `${(l.actual_weight_kg * 1000).toFixed(0)} g` : 'within published parameters'} — inside TNT's published sortation-compatibility parameters (Length 200-1200mm, Width 100-600mm, Height 15-800mm, diagonal up to 1200mm, weight 250g-30kg). Per TNT's published MHP terms the fee does not apply. Please reverse the ${aud(l.charged_total)} charge.`,
      })
    } else if (l.weight_check === 'overbilled') {
      queries.push({
        line: l,
        type: 'Weight discrepancy',
        info: `Con note ${l.tracking_ref} was billed at ${l.weight_kg} kg, but the consignment as tendered is ${l.chargeable_weight_kg} kg chargeable (${l.actual_dims ?? 'dims on file'}, ${l.actual_weight_kg} kg dead weight). Please re-rate the consignment accordingly${variance != null && variance > 0 ? ` and credit the difference of ${aud(variance)}` : ''}.`,
      })
    } else if (variance != null && variance > 0.02 && l.expected_source === 'shipstation' && l.booked_cost != null) {
      queries.push({
        line: l,
        type: 'Price discrepancy',
        info: `Con note ${l.tracking_ref} was charged ${aud(l.charged_total)} against a booked/quoted price of ${aud(l.booked_cost)} at dispatch. Please credit the difference of ${aud(variance)}.`,
      })
    }
  }
  return queries
}

export default function TntQueryPanel({ open, onClose, invoice, dispute, onChange }) {
  const saved = (() => { try { return JSON.parse(localStorage.getItem(CONTACT_KEY)) ?? {} } catch { return {} } })()
  const [name,  setName]  = useState(saved.name ?? '')
  const [phone, setPhone] = useState(saved.phone ?? '')
  const [email, setEmail] = useState('')
  const [queries, setQueries] = useState([])
  const [busyId,  setBusyId]  = useState(null)   // line id being submitted, or 'all'
  const [errors,  setErrors]  = useState({})     // line id → message

  useEffect(() => {
    if (!open) return
    supabase.auth.getUser().then(({ data }) => { if (data?.user?.email) setEmail(e => e || data.user.email) })
    setQueries(buildTntQueries(invoice?.freight_invoice_lines).map(q => ({
      ...q,
      submitted: !!q.line.query_submitted_at,
      info: q.info,
    })))
    setErrors({})
  }, [open, invoice])

  if (!invoice) return null
  const accountNumber = invoice.carriers?.account_number ?? ''
  const contactOk = name.trim() && phone.trim() && email.trim() && accountNumber

  const submitOne = async (q) => {
    localStorage.setItem(CONTACT_KEY, JSON.stringify({ name, phone }))
    setBusyId(q.line.id)
    setErrors(prev => ({ ...prev, [q.line.id]: null }))
    const { data, error } = await supabase.functions.invoke('logistics-submit-tnt-query', {
      body: {
        name, company: 'Automotive Group Australia', phone, email,
        account_number: accountNumber,
        invoice_number: invoice.invoice_ref,
        con_note: q.line.tracking_ref,
        query_type: q.type,
        info: q.info,
        line_id: q.line.id,
        dispute_id: dispute?.id ?? null,
      },
    })
    setBusyId(null)
    if (error || data?.error) {
      setErrors(prev => ({ ...prev, [q.line.id]: data?.error ?? error.message }))
      return false
    }
    setQueries(prev => {
      const next = prev.map(x => x.line.id === q.line.id ? { ...x, submitted: true } : x)
      // All lodged → move the dispute to 'sent'
      if (dispute && next.every(x => x.submitted)) {
        supabase.from('disputes').update({ status: 'sent', sent_to: 'TNT invoice query form', sent_at: new Date().toISOString() })
          .eq('id', dispute.id).then(() => onChange?.())
      }
      return next
    })
    onChange?.()
    return true
  }

  const submitAll = async () => {
    setBusyId('all')
    for (const q of queries.filter(x => !x.submitted)) {
      const ok = await submitOne(q)
      if (!ok) break
    }
    setBusyId(null)
  }

  const remaining = queries.filter(q => !q.submitted).length

  return (
    <>
      {open && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 40 }} onClick={() => { if (!busyId) onClose() }} />
      )}
      <div
        style={{
          position: 'fixed', right: 0, top: 0, height: '100%', width: '560px', maxWidth: '100vw',
          background: 'var(--bg-elevated)', borderLeft: '1px solid var(--border-default)',
          transform: open ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 220ms ease',
          zIndex: 50, display: 'flex', flexDirection: 'column', boxSizing: 'border-box',
        }}
      >
        {open && (
          <>
            <div style={{ padding: '20px 24px 14px', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
                <p style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                  TNT invoice queries — {invoice.invoice_ref}
                </p>
                <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '18px', lineHeight: 1, padding: 0 }}>×</button>
              </div>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '4px 0 0', fontFamily: mono }}>
                Lodged via TNT's invoice query form — one submission per con note query
              </p>
            </div>

            <div style={{ flex: 1, padding: '16px 24px', overflowY: 'auto' }}>
              {/* Contact details (sent with every query) */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '8px' }}>
                <div>
                  <FieldLabel>Name</FieldLabel>
                  <input value={name} onChange={e => setName(e.target.value)} placeholder="Your name" style={inputStyle} />
                </div>
                <div>
                  <FieldLabel>Phone</FieldLabel>
                  <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="Phone number" style={inputStyle} />
                </div>
                <div>
                  <FieldLabel>Email</FieldLabel>
                  <input value={email} onChange={e => setEmail(e.target.value)} style={inputStyle} />
                </div>
                <div>
                  <FieldLabel>TNT account</FieldLabel>
                  <input readOnly value={accountNumber} placeholder="Set in Carriers tab" style={{ ...inputStyle, opacity: 0.8 }} />
                </div>
              </div>
              {!accountNumber && (
                <p style={{ fontSize: '11px', fontFamily: mono, color: 'var(--brand-pink)', margin: '0 0 10px' }}>
                  No TNT account number — set it in the Carriers tab first.
                </p>
              )}

              {/* Queries */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '14px 0 8px' }}>
                <FieldLabel>{queries.length} quer{queries.length === 1 ? 'y' : 'ies'} · {remaining} to lodge</FieldLabel>
                <button
                  onClick={submitAll}
                  disabled={!!busyId || !contactOk || remaining === 0}
                  style={{
                    fontSize: '12px', fontWeight: 600, padding: '5px 14px', borderRadius: '6px',
                    cursor: (!!busyId || !contactOk || remaining === 0) ? 'not-allowed' : 'pointer',
                    color: 'var(--accent-text)', background: 'var(--brand-accent)', border: 'none',
                    opacity: (!!busyId || !contactOk || remaining === 0) ? 0.5 : 1,
                  }}
                >
                  {busyId === 'all' ? 'Submitting…' : remaining === 0 ? 'All lodged ✓' : `Submit all (${remaining})`}
                </button>
              </div>

              {queries.length === 0 && (
                <p style={{ fontSize: '12px', fontFamily: mono, color: 'var(--text-disabled)' }}>No disputable lines on this invoice.</p>
              )}

              {queries.map(q => (
                <div key={q.line.id} style={{ background: 'var(--bg-surface)', border: `1px solid ${q.submitted ? 'rgba(var(--brand-aqua-rgb),0.35)' : 'var(--border-default)'}`, borderRadius: '8px', padding: '12px 14px', marginBottom: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', marginBottom: '8px' }}>
                    <span style={{ fontSize: '12px', fontFamily: mono, color: 'var(--text-primary)', fontWeight: 600 }}>
                      {q.line.tracking_ref ?? '—'}
                      <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}> · {q.type} · {aud(q.line.charged_total)}</span>
                    </span>
                    {q.submitted ? (
                      <span style={{ fontSize: '11px', fontFamily: mono, color: 'var(--brand-aqua)', flexShrink: 0 }}>Lodged ✓</span>
                    ) : (
                      <button
                        onClick={() => submitOne(q)}
                        disabled={!!busyId || !contactOk}
                        style={{
                          fontSize: '11px', fontFamily: mono, padding: '4px 12px', borderRadius: '5px', flexShrink: 0,
                          cursor: (!!busyId || !contactOk) ? 'not-allowed' : 'pointer',
                          color: 'var(--brand-accent)', border: '1px solid rgba(var(--brand-accent-rgb),0.35)', background: 'transparent',
                          opacity: (!!busyId || !contactOk) ? 0.5 : 1,
                        }}
                      >
                        {busyId === q.line.id ? 'Submitting…' : 'Submit'}
                      </button>
                    )}
                  </div>
                  <textarea
                    value={q.info}
                    onChange={e => setQueries(prev => prev.map(x => x.line.id === q.line.id ? { ...x, info: e.target.value } : x))}
                    disabled={q.submitted}
                    rows={4}
                    style={{
                      width: '100%', boxSizing: 'border-box', background: 'var(--bg-primary)',
                      border: '1px solid var(--border-subtle)', borderRadius: '6px',
                      color: q.submitted ? 'var(--text-tertiary)' : 'var(--text-primary)', fontSize: '12px', padding: '10px',
                      fontFamily: mono, resize: 'vertical', outline: 'none', lineHeight: 1.6,
                    }}
                  />
                  {errors[q.line.id] && (
                    <p style={{ margin: '6px 0 0', fontSize: '11px', fontFamily: mono, color: 'var(--brand-pink)' }}>{errors[q.line.id]}</p>
                  )}
                </div>
              ))}
            </div>

            <div style={{ padding: '12px 24px 20px', borderTop: '1px solid var(--border-subtle)', flexShrink: 0 }}>
              <button onClick={onClose} disabled={busyId === 'all'} style={btnGhost}>Close</button>
            </div>
          </>
        )}
      </div>
    </>
  )
}
