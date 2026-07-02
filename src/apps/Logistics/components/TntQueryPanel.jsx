import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@portal/lib/supabase'
import { aud } from '../utils/helpers.js'
import { mono, btnGhost, FieldLabel, inputStyle } from '../utils/ui.jsx'

// TNT lodges invoice disputes via its public invoice-query form — ONE
// SUBMISSION PER QUERY (per disputed con-note line), not per invoice. The form
// is protected by reCAPTCHA, so it can't be auto-submitted; instead we open the
// form with the query's field values in the URL fragment and a one-time
// bookmarklet fills the fields. The user solves the captcha and clicks Submit,
// then marks the query lodged here for pipeline tracking.

const CONTACT_KEY = 'logistics_tnt_contact'
const TNT_QUERY_PHONE = '1300 770 966'   // AGA main line — used on all TNT queries
const TNT_FORM_URL = 'https://www.tnt.com/express/en_au/site/support/invoice-query.html'

// Reads the JSON payload from the page URL fragment and fills the TNT form.
const BOOKMARKLET =
  "javascript:(function(){try{var d=JSON.parse(decodeURIComponent(location.hash.slice(1)));" +
  "var f=document.getElementById('InvoiceQuery')||document;var n=0;" +
  "Object.keys(d).forEach(function(k){var el=f.querySelector('[name=\"'+k+'\"]');if(!el)return;" +
  "el.value=d[k];el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));n++;});" +
  "alert('AGA: '+n+' fields filled. Solve the reCAPTCHA and click Submit.');}" +
  "catch(e){alert('AGA fill failed: '+e.message);}})();"

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
  const [phone, setPhone] = useState(saved.phone ?? TNT_QUERY_PHONE)
  const [email, setEmail] = useState('')
  const [queries, setQueries] = useState([])
  const [busyId,  setBusyId]  = useState(null)
  const [showSetup, setShowSetup] = useState(false)

  // Draggable bookmarklet — set href via DOM so React doesn't sanitise the javascript: URL
  const bmRef = useCallback(node => { if (node) node.setAttribute('href', BOOKMARKLET) }, [])

  useEffect(() => {
    if (!open) return
    supabase.auth.getUser().then(async ({ data }) => {
      const user = data?.user
      if (!user) return
      setEmail(e => e || user.email || '')
      setName(n => {
        if (n) return n
        const metaName = user.user_metadata?.full_name || user.user_metadata?.name
        if (metaName) return metaName
        supabase.from('profiles').select('full_name').eq('id', user.id).single()
          .then(({ data: p }) => { if (p?.full_name) setName(cur => cur || p.full_name) })
        return n
      })
    })
    setQueries(buildTntQueries(invoice?.freight_invoice_lines).map(q => ({ ...q, submitted: !!q.line.query_submitted_at })))
  }, [open, invoice])

  if (!invoice) return null
  const accountNumber = invoice.carriers?.account_number ?? ''
  const contactOk = name.trim() && phone.trim() && email.trim() && accountNumber

  const payloadFor = (q) => ({
    LNAME:          name,
    COMPANYNAME:    'Automotive Group Australia',
    PHONENUMBER:    phone,
    Address:        email,
    ACCOUNTNUMBER:  accountNumber,
    INVOICENUMBER:  invoice.invoice_ref,
    SHIPMENTNUMBER: q.line.tracking_ref ?? '',
    SUBJECT:        q.type,
    ADDITIONALINFO: q.info,
  })

  const openForm = (q) => {
    localStorage.setItem(CONTACT_KEY, JSON.stringify({ name, phone }))
    const hash = encodeURIComponent(JSON.stringify(payloadFor(q)))
    window.open(`${TNT_FORM_URL}#${hash}`, '_blank')
  }

  const markLodged = async (q) => {
    setBusyId(q.line.id)
    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('freight_invoice_lines').update({ query_submitted_at: new Date().toISOString() }).eq('id', q.line.id)
    if (dispute) {
      await supabase.from('dispute_events').insert({
        dispute_id: dispute.id,
        event_type: 'query_submitted',
        detail: `TNT invoice query lodged — ${q.type}${q.line.tracking_ref ? ` — con note ${q.line.tracking_ref}` : ''}`,
        created_by: user?.id ?? null,
      })
    }
    setBusyId(null)
    setQueries(prev => {
      const next = prev.map(x => x.line.id === q.line.id ? { ...x, submitted: true } : x)
      if (dispute && next.every(x => x.submitted)) {
        supabase.from('disputes').update({ status: 'sent', sent_to: 'TNT invoice query form', sent_at: new Date().toISOString() })
          .eq('id', dispute.id).then(() => onChange?.())
      }
      return next
    })
    onChange?.()
  }

  const remaining = queries.filter(q => !q.submitted).length

  const linkBtn = { fontSize: '11px', fontFamily: mono, padding: '4px 12px', borderRadius: '5px', flexShrink: 0, cursor: 'pointer' }

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
                Open each query in TNT's form (reCAPTCHA), then mark it lodged
              </p>
            </div>

            <div style={{ flex: 1, padding: '16px 24px', overflowY: 'auto' }}>
              {/* One-time bookmarklet setup */}
              <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: '8px', padding: '10px 14px', marginBottom: '14px' }}>
                <button onClick={() => setShowSetup(s => !s)} style={{ background: 'none', border: 'none', color: 'var(--brand-accent)', cursor: 'pointer', fontSize: '12px', fontFamily: mono, padding: 0 }}>
                  {showSetup ? '▾' : '▸'} One-time setup: “Fill TNT form” bookmarklet
                </button>
                {showSetup && (
                  <div style={{ marginTop: '10px', fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                    Drag this button to your bookmarks bar (once):
                    <div style={{ margin: '8px 0' }}>
                      <a
                        ref={bmRef}
                        onClick={e => e.preventDefault()}
                        draggable
                        style={{ display: 'inline-block', fontSize: '12px', fontWeight: 600, padding: '6px 14px', borderRadius: '6px', color: 'var(--accent-text)', background: 'var(--brand-accent)', textDecoration: 'none', cursor: 'grab' }}
                      >
                        ⭑ Fill TNT form
                      </a>
                    </div>
                    Then on any query: click <strong>Open TNT form</strong> below, click your bookmark to fill the fields, solve the reCAPTCHA, and Submit.
                  </div>
                )}
              </div>

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
              <div style={{ margin: '14px 0 8px' }}>
                <FieldLabel>{queries.length} quer{queries.length === 1 ? 'y' : 'ies'} · {remaining} to lodge</FieldLabel>
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
                    <span style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                      {q.submitted ? (
                        <span style={{ fontSize: '11px', fontFamily: mono, color: 'var(--brand-aqua)' }}>Lodged ✓</span>
                      ) : (
                        <>
                          <button
                            onClick={() => openForm(q)}
                            disabled={!contactOk}
                            style={{ ...linkBtn, color: 'var(--brand-accent)', border: '1px solid rgba(var(--brand-accent-rgb),0.35)', background: 'transparent', opacity: contactOk ? 1 : 0.5, cursor: contactOk ? 'pointer' : 'not-allowed' }}
                          >
                            Open TNT form
                          </button>
                          <button
                            onClick={() => markLodged(q)}
                            disabled={busyId === q.line.id}
                            style={{ ...linkBtn, color: 'var(--brand-aqua)', border: '1px solid rgba(var(--brand-aqua-rgb),0.4)', background: 'transparent' }}
                          >
                            {busyId === q.line.id ? '…' : 'Mark lodged'}
                          </button>
                        </>
                      )}
                    </span>
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
                </div>
              ))}
            </div>

            <div style={{ padding: '12px 24px 20px', borderTop: '1px solid var(--border-subtle)', flexShrink: 0 }}>
              <button onClick={onClose} style={btnGhost}>Close</button>
            </div>
          </>
        )}
      </div>
    </>
  )
}
