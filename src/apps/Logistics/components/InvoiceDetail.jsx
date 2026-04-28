import { useEffect, useState, Fragment } from 'react'
import { useNavigate } from 'react-router-dom'
import { useParams } from 'react-router-dom'
import { supabase } from '@portal/lib/supabase'
import LogisticsNav from './LogisticsNav.jsx'
import { aud, fmtDate, lineVariance, invoiceOvercharge, invoiceTotal } from '../utils/helpers.js'

const STATUS_STYLE = {
  pending:  { color: '#888',    background: '#1a1a1a',              border: '1px solid #222222' },
  flagged:  { color: '#f3ca0f', background: 'rgba(243,202,15,0.1)', border: '1px solid rgba(243,202,15,0.3)' },
  disputed: { color: '#ff1744', background: 'rgba(239,68,68,0.1)',  border: '1px solid rgba(239,68,68,0.3)'  },
  approved: { color: '#4ade80', background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.3)' },
  resolved: { color: '#60a5fa', background: 'rgba(96,165,250,0.1)', border: '1px solid rgba(96,165,250,0.3)' },
}

const EMAIL_STATUS_STYLE = {
  sent:  { color: '#4ade80', background: 'rgba(74,222,128,0.1)',  border: '1px solid rgba(74,222,128,0.3)' },
  draft: { color: '#f3ca0f', background: 'rgba(243,202,15,0.1)', border: '1px solid rgba(243,202,15,0.3)' },
}

function ActionBtn({ label, color, borderColor, disabled, onClick }) {
  const [hover, setHover] = useState(false)
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        fontSize: '12px', fontWeight: 500, padding: '6px 14px', borderRadius: '6px',
        cursor: disabled ? 'not-allowed' : 'pointer', transition: 'background 120ms',
        color: disabled ? '#444' : color,
        border: `1px solid ${disabled ? '#222222' : (hover ? borderColor : '#222222')}`,
        background: hover && !disabled ? `${borderColor}18` : 'transparent',
        opacity: disabled ? 0.5 : 1,
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {label}
    </button>
  )
}

const sectionLabel = {
  fontSize: '11px', fontFamily: '"JetBrains Mono", monospace', color: '#a0a0a0',
  textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '10px',
}

export default function InvoiceDetail() {
  const { id } = useParams()
  const navigate = useNavigate()

  // Existing state
  const [invoice,          setInvoice]          = useState(null)
  const [loading,          setLoading]          = useState(true)
  const [notes,            setNotes]            = useState('')
  const [savingNotes,      setSavingNotes]      = useState(false)
  const [updatingStatus,   setUpdatingStatus]   = useState(false)
  const [generatingLetter, setGeneratingLetter] = useState(false)
  const [letter,           setLetter]           = useState('')
  const [msg,              setMsg]              = useState(null)

  // Dispute email state
  const [disputeEmails,    setDisputeEmails]    = useState([])
  const [showPanel,        setShowPanel]        = useState(false)
  const [panelLetter,      setPanelLetter]      = useState('')
  const [panelBusy,        setPanelBusy]        = useState(false)
  const [expandedEmail,    setExpandedEmail]    = useState(null)
  const [noClaimsWarning,  setNoClaimsWarning]  = useState(false)

  const fetchInvoice = async () => {
    if (!id) return
    const { data, error } = await supabase
      .from('freight_invoices')
      .select('*, carriers(*), freight_invoice_lines(*)')
      .eq('id', id)
      .single()
    if (!error && data) {
      const sorted = { ...data, freight_invoice_lines: [...(data.freight_invoice_lines ?? [])].sort((a, b) => a.sort_order - b.sort_order) }
      setInvoice(sorted)
      setNotes(sorted.notes ?? '')
    }
    setLoading(false)
  }

  const fetchDisputeEmails = async () => {
    if (!id) return
    const { data } = await supabase
      .from('dispute_emails')
      .select('*')
      .eq('invoice_id', id)
      .order('sent_at', { ascending: false })
    if (data) setDisputeEmails(data)
  }

  useEffect(() => { fetchInvoice(); fetchDisputeEmails() }, [id])

  const flash = (type, text) => { setMsg({ type, text }); setTimeout(() => setMsg(null), 3000) }

  // ─── Status actions ──────────────────────────────────────────────────────────

  const updateStatus = async (status) => {
    if (!invoice) return
    setUpdatingStatus(true)
    const { error } = await supabase.from('freight_invoices').update({ status }).eq('id', invoice.id)
    setUpdatingStatus(false)
    if (error) { flash('err', error.message); return }
    flash('ok', `Status updated to ${status}`)
    await fetchInvoice()
  }

  const raiseDispute = async () => {
    if (!invoice) return
    setUpdatingStatus(true)
    const { error } = await supabase.from('freight_invoices').update({ status: 'disputed' }).eq('id', invoice.id)
    setUpdatingStatus(false)
    if (error) { flash('err', error.message); return }
    await fetchInvoice()

    const claimsEmail = invoice.carriers?.claims_email
    if (!claimsEmail) {
      setNoClaimsWarning(true)
      return
    }

    await openPanelWithNewLetter(invoice)
  }

  // ─── Letter generation ───────────────────────────────────────────────────────

  const openPanelWithNewLetter = async (inv) => {
    const lines = inv.freight_invoice_lines ?? []
    const flaggedLines = lines
      .filter(l => { const v = lineVariance(l); return v != null && v > 0 })
      .map(l => ({ description: l.description, detail: l.detail ?? '', variance_aud: lineVariance(l) }))
    const totalOver = invoiceOvercharge(lines)

    setGeneratingLetter(true)
    const { data, error } = await supabase.functions.invoke('generate-dispute-letter', {
      body: {
        invoice_ref:          inv.invoice_ref,
        carrier_name:         inv.carriers?.name ?? '',
        invoice_date:         inv.invoice_date,
        flagged_lines:        flaggedLines,
        total_overcharge_aud: totalOver,
      },
    })
    setGeneratingLetter(false)
    if (error) { flash('err', error.message); return }
    setPanelLetter(data.letter ?? '')
    setShowPanel(true)
  }

  const openPanelForResend = async () => {
    const draft = disputeEmails.find(e => e.status === 'draft')
    if (draft) {
      setPanelLetter(draft.letter_text ?? '')
      setShowPanel(true)
      return
    }
    await openPanelWithNewLetter(invoice)
  }

  // ─── Existing AI letter (unchanged) ─────────────────────────────────────────

  const generateLetter = async () => {
    if (!invoice) return
    const lines = invoice.freight_invoice_lines ?? []
    const flaggedLines = lines
      .filter(l => { const v = lineVariance(l); return v != null && v > 0 })
      .map(l => ({ description: l.description, detail: l.detail ?? '', variance_aud: lineVariance(l) }))
    const totalOver = invoiceOvercharge(lines)

    setGeneratingLetter(true)
    setLetter('')
    const { data, error } = await supabase.functions.invoke('generate-dispute-letter', {
      body: {
        invoice_ref:          invoice.invoice_ref,
        carrier_name:         invoice.carriers?.name ?? '',
        invoice_date:         invoice.invoice_date,
        flagged_lines:        flaggedLines,
        total_overcharge_aud: totalOver,
      },
    })
    setGeneratingLetter(false)
    if (error) { flash('err', error.message); return }
    setLetter(data.letter ?? '')
  }

  const copyLetter = () => {
    navigator.clipboard.writeText(letter)
    flash('ok', 'Letter copied to clipboard')
  }

  // ─── Notes ───────────────────────────────────────────────────────────────────

  const saveNotes = async () => {
    if (!invoice) return
    setSavingNotes(true)
    const { error } = await supabase.from('freight_invoices').update({ notes }).eq('id', invoice.id)
    setSavingNotes(false)
    if (error) { flash('err', error.message); return }
    flash('ok', 'Notes saved')
  }

  // ─── Dispute panel actions ───────────────────────────────────────────────────

  const saveDraft = async () => {
    if (!invoice) return
    setPanelBusy(true)
    const { data: { user } } = await supabase.auth.getUser()
    const existingDraft = disputeEmails.find(e => e.status === 'draft')
    const { error } = existingDraft
      ? await supabase.from('dispute_emails').update({ letter_text: panelLetter }).eq('id', existingDraft.id)
      : await supabase.from('dispute_emails').insert({
          invoice_id:  invoice.id,
          sent_to:     invoice.carriers?.claims_email,
          letter_text: panelLetter,
          sent_by:     user?.id ?? null,
          status:      'draft',
        })
    setPanelBusy(false)
    if (error) { flash('err', error.message); return }
    setShowPanel(false)
    fetchDisputeEmails()
  }

  const sendDisputeEmail = async () => {
    if (!invoice) return
    setPanelBusy(true)
    const { error } = await supabase.functions.invoke('send-dispute-email', {
      body: { invoice_id: invoice.id, letter_text: panelLetter },
    })
    setPanelBusy(false)
    if (error) { flash('err', error.message); return }
    flash('ok', `Dispute email sent to ${invoice.carriers?.claims_email}`)
    setShowPanel(false)
    fetchDisputeEmails()
  }

  // ─── Loading / not found ─────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center" style={{ flex: 1 }}>
        <div className="w-7 h-7 rounded-full border-2 animate-spin" style={{ borderColor: '#f3ca0f', borderTopColor: 'transparent' }} />
      </div>
    )
  }
  if (!invoice) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#444', fontFamily: '"JetBrains Mono", monospace', fontSize: '13px' }}>
        Invoice not found.
      </div>
    )
  }

  const lines    = invoice.freight_invoice_lines ?? []
  const total    = invoiceTotal(lines)
  const over     = invoiceOvercharge(lines)
  const flagN    = lines.filter(l => { const v = lineVariance(l); return v != null && v > 0 }).length
  const noRateN  = lines.filter(l => l.contracted_total == null).length
  const ss       = STATUS_STYLE[invoice.status] ?? STATUS_STYLE.pending
  const hasSent  = disputeEmails.some(e => e.status === 'sent')

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '32px 24px', maxWidth: '1200px', margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>

      <div style={{ marginBottom: '24px' }}>
        <button
          onClick={() => navigate('/logistics/invoices')}
          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: '12px', fontFamily: '"JetBrains Mono", monospace', color: '#555', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '4px', transition: 'color 120ms' }}
          onMouseEnter={e => { e.currentTarget.style.color = '#a0a0a0' }}
          onMouseLeave={e => { e.currentTarget.style.color = '#555' }}
        >
          ← Invoices
        </button>
        <h1 style={{ fontSize: '18px', fontWeight: 600, color: '#ffffff', margin: 0 }}>Invoice Detail</h1>
        <p style={{ fontSize: '13px', color: '#a0a0a0', margin: '4px 0 0', fontFamily: '"JetBrains Mono", monospace' }}>Review and manage carrier invoice</p>
      </div>

      <LogisticsNav />

      {/* Toast */}
      {msg && (
        <div style={{ marginBottom: '16px', padding: '10px 14px', borderRadius: '6px', fontSize: '12px', fontFamily: '"JetBrains Mono", monospace',
          background: msg.type === 'ok' ? 'rgba(74,222,128,0.1)' : 'rgba(239,68,68,0.1)',
          border: `1px solid ${msg.type === 'ok' ? 'rgba(74,222,128,0.3)' : 'rgba(239,68,68,0.3)'}`,
          color: msg.type === 'ok' ? '#4ade80' : '#ff1744' }}>
          {msg.text}
        </div>
      )}

      {/* No claims email warning */}
      {noClaimsWarning && (
        <div style={{ marginBottom: '16px', padding: '10px 14px', borderRadius: '6px', fontSize: '12px', fontFamily: '"JetBrains Mono", monospace',
          background: 'rgba(243,202,15,0.08)', border: '1px solid rgba(243,202,15,0.3)', color: '#f3ca0f',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
          <span>No claims email set for this carrier — add one in Carrier settings.</span>
          <button onClick={() => setNoClaimsWarning(false)} style={{ background: 'none', border: 'none', color: '#f3ca0f', cursor: 'pointer', fontSize: '14px', lineHeight: 1, padding: 0 }}>×</button>
        </div>
      )}

      {/* Header card */}
      <div style={{ background: '#0a0a0a', border: '1px solid #1e1e1e', borderRadius: '8px', padding: '20px', marginBottom: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap', marginBottom: '20px' }}>
          <div>
            <p style={{ fontSize: '22px', fontWeight: 700, color: '#ffffff', margin: 0 }}>{invoice.invoice_ref}</p>
            <p style={{ fontSize: '13px', color: '#888', margin: '4px 0 0' }}>
              {invoice.carriers?.name}
              {invoice.carriers?.email && <> · <a href={`mailto:${invoice.carriers.email}`} style={{ color: '#f3ca0f', textDecoration: 'none' }}>{invoice.carriers.email}</a></>}
            </p>
            <p style={{ fontSize: '12px', color: '#a0a0a0', margin: '4px 0 0', fontFamily: '"JetBrains Mono", monospace' }}>
              Invoice: {fmtDate(invoice.invoice_date)}
              {invoice.due_date && <> · Due: {fmtDate(invoice.due_date)}</>}
            </p>
          </div>
          <span style={{ ...ss, display: 'inline-block', padding: '4px 12px', borderRadius: '6px', fontSize: '12px', fontFamily: '"JetBrains Mono", monospace', textTransform: 'capitalize', flexShrink: 0 }}>
            {invoice.status}
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '16px', paddingTop: '16px', borderTop: '1px solid #1a1a1a' }}>
          {[
            { label: 'Total Charged', value: aud(total),                   style: {} },
            { label: 'Overcharge',    value: over > 0 ? aud(over) : '—',   style: over > 0 ? { color: '#ff1744' } : {} },
            { label: 'Lines Flagged', value: flagN,                         style: flagN > 0   ? { color: '#ff1744' } : {} },
            { label: 'No Rate Card',  value: noRateN,                       style: noRateN > 0 ? { color: '#f3ca0f' } : {} },
          ].map(({ label, value, style }) => (
            <div key={label}>
              <p style={{ fontSize: '10px', fontFamily: '"JetBrains Mono", monospace', color: '#444', textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>{label}</p>
              <p style={{ fontSize: '20px', fontWeight: 600, color: '#ffffff', margin: '6px 0 0', ...style }}>{value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Line items */}
      <p style={sectionLabel}>Line items</p>
      <div style={{ background: '#0a0a0a', border: '1px solid #1e1e1e', borderRadius: '8px', overflow: 'hidden', marginBottom: '24px' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #1e1e1e' }}>
              {['Description', 'Detail', 'Charged', 'Contracted', 'Variance'].map(h => (
                <th key={h} style={{ padding: '10px 14px', textAlign: ['Charged', 'Contracted', 'Variance'].includes(h) ? 'right' : 'left', fontSize: '10px', fontFamily: '"JetBrains Mono", monospace', color: '#444', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lines.map(line => {
              const variance = lineVariance(line)
              const isOver   = variance != null && variance > 0
              const noRate   = line.contracted_total == null
              return (
                <tr key={line.id} style={{ borderBottom: '1px solid #181818', background: isOver ? 'rgba(239,68,68,0.04)' : 'transparent' }}>
                  <td style={{ padding: '11px 14px', fontSize: '13px', color: '#ffffff' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {isOver  && <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#ff1744', flexShrink: 0 }} />}
                      {noRate && !isOver && <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#f3ca0f', flexShrink: 0 }} />}
                      {line.description}
                    </span>
                  </td>
                  <td style={{ padding: '11px 14px', fontSize: '12px', color: '#666', fontFamily: '"JetBrains Mono", monospace' }}>{line.detail ?? '—'}</td>
                  <td style={{ padding: '11px 14px', fontSize: '13px', color: '#ffffff', textAlign: 'right' }}>{aud(line.charged_total)}</td>
                  <td style={{ padding: '11px 14px', textAlign: 'right' }}>
                    {noRate
                      ? <span style={{ fontSize: '11px', fontFamily: '"JetBrains Mono", monospace', color: '#f3ca0f', background: 'rgba(243,202,15,0.1)', border: '1px solid rgba(243,202,15,0.3)', borderRadius: '4px', padding: '2px 7px' }}>No rate card</span>
                      : <span style={{ fontSize: '13px', color: '#AAA' }}>{aud(line.contracted_total)}</span>}
                  </td>
                  <td style={{ padding: '11px 14px', fontSize: '13px', textAlign: 'right' }}>
                    {variance == null
                      ? <span style={{ color: '#444' }}>—</span>
                      : variance > 0
                        ? <span style={{ color: '#ff1744', fontWeight: 500 }}>+{aud(variance)}</span>
                        : variance < 0
                          ? <span style={{ color: '#4ade80' }}>{aud(variance)}</span>
                          : <span style={{ color: '#444' }}>—</span>}
                  </td>
                </tr>
              )
            })}
            <tr style={{ background: '#0a0a0a' }}>
              <td colSpan={2} style={{ padding: '11px 14px', fontSize: '12px', fontWeight: 600, color: '#888', fontFamily: '"JetBrains Mono", monospace', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total</td>
              <td style={{ padding: '11px 14px', fontSize: '13px', fontWeight: 600, color: '#ffffff', textAlign: 'right' }}>{aud(total)}</td>
              <td />
              <td style={{ padding: '11px 14px', textAlign: 'right' }}>
                {over > 0 ? <span style={{ color: '#ff1744', fontWeight: 600, fontSize: '13px' }}>+{aud(over)}</span> : <span style={{ color: '#444' }}>—</span>}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Status actions */}
      <p style={sectionLabel}>Update status</p>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '24px', alignItems: 'center' }}>
        <ActionBtn label="Approve"         color="#4ade80" borderColor="#4ade80" disabled={updatingStatus || generatingLetter || invoice.status === 'approved'} onClick={() => updateStatus('approved')} />
        <ActionBtn label="Flag for Review" color="#f3ca0f" borderColor="#f3ca0f" disabled={updatingStatus || generatingLetter || invoice.status === 'flagged'}  onClick={() => updateStatus('flagged')} />
        <ActionBtn
          label={generatingLetter ? 'Generating…' : updatingStatus ? 'Raising…' : 'Raise Dispute'}
          color="#ff1744" borderColor="#ff1744"
          disabled={updatingStatus || generatingLetter || invoice.status === 'disputed'}
          onClick={raiseDispute}
        />
        <ActionBtn label="Mark Resolved"   color="#60a5fa" borderColor="#60a5fa" disabled={updatingStatus || generatingLetter || invoice.status === 'resolved'} onClick={() => updateStatus('resolved')} />
        {(updatingStatus || generatingLetter) && <div className="w-4 h-4 rounded-full border animate-spin" style={{ borderColor: '#f3ca0f', borderTopColor: 'transparent' }} />}
      </div>

      {/* Send dispute email — persistent button */}
      {invoice.status === 'disputed' && !hasSent && invoice.carriers?.claims_email && (
        <div style={{ marginBottom: '24px' }}>
          <button
            onClick={openPanelForResend}
            disabled={generatingLetter}
            style={{
              fontSize: '12px', fontWeight: 500, padding: '7px 16px', borderRadius: '6px',
              cursor: generatingLetter ? 'not-allowed' : 'pointer',
              color: '#ff1744', border: '1px solid rgba(239,68,68,0.35)', background: 'transparent',
              opacity: generatingLetter ? 0.6 : 1, transition: 'background 120ms',
            }}
            onMouseEnter={e => { if (!generatingLetter) e.currentTarget.style.background = 'rgba(239,68,68,0.08)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
          >
            {generatingLetter ? 'Generating…' : 'Send dispute email'}
          </button>
        </div>
      )}

      {/* Notes */}
      <p style={sectionLabel}>Notes</p>
      <div style={{ marginBottom: '24px' }}>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="Add internal notes about this invoice…"
          rows={3}
          style={{
            width: '100%', boxSizing: 'border-box', background: '#0a0a0a', border: '1px solid #222222',
            borderRadius: '6px', color: '#ffffff', fontSize: '13px', padding: '10px 12px',
            fontFamily: 'inherit', resize: 'vertical', outline: 'none',
          }}
        />
        <button
          onClick={saveNotes}
          disabled={savingNotes}
          style={{
            marginTop: '8px', fontSize: '12px', fontWeight: 500, padding: '6px 14px',
            borderRadius: '6px', cursor: savingNotes ? 'not-allowed' : 'pointer',
            color: '#f3ca0f', border: '1px solid rgba(243,202,15,0.35)', background: 'transparent',
            opacity: savingNotes ? 0.5 : 1, transition: 'background 120ms',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(243,202,15,0.08)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
        >
          {savingNotes ? 'Saving…' : 'Save notes'}
        </button>
      </div>

      {/* AI dispute letter (existing, unchanged) */}
      {over > 0 && (
        <>
          <p style={sectionLabel}>AI Dispute Letter</p>
          <div style={{ background: '#0a0a0a', border: '1px solid #1e1e1e', borderRadius: '8px', padding: '20px', marginBottom: '24px' }}>
            <p style={{ fontSize: '13px', color: '#888', margin: '0 0 14px' }}>
              <span style={{ color: '#ff1744', fontWeight: 500 }}>{flagN} overcharged line{flagN !== 1 ? 's' : ''}</span>
              {' · '}
              <span style={{ color: '#ffffff' }}>{aud(over)} to recover</span>
            </p>
            <button
              onClick={generateLetter}
              disabled={generatingLetter}
              style={{
                fontSize: '12px', fontWeight: 500, padding: '6px 14px', borderRadius: '6px',
                cursor: generatingLetter ? 'not-allowed' : 'pointer',
                color: '#f3ca0f', border: '1px solid rgba(243,202,15,0.35)', background: 'transparent',
                opacity: generatingLetter ? 0.6 : 1, transition: 'background 120ms',
              }}
              onMouseEnter={e => { if (!generatingLetter) e.currentTarget.style.background = 'rgba(243,202,15,0.08)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
            >
              {generatingLetter ? 'Generating…' : 'Generate letter'}
            </button>

            {letter && (
              <div style={{ marginTop: '16px', background: '#0a0a0a', border: '1px solid #1e1e1e', borderRadius: '6px', padding: '16px' }}>
                <pre style={{ margin: 0, fontSize: '13px', color: '#ffffff', whiteSpace: 'pre-wrap', fontFamily: 'inherit', lineHeight: 1.6 }}>{letter}</pre>
                <button
                  onClick={copyLetter}
                  style={{ marginTop: '12px', fontSize: '11px', fontFamily: '"JetBrains Mono", monospace', color: '#a0a0a0', background: 'none', border: 'none', cursor: 'pointer', padding: 0, transition: 'color 120ms' }}
                  onMouseEnter={e => { e.currentTarget.style.color = '#f3ca0f' }}
                  onMouseLeave={e => { e.currentTarget.style.color = '#555' }}
                >
                  copy letter
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {/* Dispute history */}
      {disputeEmails.length > 0 && (
        <>
          <p style={sectionLabel}>Dispute history</p>
          <div style={{ background: '#0a0a0a', border: '1px solid #1e1e1e', borderRadius: '8px', overflow: 'hidden', marginBottom: '24px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #1e1e1e' }}>
                  {['Sent to', 'Date', 'Status', 'Actions'].map(h => (
                    <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: '10px', fontFamily: '"JetBrains Mono", monospace', color: '#444', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {disputeEmails.map((em) => {
                  const es = EMAIL_STATUS_STYLE[em.status] ?? EMAIL_STATUS_STYLE.sent
                  const isExpanded = expandedEmail === em.id
                  return (
                    <Fragment key={em.id}>
                      <tr
                        style={{ borderBottom: isExpanded ? 'none' : '1px solid #181818', cursor: em.status === 'sent' ? 'pointer' : 'default', transition: 'background 120ms' }}
                        onClick={() => { if (em.status === 'sent') setExpandedEmail(isExpanded ? null : em.id) }}
                        onMouseEnter={e => { if (em.status === 'sent') e.currentTarget.style.background = '#0a0a0a' }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                      >
                        <td style={{ padding: '11px 14px', fontSize: '12px', color: '#888', fontFamily: '"JetBrains Mono", monospace' }}>{em.sent_to ?? '—'}</td>
                        <td style={{ padding: '11px 14px', fontSize: '12px', color: '#666', fontFamily: '"JetBrains Mono", monospace' }}>
                          {fmtDate(em.sent_at?.slice(0, 10))}
                        </td>
                        <td style={{ padding: '11px 14px' }}>
                          <span style={{ ...es, display: 'inline-block', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontFamily: '"JetBrains Mono", monospace', textTransform: 'capitalize' }}>
                            {em.status}
                          </span>
                        </td>
                        <td style={{ padding: '11px 14px' }}>
                          {em.status === 'draft' && (
                            <button
                              onClick={e => { e.stopPropagation(); setPanelLetter(em.letter_text ?? ''); setShowPanel(true) }}
                              style={{ fontSize: '11px', fontFamily: '"JetBrains Mono", monospace', color: '#f3ca0f', background: 'none', border: 'none', cursor: 'pointer', padding: 0, transition: 'opacity 120ms' }}
                              onMouseEnter={e => { e.currentTarget.style.opacity = '0.7' }}
                              onMouseLeave={e => { e.currentTarget.style.opacity = '1' }}
                            >
                              Send now
                            </button>
                          )}
                          {em.status === 'sent' && (
                            <span style={{ fontSize: '11px', fontFamily: '"JetBrains Mono", monospace', color: '#444' }}>
                              {isExpanded ? 'collapse ▲' : 'view ▼'}
                            </span>
                          )}
                        </td>
                      </tr>
                      {isExpanded && em.status === 'sent' && (
                        <tr style={{ borderBottom: '1px solid #181818' }}>
                          <td colSpan={4} style={{ padding: '0 14px 14px' }}>
                            <pre style={{ background: '#0a0a0a', border: '1px solid #1e1e1e', borderRadius: '6px', padding: '14px', margin: 0, fontSize: '12px', color: '#ffffff', whiteSpace: 'pre-wrap', fontFamily: '"JetBrains Mono", monospace', lineHeight: 1.6 }}>
                              {em.letter_text}
                            </pre>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ── Slide-in dispute letter preview panel ─────────────────────────────── */}

      {/* Backdrop */}
      {showPanel && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 40 }}
          onClick={() => setShowPanel(false)}
        />
      )}

      {/* Panel */}
      <div
        style={{
          position: 'fixed', right: 0, top: 0, height: '100%', width: '480px',
          background: '#0a0a0a', borderLeft: '1px solid #1e1e1e',
          transform: showPanel ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 220ms ease',
          zIndex: 50, display: 'flex', flexDirection: 'column',
          boxSizing: 'border-box',
        }}
      >
        {/* Panel header */}
        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid #1e1e1e', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
            <div>
              <p style={{ fontSize: '14px', fontWeight: 600, color: '#ffffff', margin: 0 }}>
                Dispute letter — {invoice.invoice_ref}
              </p>
              {invoice.carriers?.claims_email && (
                <p style={{ fontSize: '12px', color: '#a0a0a0', margin: '4px 0 0', fontFamily: '"JetBrains Mono", monospace' }}>
                  To: {invoice.carriers.claims_email}
                </p>
              )}
            </div>
            <button
              onClick={() => setShowPanel(false)}
              style={{ background: 'none', border: 'none', color: '#a0a0a0', cursor: 'pointer', fontSize: '18px', lineHeight: 1, padding: 0, flexShrink: 0, marginTop: '2px' }}
              onMouseEnter={e => { e.currentTarget.style.color = '#AAA' }}
              onMouseLeave={e => { e.currentTarget.style.color = '#555' }}
            >
              ×
            </button>
          </div>
        </div>

        {/* Letter textarea */}
        <div style={{ flex: 1, padding: '16px 24px', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <textarea
            value={panelLetter}
            onChange={e => setPanelLetter(e.target.value)}
            rows={12}
            style={{
              flex: 1, width: '100%', boxSizing: 'border-box',
              background: '#0a0a0a', border: '1px solid #222222', borderRadius: '6px',
              color: '#ffffff', fontSize: '13px', padding: '14px',
              fontFamily: '"JetBrains Mono", monospace', resize: 'none', outline: 'none',
              lineHeight: 1.7,
            }}
          />
        </div>

        {/* Panel footer */}
        <div style={{ padding: '16px 24px 24px', borderTop: '1px solid #1e1e1e', flexShrink: 0, display: 'flex', gap: '10px' }}>
          <button
            onClick={sendDisputeEmail}
            disabled={panelBusy || !panelLetter.trim()}
            style={{
              flex: 1, fontSize: '13px', fontWeight: 600, padding: '9px 16px', borderRadius: '6px',
              cursor: (panelBusy || !panelLetter.trim()) ? 'not-allowed' : 'pointer',
              color: '#000000', background: (panelBusy || !panelLetter.trim()) ? '#444' : '#ffffff',
              border: 'none', transition: 'background 120ms',
              opacity: (panelBusy || !panelLetter.trim()) ? 0.6 : 1,
            }}
            onMouseEnter={e => { if (!panelBusy && panelLetter.trim()) e.currentTarget.style.background = '#FFF' }}
            onMouseLeave={e => { if (!panelBusy && panelLetter.trim()) e.currentTarget.style.background = '#ffffff' }}
          >
            {panelBusy ? 'Sending…' : `Send to ${invoice.carriers?.name ?? 'carrier'}`}
          </button>
          <button
            onClick={saveDraft}
            disabled={panelBusy || !panelLetter.trim()}
            style={{
              fontSize: '13px', fontWeight: 500, padding: '9px 16px', borderRadius: '6px',
              cursor: (panelBusy || !panelLetter.trim()) ? 'not-allowed' : 'pointer',
              color: '#888', border: '1px solid #222222', background: 'transparent',
              transition: 'border-color 120ms, color 120ms',
              opacity: (panelBusy || !panelLetter.trim()) ? 0.6 : 1,
            }}
            onMouseEnter={e => { if (!panelBusy) { e.currentTarget.style.color = '#ffffff'; e.currentTarget.style.borderColor = '#555' } }}
            onMouseLeave={e => { e.currentTarget.style.color = '#888'; e.currentTarget.style.borderColor = '#222222' }}
          >
            Save draft — send later
          </button>
        </div>
      </div>
    </div>
  )
}
