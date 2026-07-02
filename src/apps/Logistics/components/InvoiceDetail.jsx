import { useEffect, useState, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '@portal/lib/supabase'
import LogisticsNav from './LogisticsNav.jsx'
import DisputeLetterPanel from './DisputeLetterPanel.jsx'
import TntQueryPanel from './TntQueryPanel.jsx'
import { aud, fmtDate, lineVariance, invoiceOvercharge, invoiceTotal } from '../utils/helpers.js'
import {
  pageWrap, card, mono, sectionLabel, thStyle, tdStyle,
  Badge, Spinner, Flash, useFlash, INVOICE_STATUS_STYLE, DISPUTE_STATUS_STYLE, HoverBtn, btnGhost, rowHover,
  displayStatus, Modal,
} from '../utils/ui.jsx'

function ActionBtn({ label, color, disabled, onClick }) {
  const [hover, setHover] = useState(false)
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        fontSize: '12px', fontWeight: 500, padding: '6px 14px', borderRadius: '6px',
        cursor: disabled ? 'not-allowed' : 'pointer', transition: 'background 120ms',
        color: disabled ? 'var(--text-disabled)' : `var(${color})`,
        border: `1px solid ${disabled ? 'var(--border-default)' : (hover ? `var(${color})` : 'var(--border-default)')}`,
        background: hover && !disabled ? `rgba(var(${color}-rgb),0.08)` : 'transparent',
        opacity: disabled ? 0.5 : 1,
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {label}
    </button>
  )
}

const MATCH_DOT = {
  matched: null,                    // clean — no dot
  no_rate: 'var(--brand-accent)',
  skipped: null,
}

// TNT's published MHP criteria — quoted back to the carrier in dispute
// letters when an MHP fee is challenged.
const TNT_MHP_TERMS = `Manual Handling Processing (MHP) Fee: The MHP Fee is $16.50 per item on items that TNT determines are not compatible with TNT's sortation system and require manual handling, which includes size, weight, fragility (including glass), poor packaging, where the parcel is unstable due to poor weight distribution, liquids, unusual shape (including tubes, cylinders, flat pack items, tyres, drums, fabric rolls) and Dangerous Goods.
Size criteria: Length <200mm or >1200mm and/or Width <100mm or >600mm and/or Height <15mm or >800mm and/or Diagonal Length >1200mm.
Weight criteria: Weight <250g or >30kg.
The MHP fee is charged per item, in addition to any other applicable surcharge for the consignment.`

export default function InvoiceDetail() {
  const { id } = useParams()
  const navigate = useNavigate()

  const [invoice,     setInvoice]     = useState(null)
  const [disputes,    setDisputes]    = useState([])
  const [loading,     setLoading]     = useState(true)
  const [notes,       setNotes]       = useState('')
  const [savingNotes, setSavingNotes] = useState(false)
  const notesDirty = useRef(false)    // typed-but-unsaved notes must survive refetches
  const [busy,        setBusy]        = useState(false)   // status updates / matching / letter gen
  const [busyLabel,   setBusyLabel]   = useState('')
  const [msg,         flash]          = useFlash()

  // Delete confirmation
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting,         setDeleting]         = useState(false)

  // TNT query panel (TNT disputes are lodged via TNT's web form, per query)
  const [showTntPanel,   setShowTntPanel]   = useState(false)
  const [tntDispute,     setTntDispute]     = useState(null)

  // Dispute letter panel
  const [showPanel,       setShowPanel]       = useState(false)
  const [panelDisputeId,  setPanelDisputeId]  = useState(null)
  const [panelLetter,     setPanelLetter]     = useState('')
  const [panelBusy,       setPanelBusy]       = useState(false)
  const [noClaimsWarning, setNoClaimsWarning] = useState(false)

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
      if (!notesDirty.current) setNotes(sorted.notes ?? '')
    }
    setLoading(false)
  }

  const fetchDisputes = async () => {
    if (!id) return
    const { data } = await supabase
      .from('disputes')
      .select('*, dispute_events(*)')
      .eq('invoice_id', id)
      .order('created_at', { ascending: false })
    if (data) setDisputes(data)
  }

  useEffect(() => { notesDirty.current = false; setLoading(true); fetchInvoice(); fetchDisputes() }, [id])

  const withBusy = async (label, fn) => {
    setBusy(true); setBusyLabel(label)
    try { await fn() } finally { setBusy(false); setBusyLabel('') }
  }

  // ─── Rate engine ─────────────────────────────────────────────────────────────

  const runMatch = () => withBusy('Checking rates…', async () => {
    const { data, error } = await supabase.functions.invoke('logistics-match-invoice', { body: { invoice_id: id } })
    if (error || data?.error) { flash('err', data?.error ?? error.message); return }
    const weightBit = (data.ss_booked > 0 || data.weights_checked > 0)
      ? ` · ${data.ss_booked ?? 0} priced from ShipStation bookings${data.overbilled > 0 ? ` (${data.overbilled} weight OVERBILLED)` : ''}`
      : ''
    flash('ok', `Checked: ${data.matched} priced, ${data.no_rate} no baseline${data.overcharge_aud > 0 ? ` — ${aud(data.overcharge_aud)} overcharged` : ' — no overcharge'}${weightBit}`)
    await fetchInvoice()
  })

  // ─── Status ──────────────────────────────────────────────────────────────────

  const updateStatus = (status) => withBusy('Updating…', async () => {
    const { error } = await supabase.from('freight_invoices').update({ status }).eq('id', invoice.id)
    if (error) { flash('err', error.message); return }
    flash('ok', `Status updated to ${status}`)
    await fetchInvoice()
  })

  // ─── Disputes ────────────────────────────────────────────────────────────────

  const generateLetter = async (inv) => {
    const lines = inv.freight_invoice_lines ?? []
    const flaggedLines = lines
      .filter(l => { const v = lineVariance(l); return v != null && v > 0 })
      .map(l => {
        // Weight discrepancies carry the strongest evidence — cite our
        // ShipStation weight/dims against the carrier's billed weight.
        const weightNote = l.weight_check === 'overbilled'
          ? ` [billed at ${l.weight_kg}kg but actual chargeable weight is ${l.chargeable_weight_kg}kg per our dispatch records (${l.actual_weight_kg}kg dead weight${l.actual_cubic_m3 ? `, ${l.actual_cubic_m3}m³ cubic` : ''})]`
          : ''
        const bookedNote = l.expected_source === 'shipstation' && l.booked_cost != null && l.fee_check == null
          ? ` [quoted/booked at $${Number(l.booked_cost).toFixed(2)} in our freight system at dispatch]`
          : ''
        const mhpNote = l.fee_check === 'mhp_unjustified'
          ? ` [MHP fee challenged: our dispatch records show this item is sortation-compatible (${l.actual_dims ?? 'dims on file'}, ${l.actual_weight_kg != null ? `${(l.actual_weight_kg * 1000).toFixed(0)}g` : 'weight on file'}) — within TNT's published MHP size/weight parameters, so the manual handling fee does not apply]`
          : ''
        const conNote = l.tracking_ref ? ` — con note ${l.tracking_ref}` : ''
        return { description: l.description, detail: `${l.detail ?? ''}${weightNote}${bookedNote}${mhpNote}${conNote}`, variance_aud: lineVariance(l) }
      })
    // Quote the carrier's own published terms back when challenged MHP fees
    // are part of the dispute
    const hasMhpChallenge = lines.some(l => l.fee_check === 'mhp_unjustified')
    const { data, error } = await supabase.functions.invoke('generate-dispute-letter', {
      body: {
        invoice_ref:          inv.invoice_ref,
        carrier_name:         inv.carriers?.name ?? '',
        invoice_date:         inv.invoice_date,
        flagged_lines:        flaggedLines,
        total_overcharge_aud: invoiceOvercharge(lines),
        carrier_terms:        hasMhpChallenge ? TNT_MHP_TERMS : null,
      },
    })
    if (error || data?.error) throw new Error(data?.error ?? error.message)
    return data.letter ?? ''
  }

  const isTnt = /tnt|fedex/i.test(invoice?.carriers?.name ?? '')

  const raiseDispute = () => withBusy('Raising dispute…', async () => {
    // Reuse an open draft if one exists
    const draft = disputes.find(d => d.status === 'draft')
    if (draft) {
      if (isTnt) { setTntDispute(draft); setShowTntPanel(true); return }
      setPanelDisputeId(draft.id)
      setPanelLetter(draft.letter_text ?? '')
      setShowPanel(true)
      return
    }

    const over = invoiceOvercharge(invoice.freight_invoice_lines ?? [])
    const { data: { user } } = await supabase.auth.getUser()
    const { data: dispute, error } = await supabase.from('disputes').insert({
      invoice_id:     invoice.id,
      amount_claimed: over,
      created_by:     user?.id ?? null,
    }).select().single()
    if (error) { flash('err', error.message); return }

    await supabase.from('dispute_events').insert({
      dispute_id: dispute.id,
      event_type: 'created',
      detail:     `Dispute raised — ${aud(over)} claimed`,
      amount:     over,
      created_by: user?.id ?? null,
    })
    await supabase.from('freight_invoices').update({ status: 'disputed' }).eq('id', invoice.id)
    await Promise.all([fetchInvoice(), fetchDisputes()])

    // TNT: disputes are lodged via TNT's invoice-query form, per query
    if (isTnt) {
      setTntDispute(dispute)
      setShowTntPanel(true)
      return
    }

    if (!invoice.carriers?.claims_email) { setNoClaimsWarning(true) }

    try {
      const letter = await generateLetter(invoice)
      await supabase.from('disputes').update({ letter_text: letter }).eq('id', dispute.id)
      await supabase.from('dispute_events').insert({ dispute_id: dispute.id, event_type: 'letter_generated', detail: 'AI dispute letter generated', created_by: user?.id ?? null })
      setPanelDisputeId(dispute.id)
      setPanelLetter(letter)
      setShowPanel(true)
    } catch (err) {
      flash('err', `Dispute created but letter generation failed: ${err.message}`)
    }
  })

  const reopenPanel = (dispute) => {
    if (isTnt) { setTntDispute(dispute); setShowTntPanel(true); return }
    setPanelDisputeId(dispute.id)
    setPanelLetter(dispute.letter_text ?? '')
    setShowPanel(true)
  }

  const saveDraft = async () => {
    setPanelBusy(true)
    const { error } = await supabase.from('disputes').update({ letter_text: panelLetter }).eq('id', panelDisputeId)
    setPanelBusy(false)
    if (error) { flash('err', error.message); return }
    setShowPanel(false)
    flash('ok', 'Draft saved')
    fetchDisputes()
  }

  // The email is sent from the user's own mail client (fields copied from the
  // panel) — this records it and moves the dispute along the pipeline.
  const markSent = async () => {
    setPanelBusy(true)
    const { data: { user } } = await supabase.auth.getUser()
    const { error } = await supabase.from('disputes').update({
      status: 'sent',
      sent_to: invoice.carriers?.claims_email ?? null,
      sent_at: new Date().toISOString(),
      letter_text: panelLetter,
    }).eq('id', panelDisputeId)
    setPanelBusy(false)
    if (error) { flash('err', error.message); return }
    await supabase.from('dispute_events').insert({
      dispute_id: panelDisputeId,
      event_type: 'email_sent',
      detail: `Dispute email sent manually${invoice.carriers?.claims_email ? ` to ${invoice.carriers.claims_email}` : ''}`,
      created_by: user?.id ?? null,
    })
    flash('ok', 'Dispute marked as sent')
    setShowPanel(false)
    Promise.all([fetchInvoice(), fetchDisputes()])
  }

  // ─── Delete ──────────────────────────────────────────────────────────────────

  const deleteInvoice = async () => {
    setDeleting(true)
    const { error } = await supabase.from('freight_invoices').delete().eq('id', invoice.id)
    setDeleting(false)
    if (error) { flash('err', error.message); setConfirmingDelete(false); return }
    navigate('/logistics/invoices')
  }

  // ─── Notes ───────────────────────────────────────────────────────────────────

  const saveNotes = async () => {
    setSavingNotes(true)
    const { error } = await supabase.from('freight_invoices').update({ notes }).eq('id', invoice.id)
    setSavingNotes(false)
    if (error) { flash('err', error.message); return }
    notesDirty.current = false
    flash('ok', 'Notes saved')
  }

  // ─── Render ──────────────────────────────────────────────────────────────────

  if (loading) return <Spinner />
  if (!invoice) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-disabled)', fontFamily: mono, fontSize: '13px' }}>
        Invoice not found.
      </div>
    )
  }

  const lines   = invoice.freight_invoice_lines ?? []
  const total   = invoiceTotal(lines)
  const over    = invoiceOvercharge(lines)
  const flagN   = lines.filter(l => { const v = lineVariance(l); return v != null && v > 0 }).length
  const noRateN = lines.filter(l => l.match_status === 'no_rate').length
  const overbilledN = lines.filter(l => l.weight_check === 'overbilled').length

  return (
    <div style={pageWrap}>
      <div style={{ marginBottom: '24px' }}>
        <button
          onClick={() => navigate('/logistics/invoices')}
          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: '12px', fontFamily: mono, color: 'var(--text-tertiary)', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '4px', transition: 'color 120ms' }}
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-secondary)' }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-tertiary)' }}
        >
          ← Invoices
        </button>
        <h1 style={{ fontSize: '18px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>Invoice Detail</h1>
        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '4px 0 0', fontFamily: mono }}>Review, rate-check and dispute carrier invoices</p>
      </div>

      <LogisticsNav />
      <Flash msg={msg} />

      {noClaimsWarning && (
        <div style={{ marginBottom: '16px', padding: '10px 14px', borderRadius: '6px', fontSize: '12px', fontFamily: mono,
          background: 'rgba(var(--brand-accent-rgb),0.08)', border: '1px solid rgba(var(--brand-accent-rgb),0.3)', color: 'var(--brand-accent)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
          <span>No claims email set for this carrier — add one in the Carriers tab before sending.</span>
          <button onClick={() => setNoClaimsWarning(false)} style={{ background: 'none', border: 'none', color: 'var(--brand-accent)', cursor: 'pointer', fontSize: '14px', lineHeight: 1, padding: 0 }}>×</button>
        </div>
      )}

      {/* Header card */}
      <div style={{ ...card, padding: '20px', marginBottom: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap', marginBottom: '20px' }}>
          <div>
            <p style={{ fontSize: '22px', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>{invoice.invoice_ref}</p>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '4px 0 0' }}>
              {invoice.carriers?.name}
              {invoice.carriers?.email && <> · <a href={`mailto:${invoice.carriers.email}`} style={{ color: 'var(--brand-accent)', textDecoration: 'none' }}>{invoice.carriers.email}</a></>}
            </p>
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '4px 0 0', fontFamily: mono }}>
              Invoice: {fmtDate(invoice.invoice_date)}
              {invoice.due_date && <> · Due: {fmtDate(invoice.due_date)}</>}
              {invoice.matched_at && <> · Rate-checked {new Date(invoice.matched_at).toLocaleDateString('en-AU')}</>}
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
            <HoverBtn onClick={runMatch} disabled={busy}>{busyLabel === 'Checking rates…' ? 'Checking…' : 'Run rate check'}</HoverBtn>
            <Badge map={INVOICE_STATUS_STYLE} value={displayStatus(invoice.status)} />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '16px', paddingTop: '16px', borderTop: '1px solid var(--border-subtle)' }}>
          {[
            { label: 'Total Charged', value: aud(total),                 style: {} },
            { label: 'Overcharge',    value: over > 0 ? aud(over) : '—', style: over > 0 ? { color: 'var(--brand-pink)' } : {} },
            { label: 'Lines Flagged', value: flagN,                      style: flagN > 0   ? { color: 'var(--brand-pink)' } : {} },
            { label: 'Weight Overbilled', value: overbilledN,            style: overbilledN > 0 ? { color: 'var(--brand-pink)' } : {} },
            { label: 'No Rate Match', value: noRateN,                    style: noRateN > 0 ? { color: 'var(--brand-accent)' } : {} },
          ].map(({ label, value, style }) => (
            <div key={label}>
              <p style={{ fontSize: '10px', fontFamily: mono, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>{label}</p>
              <p style={{ fontSize: '20px', fontWeight: 600, color: 'var(--text-primary)', margin: '6px 0 0', ...style }}>{value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Line items */}
      <p style={sectionLabel}>Line items</p>
      <div style={{ ...card, overflowX: 'auto', marginBottom: '24px' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '640px' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              {['Description', 'Service / Lane', 'Weight / Qty', 'Charged', 'Expected', 'Variance'].map(h => (
                <th key={h} style={thStyle(['Charged', 'Expected', 'Variance'].includes(h))}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lines.map(line => {
              const variance = lineVariance(line)
              const isOver   = variance != null && variance > 0.005
              const dot      = isOver ? 'var(--brand-pink)' : MATCH_DOT[line.match_status]
              return (
                <tr key={line.id} style={{ borderBottom: '1px solid var(--border-subtle)', background: isOver ? 'rgba(var(--brand-pink-rgb),0.04)' : 'transparent' }}>
                  <td style={{ ...tdStyle, color: 'var(--text-primary)' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {dot && <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: dot, flexShrink: 0 }} />}
                      {line.description}
                    </span>
                    {line.detail && <span style={{ display: 'block', fontSize: '11px', color: 'var(--text-tertiary)', fontFamily: mono, marginTop: '2px' }}>{line.detail}</span>}
                  </td>
                  <td style={{ ...tdStyle, fontSize: '12px', color: 'var(--text-tertiary)', fontFamily: mono }}>
                    {line.service ?? '—'}
                    {(line.origin || line.destination) && <span> · {line.origin ?? '?'} → {line.destination ?? '?'}</span>}
                  </td>
                  <td style={{ ...tdStyle, fontSize: '12px', fontFamily: mono }}>
                    <span style={{ color: line.weight_check === 'overbilled' ? 'var(--brand-pink)' : 'var(--text-secondary)' }}>
                      {[line.weight_kg != null ? `${line.weight_kg}kg` : null, line.qty != null ? `×${line.qty}` : null].filter(Boolean).join(' · ') || '—'}
                    </span>
                    {line.weight_check === 'overbilled' && (
                      <span style={{ display: 'block', fontSize: '11px', color: 'var(--brand-aqua)', marginTop: '2px' }}>
                        actual {line.chargeable_weight_kg}kg (SS)
                      </span>
                    )}
                    {line.weight_check === 'ok' && (
                      <span style={{ display: 'block', fontSize: '10px', color: 'var(--text-disabled)', marginTop: '2px' }}>✓ verified</span>
                    )}
                    {line.weight_check === 'unmatched' && line.tracking_ref && (
                      <span style={{ display: 'block', fontSize: '10px', color: 'var(--text-disabled)', marginTop: '2px' }}>not in SS</span>
                    )}
                  </td>
                  <td style={{ ...tdStyle, color: 'var(--text-primary)', textAlign: 'right' }}>{aud(line.charged_total)}</td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>
                    {line.match_status === 'no_rate'
                      ? <span style={{ fontSize: '11px', fontFamily: mono, color: 'var(--brand-accent)', background: 'rgba(var(--brand-accent-rgb),0.1)', border: '1px solid rgba(var(--brand-accent-rgb),0.3)', borderRadius: '4px', padding: '2px 7px', whiteSpace: 'nowrap' }}>No baseline</span>
                      : line.match_status === 'skipped'
                        ? <span style={{ fontSize: '11px', fontFamily: mono, color: 'var(--text-disabled)' }}>n/a</span>
                        : (
                          <>
                            <span style={{ color: 'var(--text-secondary)' }}>{aud(line.expected_total)}</span>
                            {line.fee_check === 'mhp_unjustified' ? (
                              <span style={{ display: 'block', fontSize: '10px', fontFamily: mono, color: 'var(--brand-pink)', marginTop: '2px' }}>MHP challenged</span>
                            ) : line.fee_check === 'mhp_ok' ? (
                              <span style={{ display: 'block', fontSize: '10px', fontFamily: mono, color: 'var(--text-disabled)', marginTop: '2px' }}>MHP valid</span>
                            ) : line.expected_source && (
                              <span style={{ display: 'block', fontSize: '10px', fontFamily: mono, color: 'var(--text-disabled)', marginTop: '2px' }}>
                                {line.expected_source === 'shipstation' ? 'booked (SS)' : 'fuel levy %'}
                              </span>
                            )}
                          </>
                        )}
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>
                    {variance == null
                      ? <span style={{ color: 'var(--text-disabled)' }}>—</span>
                      : variance > 0.005
                        ? <span style={{ color: 'var(--brand-pink)', fontWeight: 500 }}>+{aud(variance)}</span>
                        : variance < -0.005
                          ? <span style={{ color: 'var(--brand-aqua)' }}>{aud(variance)}</span>
                          : <span style={{ color: 'var(--text-disabled)' }}>—</span>}
                  </td>
                </tr>
              )
            })}
            <tr>
              <td colSpan={3} style={{ ...tdStyle, fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', fontFamily: mono, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total</td>
              <td style={{ ...tdStyle, fontWeight: 600, color: 'var(--text-primary)', textAlign: 'right' }}>{aud(total)}</td>
              <td />
              <td style={{ ...tdStyle, textAlign: 'right' }}>
                {over > 0 ? <span style={{ color: 'var(--brand-pink)', fontWeight: 600 }}>+{aud(over)}</span> : <span style={{ color: 'var(--text-disabled)' }}>—</span>}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Status actions */}
      <p style={sectionLabel}>Actions</p>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '24px', alignItems: 'center' }}>
        <ActionBtn label="Approve"       color="--brand-aqua"   disabled={busy || invoice.status === 'approved'} onClick={() => updateStatus('approved')} />
        <ActionBtn label="Flag for Review" color="--brand-accent" disabled={busy || invoice.status === 'flagged'} onClick={() => updateStatus('flagged')} />
        <ActionBtn
          label={busyLabel === 'Raising dispute…' ? 'Raising…' : 'Raise Dispute'}
          color="--brand-pink"
          disabled={busy || over <= 0}
          onClick={raiseDispute}
        />
        <ActionBtn label="Mark Resolved" color="--brand-aqua" disabled={busy || invoice.status === 'resolved'} onClick={() => updateStatus('resolved')} />
        <ActionBtn label="Delete" color="--brand-pink" disabled={busy} onClick={() => setConfirmingDelete(true)} />
        {busy && <div className="w-4 h-4 rounded-full border animate-spin" style={{ borderColor: 'var(--brand-accent)', borderTopColor: 'transparent' }} />}
        {over <= 0 && <span style={{ fontSize: '11px', fontFamily: mono, color: 'var(--text-disabled)' }}>Disputes need a detected overcharge — run the rate check first</span>}
      </div>

      {/* Disputes on this invoice */}
      {disputes.length > 0 && (
        <>
          <p style={sectionLabel}>Disputes</p>
          <div style={{ ...card, overflow: 'hidden', marginBottom: '24px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  {['Raised', 'Status', 'Claimed', 'Recovered', 'Sent to', ''].map((h, i) => (
                    <th key={i} style={thStyle(h === 'Claimed' || h === 'Recovered')}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {disputes.map(d => (
                  <tr
                    key={d.id}
                    style={{ borderBottom: '1px solid var(--border-subtle)', cursor: 'pointer', transition: 'background 120ms' }}
                    onClick={() => navigate('/logistics/disputes')}
                    {...rowHover}
                  >
                    <td style={{ ...tdStyle, fontSize: '12px', fontFamily: mono, color: 'var(--text-tertiary)' }}>{fmtDate(d.created_at?.slice(0, 10))}</td>
                    <td style={tdStyle}><Badge map={DISPUTE_STATUS_STYLE} value={d.status} /></td>
                    <td style={{ ...tdStyle, textAlign: 'right', color: 'var(--text-primary)' }}>{aud(Number(d.amount_claimed))}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                      {Number(d.amount_recovered) > 0
                        ? <span style={{ color: 'var(--brand-aqua)', fontWeight: 500 }}>{aud(Number(d.amount_recovered))}</span>
                        : <span style={{ color: 'var(--text-disabled)' }}>—</span>}
                    </td>
                    <td style={{ ...tdStyle, fontSize: '12px', fontFamily: mono, color: 'var(--text-secondary)' }}>{d.sent_to ?? '—'}</td>
                    <td style={tdStyle}>
                      {(d.status === 'draft' || (isTnt && d.status === 'sent')) && (
                        <button
                          onClick={e => { e.stopPropagation(); reopenPanel(d) }}
                          style={{ fontSize: '11px', fontFamily: mono, color: 'var(--brand-accent)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                        >
                          {isTnt ? 'Queries' : 'Edit & send'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Notes */}
      <p style={sectionLabel}>Notes</p>
      <div style={{ marginBottom: '24px' }}>
        <textarea
          value={notes}
          onChange={e => { notesDirty.current = true; setNotes(e.target.value) }}
          placeholder="Add internal notes about this invoice…"
          rows={3}
          style={{
            width: '100%', boxSizing: 'border-box', background: 'var(--bg-surface)', border: '1px solid var(--border-default)',
            borderRadius: '6px', color: 'var(--text-primary)', fontSize: '13px', padding: '10px 12px',
            fontFamily: 'inherit', resize: 'vertical', outline: 'none',
          }}
        />
        <div style={{ marginTop: '8px' }}>
          <HoverBtn onClick={saveNotes} disabled={savingNotes}>{savingNotes ? 'Saving…' : 'Save notes'}</HoverBtn>
        </div>
      </div>

      {/* ── Delete confirmation ───────────────────────────────────────────────── */}
      <Modal open={confirmingDelete} onClose={() => { if (!deleting) setConfirmingDelete(false) }} width={400}>
        <p style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 6px' }}>Delete {invoice.invoice_ref}?</p>
        <p style={{ fontSize: '12px', color: 'var(--text-secondary)', fontFamily: mono, margin: '0 0 18px' }}>
          Removes the invoice, its line items and any disputes raised on it. This cannot be undone.
        </p>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={deleteInvoice}
            disabled={deleting}
            style={{ fontSize: '12px', fontWeight: 500, padding: '6px 14px', borderRadius: '6px', cursor: deleting ? 'not-allowed' : 'pointer', color: 'var(--brand-pink)', border: '1px solid rgba(var(--brand-pink-rgb),0.4)', background: 'transparent', opacity: deleting ? 0.5 : 1 }}
            onMouseEnter={e => { if (!deleting) e.currentTarget.style.background = 'rgba(var(--brand-pink-rgb),0.08)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
          >
            {deleting ? 'Deleting…' : 'Delete invoice'}
          </button>
          <button onClick={() => setConfirmingDelete(false)} disabled={deleting} style={btnGhost}>Cancel</button>
        </div>
      </Modal>

      {/* ── TNT per-query submission panel ────────────────────────────────────── */}
      <TntQueryPanel
        open={showTntPanel}
        onClose={() => setShowTntPanel(false)}
        invoice={invoice}
        dispute={tntDispute}
        onChange={() => { fetchInvoice(); fetchDisputes() }}
      />

      {/* ── Slide-in dispute letter panel (non-TNT carriers) ──────────────────── */}
      <DisputeLetterPanel
        open={showPanel}
        onClose={() => setShowPanel(false)}
        invoiceRef={invoice.invoice_ref}
        carrierName={invoice.carriers?.name}
        claimsEmail={invoice.carriers?.claims_email}
        claimsCc={invoice.carriers?.claims_cc}
        letter={panelLetter}
        setLetter={setPanelLetter}
        busy={panelBusy}
        onMarkSent={markSent}
        onSaveDraft={saveDraft}
      />
    </div>
  )
}
