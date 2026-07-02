import { useEffect, useState, Fragment } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@portal/lib/supabase'
import LogisticsNav from './LogisticsNav.jsx'
import { aud, fmtDate, daysSince } from '../utils/helpers.js'
import {
  pageWrap, card, mono, thStyle, tdStyle, inputStyle, btnGhost,
  Badge, Spinner, Flash, useFlash, DISPUTE_STATUS_STYLE, PageHeader, HoverBtn, Modal, FieldLabel, rowHover,
} from '../utils/ui.jsx'

const OPEN_STATUSES = ['draft', 'sent', 'acknowledged']

export default function Disputes() {
  const [disputes, setDisputes] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [filter,   setFilter]   = useState('open')     // open | all
  const [expanded, setExpanded] = useState(null)
  const [msg,      flash]       = useFlash()
  const navigate = useNavigate()

  // Log-credit modal
  const [creditFor,    setCreditFor]    = useState(null)   // dispute row
  const [creditAmount, setCreditAmount] = useState('')
  const [creditSaving, setCreditSaving] = useState(false)

  // Letter panel (draft / edit / send from this tab)
  const [panelFor,    setPanelFor]    = useState(null)     // dispute row
  const [panelLetter, setPanelLetter] = useState('')
  const [panelBusy,   setPanelBusy]   = useState(false)

  const fetchDisputes = async () => {
    const { data } = await supabase
      .from('disputes')
      .select('*, freight_invoices(id, invoice_ref, invoice_date, carriers(name, claims_email)), dispute_events(*)')
      .order('created_at', { ascending: false })
    if (data) setDisputes(data)
    setLoading(false)
  }

  useEffect(() => { fetchDisputes() }, [])

  const logEvent = (dispute_id, event_type, detail, amount = null, created_by = null) =>
    supabase.from('dispute_events').insert({ dispute_id, event_type, detail, amount, created_by })

  const setStatus = async (d, status) => {
    const patch = { status }
    if (['credited', 'rejected', 'written_off'].includes(status)) patch.resolved_at = new Date().toISOString()
    const { error } = await supabase.from('disputes').update(patch).eq('id', d.id)
    if (error) { flash('err', error.message); return }
    const { data: { user } } = await supabase.auth.getUser()
    await logEvent(d.id, 'status_changed', `Status → ${status.replace('_', ' ')}`, null, user?.id ?? null)
    if (['rejected', 'written_off'].includes(status)) {
      await supabase.from('freight_invoices').update({ status: 'resolved' }).eq('id', d.invoice_id)
    }
    flash('ok', `Dispute marked ${status.replace('_', ' ')}`)
    fetchDisputes()
  }

  const openCreditModal = (d) => {
    setCreditFor(d)
    setCreditAmount(String(Number(d.amount_claimed) - Number(d.amount_recovered) || ''))
  }

  const saveCredit = async () => {
    const amount = parseFloat(creditAmount)
    if (isNaN(amount) || amount <= 0) { flash('err', 'Enter a valid credit amount'); return }
    setCreditSaving(true)
    const d = creditFor
    const newRecovered = Number(d.amount_recovered) + amount
    const { error } = await supabase.from('disputes').update({
      amount_recovered: newRecovered,
      status: 'credited',
      resolved_at: new Date().toISOString(),
    }).eq('id', d.id)
    setCreditSaving(false)
    if (error) { flash('err', error.message); return }
    const { data: { user } } = await supabase.auth.getUser()
    await logEvent(d.id, 'credit_logged', `Credit received — ${aud(amount)}`, amount, user?.id ?? null)
    await supabase.from('freight_invoices').update({ status: 'resolved' }).eq('id', d.invoice_id)
    setCreditFor(null)
    flash('ok', `${aud(amount)} credit logged`)
    fetchDisputes()
  }

  const openPanel = (d) => {
    setPanelFor(d)
    setPanelLetter(d.letter_text ?? '')
  }

  const saveDraft = async () => {
    setPanelBusy(true)
    const { error } = await supabase.from('disputes').update({ letter_text: panelLetter }).eq('id', panelFor.id)
    setPanelBusy(false)
    if (error) { flash('err', error.message); return }
    setPanelFor(null)
    flash('ok', 'Draft saved')
    fetchDisputes()
  }

  const sendLetter = async () => {
    setPanelBusy(true)
    const { data, error } = await supabase.functions.invoke('send-dispute-email', {
      body: { dispute_id: panelFor.id, letter_text: panelLetter },
    })
    setPanelBusy(false)
    if (error || data?.error) { flash('err', data?.error ?? error.message); return }
    setPanelFor(null)
    flash('ok', `Dispute email sent to ${data.sent_to}`)
    fetchDisputes()
  }

  if (loading) return <Spinner />

  const shown = filter === 'open' ? disputes.filter(d => OPEN_STATUSES.includes(d.status)) : disputes
  const openDisputes  = disputes.filter(d => OPEN_STATUSES.includes(d.status))
  const totalClaimed  = openDisputes.reduce((s, d) => s + Number(d.amount_claimed), 0)
  const totalRecovered = disputes.reduce((s, d) => s + Number(d.amount_recovered), 0)

  return (
    <div style={pageWrap}>
      <PageHeader title="Disputes" subtitle="Overcharge claims and recovery tracking">
        <div style={{ display: 'flex', gap: '4px', background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: '6px', padding: '2px' }}>
          {['open', 'all'].map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                padding: '4px 12px', fontSize: '12px', fontFamily: mono, borderRadius: '4px', border: 'none', cursor: 'pointer',
                background: filter === f ? 'var(--bg-active)' : 'transparent',
                color: filter === f ? 'var(--text-primary)' : 'var(--text-tertiary)',
              }}
            >
              {f === 'open' ? `Open (${openDisputes.length})` : 'All'}
            </button>
          ))}
        </div>
      </PageHeader>

      <LogisticsNav />
      <Flash msg={msg} />

      {(totalClaimed > 0 || totalRecovered > 0) && (
        <div style={{ display: 'flex', gap: '20px', alignItems: 'center', padding: '12px 16px', borderRadius: '8px', marginBottom: '20px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
            <span style={{ color: 'var(--brand-pink)', fontWeight: 600 }}>{aud(totalClaimed)}</span> in open claims
          </span>
          <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
            <span style={{ color: 'var(--brand-aqua)', fontWeight: 600 }}>{aud(totalRecovered)}</span> recovered to date
          </span>
        </div>
      )}

      <div style={{ ...card, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '760px' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              {['Invoice #', 'Carrier', 'Status', 'Claimed', 'Recovered', 'Age', 'Actions', ''].map((h, i) => (
                <th key={i} style={thStyle(h === 'Claimed' || h === 'Recovered')}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map(d => {
              const inv = d.freight_invoices
              const isExpanded = expanded === d.id
              const age = daysSince(d.sent_at ?? d.created_at)
              const events = [...(d.dispute_events ?? [])].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
              const isOpen = OPEN_STATUSES.includes(d.status)
              return (
                <Fragment key={d.id}>
                  <tr
                    style={{ borderBottom: isExpanded ? 'none' : '1px solid var(--border-subtle)', cursor: 'pointer', transition: 'background 120ms' }}
                    onClick={() => setExpanded(isExpanded ? null : d.id)}
                    {...rowHover}
                  >
                    <td style={{ ...tdStyle, fontWeight: 500 }}>
                      <button
                        onClick={e => { e.stopPropagation(); navigate(`/logistics/invoices/${inv?.id}`) }}
                        style={{ background: 'none', border: 'none', color: 'var(--brand-accent)', cursor: 'pointer', fontSize: '13px', fontWeight: 500, padding: 0 }}
                      >
                        {inv?.invoice_ref ?? '—'}
                      </button>
                    </td>
                    <td style={{ ...tdStyle, color: 'var(--text-secondary)' }}>{inv?.carriers?.name ?? '—'}</td>
                    <td style={tdStyle}><Badge map={DISPUTE_STATUS_STYLE} value={d.status} /></td>
                    <td style={{ ...tdStyle, textAlign: 'right', color: 'var(--brand-pink)', fontWeight: 500 }}>{aud(Number(d.amount_claimed))}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                      {Number(d.amount_recovered) > 0
                        ? <span style={{ color: 'var(--brand-aqua)', fontWeight: 500 }}>{aud(Number(d.amount_recovered))}</span>
                        : <span style={{ color: 'var(--text-disabled)' }}>—</span>}
                    </td>
                    <td style={{ ...tdStyle, fontSize: '12px', fontFamily: mono, color: age != null && age > 14 && isOpen ? 'var(--brand-accent)' : 'var(--text-tertiary)' }}>
                      {age != null ? `${age}d` : '—'}
                    </td>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>
                      {isOpen && (
                        <span style={{ display: 'flex', gap: '10px' }}>
                          <button onClick={() => openPanel(d)} style={{ background: 'none', border: 'none', color: 'var(--brand-accent)', cursor: 'pointer', fontSize: '11px', fontFamily: mono, padding: 0 }}>
                            {d.status === 'draft' ? 'Edit & send' : 'Letter'}
                          </button>
                          <button onClick={() => openCreditModal(d)} style={{ background: 'none', border: 'none', color: 'var(--brand-aqua)', cursor: 'pointer', fontSize: '11px', fontFamily: mono, padding: 0 }}>Log credit</button>
                          {d.status === 'sent' && (
                            <button onClick={() => setStatus(d, 'acknowledged')} style={{ background: 'none', border: 'none', color: 'var(--brand-accent)', cursor: 'pointer', fontSize: '11px', fontFamily: mono, padding: 0 }}>Ack'd</button>
                          )}
                          <button onClick={() => setStatus(d, 'rejected')} style={{ background: 'none', border: 'none', color: 'var(--brand-pink)', cursor: 'pointer', fontSize: '11px', fontFamily: mono, padding: 0 }}>Rejected</button>
                          <button onClick={() => setStatus(d, 'written_off')} style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', fontSize: '11px', fontFamily: mono, padding: 0 }}>Write off</button>
                        </span>
                      )}
                    </td>
                    <td style={{ ...tdStyle, fontSize: '11px', fontFamily: mono, color: 'var(--text-disabled)' }}>{isExpanded ? '▲' : '▼'}</td>
                  </tr>
                  {isExpanded && (
                    <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                      <td colSpan={8} style={{ padding: '0 14px 14px' }}>
                        <div style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-subtle)', borderRadius: '6px', padding: '12px 14px' }}>
                          {events.length === 0 && <p style={{ margin: 0, fontSize: '12px', fontFamily: mono, color: 'var(--text-disabled)' }}>No events logged.</p>}
                          {events.map(ev => (
                            <div key={ev.id} style={{ display: 'flex', gap: '12px', padding: '5px 0', fontSize: '12px', fontFamily: mono }}>
                              <span style={{ color: 'var(--text-disabled)', flexShrink: 0 }}>{new Date(ev.created_at).toLocaleString('en-AU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                              <span style={{ color: 'var(--text-secondary)' }}>{ev.detail ?? ev.event_type.replace('_', ' ')}</span>
                            </div>
                          ))}
                          {d.letter_text && (
                            <details style={{ marginTop: '8px' }}>
                              <summary style={{ fontSize: '11px', fontFamily: mono, color: 'var(--brand-accent)', cursor: 'pointer' }}>View letter</summary>
                              <pre style={{ margin: '8px 0 0', fontSize: '12px', color: 'var(--text-primary)', whiteSpace: 'pre-wrap', fontFamily: mono, lineHeight: 1.6 }}>{d.letter_text}</pre>
                            </details>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
            {shown.length === 0 && (
              <tr><td colSpan={8} style={{ padding: '32px', textAlign: 'center', color: 'var(--text-disabled)', fontSize: '13px', fontFamily: mono }}>
                {filter === 'open' ? 'No open disputes — all clear' : 'No disputes yet'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Slide-in dispute letter panel ─────────────────────────────────────── */}
      {panelFor && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 40 }} onClick={() => { if (!panelBusy) setPanelFor(null) }} />
      )}
      <div
        style={{
          position: 'fixed', right: 0, top: 0, height: '100%', width: '480px', maxWidth: '100vw',
          background: 'var(--bg-elevated)', borderLeft: '1px solid var(--border-default)',
          transform: panelFor ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 220ms ease',
          zIndex: 50, display: 'flex', flexDirection: 'column', boxSizing: 'border-box',
        }}
      >
        {panelFor && (
          <>
            <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
                <div>
                  <p style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                    Dispute letter — {panelFor.freight_invoices?.invoice_ref}
                  </p>
                  <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '4px 0 0', fontFamily: mono }}>
                    {panelFor.freight_invoices?.carriers?.claims_email
                      ? `To: ${panelFor.freight_invoices.carriers.claims_email}`
                      : 'No claims email set — add one in the Carriers tab'}
                  </p>
                </div>
                <button
                  onClick={() => setPanelFor(null)}
                  style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '18px', lineHeight: 1, padding: 0, flexShrink: 0, marginTop: '2px' }}
                >
                  ×
                </button>
              </div>
            </div>

            <div style={{ flex: 1, padding: '16px 24px', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <textarea
                value={panelLetter}
                onChange={e => setPanelLetter(e.target.value)}
                placeholder="Write the dispute letter…"
                rows={12}
                style={{
                  flex: 1, width: '100%', boxSizing: 'border-box',
                  background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: '6px',
                  color: 'var(--text-primary)', fontSize: '13px', padding: '14px',
                  fontFamily: mono, resize: 'none', outline: 'none', lineHeight: 1.7,
                }}
              />
            </div>

            <div style={{ padding: '16px 24px 24px', borderTop: '1px solid var(--border-subtle)', flexShrink: 0, display: 'flex', gap: '10px' }}>
              <button
                onClick={sendLetter}
                disabled={panelBusy || !panelLetter.trim() || !panelFor.freight_invoices?.carriers?.claims_email}
                style={{
                  flex: 1, fontSize: '13px', fontWeight: 600, padding: '9px 16px', borderRadius: '6px',
                  cursor: (panelBusy || !panelLetter.trim() || !panelFor.freight_invoices?.carriers?.claims_email) ? 'not-allowed' : 'pointer',
                  color: 'var(--accent-text)', background: 'var(--brand-accent)',
                  border: 'none', opacity: (panelBusy || !panelLetter.trim() || !panelFor.freight_invoices?.carriers?.claims_email) ? 0.5 : 1,
                }}
              >
                {panelBusy ? 'Sending…' : `Send to ${panelFor.freight_invoices?.carriers?.name ?? 'carrier'}`}
              </button>
              <button
                onClick={saveDraft}
                disabled={panelBusy || !panelLetter.trim()}
                style={{ ...btnGhost, padding: '9px 16px', fontSize: '13px', opacity: (panelBusy || !panelLetter.trim()) ? 0.6 : 1 }}
              >
                Save draft
              </button>
            </div>
          </>
        )}
      </div>

      {/* ── Log credit modal ───────────────────────────────────────────────────── */}
      <Modal open={!!creditFor} onClose={() => { if (!creditSaving) setCreditFor(null) }} width={420}>
        {creditFor && (
          <>
            <p style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 4px' }}>Log credit received</p>
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)', fontFamily: mono, margin: '0 0 20px' }}>
              {creditFor.freight_invoices?.invoice_ref} · {aud(Number(creditFor.amount_claimed))} claimed
            </p>
            <FieldLabel>Credit amount (AUD)</FieldLabel>
            <input
              value={creditAmount}
              onChange={e => setCreditAmount(e.target.value)}
              placeholder="0.00"
              autoFocus
              style={{ ...inputStyle, marginBottom: '20px' }}
            />
            <div style={{ display: 'flex', gap: '8px' }}>
              <HoverBtn onClick={saveCredit} disabled={creditSaving}>{creditSaving ? 'Saving…' : 'Log credit & close dispute'}</HoverBtn>
              <button onClick={() => setCreditFor(null)} disabled={creditSaving} style={btnGhost}>Cancel</button>
            </div>
          </>
        )}
      </Modal>
    </div>
  )
}
