import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import * as pdfjsLib from 'pdfjs-dist'
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { supabase } from '@portal/lib/supabase'
import { DatePicker } from '@portal/components/DatePicker'
import LogisticsNav from './LogisticsNav.jsx'
import { aud, fmtDate, invoiceTotal, invoiceOvercharge, parseDelimitedText, parseMoney, missingInvoicePeriods } from '../utils/helpers.js'
import { useIsMobile } from '../../../hooks/useIsMobile.js'
import {
  pageWrap, card, mono, thStyle, tdStyle, inputStyle, btnGhost,
  Badge, Spinner, Flash, useFlash, INVOICE_STATUS_STYLE, PageHeader, HoverBtn, Modal, FieldLabel, rowHover,
} from '../utils/ui.jsx'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker

// ─── CSV invoice parser ───────────────────────────────────────────────────────
// Required: description, charged_total. Optional structured columns feed the
// rate engine: service, origin, destination, weight_kg, qty, detail, tracking.
function parseCsvLines(text) {
  const allRows = parseDelimitedText(text)
  if (allRows.length < 2) return { rows: [], error: 'CSV has no data rows' }

  const headers = allRows[0].map(h => h.trim().toLowerCase())
  if (!headers.includes('description') || !headers.includes('charged_total')) {
    return { rows: [], error: 'Missing required columns: description, charged_total' }
  }

  const idx = k => headers.indexOf(k)
  const cell = (cells, k) => (idx(k) !== -1 ? (cells[idx(k)] ?? '').trim() : '')
  const rows = []
  let skipped = 0
  for (let i = 1; i < allRows.length; i++) {
    const cells = allRows[i]
    const description   = cell(cells, 'description')
    const charged_total = parseMoney(cell(cells, 'charged_total'))
    if (!description || isNaN(charged_total)) { skipped++; continue }
    const weight = parseMoney(cell(cells, 'weight_kg'))
    const qty    = parseInt(cell(cells, 'qty'), 10)
    rows.push({
      description,
      detail:      cell(cells, 'detail') || null,
      service:     cell(cells, 'service') || null,
      origin:      cell(cells, 'origin') || null,
      destination: cell(cells, 'destination') || null,
      weight_kg:   isNaN(weight) ? null : weight,
      qty:         isNaN(qty) ? null : qty,
      tracking:    cell(cells, 'tracking') || null,
      charged_total,
    })
  }
  return { rows, skipped }
}

async function extractPdfText(buffer) {
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise
  let text = ''
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p)
    const content = await page.getTextContent()
    text += content.items.map(i => i.str).join(' ') + '\n'
  }
  return text
}

const ALL_STATUSES = ['pending', 'matched', 'flagged', 'disputed', 'approved', 'resolved']

function SelectFilter({ label, value, onChange, options }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      style={{
        background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: '6px',
        color: 'var(--text-secondary)', fontSize: '12px', fontFamily: mono,
        padding: '6px 10px', cursor: 'pointer', outline: 'none',
      }}
    >
      <option value="all">{label}</option>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

// Red banner listing expected-but-missing billing periods per tracked carrier
// (weekly/monthly cadence set in the Carriers tab; anchored at 03/01/2026).
function MissingInvoices({ carriers, invoices }) {
  const groups = missingInvoicePeriods(carriers, invoices)
  if (!groups.length) return null
  const total = groups.reduce((s, g) => s + g.missing.length, 0)
  return (
    <div style={{
      marginBottom: '20px', padding: '14px 16px', borderRadius: '8px',
      background: 'rgba(var(--brand-pink-rgb),0.07)', border: '1px solid rgba(var(--brand-pink-rgb),0.35)',
    }}>
      <p style={{ margin: '0 0 10px', fontSize: '13px', fontWeight: 600, color: 'var(--brand-pink)' }}>
        {total} missing invoice{total !== 1 ? 's' : ''} <span style={{ fontWeight: 400, fontFamily: mono, fontSize: '11px' }}>· expected billing periods since 03/01/2026 with no invoice loaded</span>
      </p>
      {groups.map(g => (
        <div key={g.carrier} style={{ display: 'flex', gap: '8px', alignItems: 'baseline', flexWrap: 'wrap', marginBottom: '6px' }}>
          <span style={{ fontSize: '12px', color: 'var(--text-primary)', fontWeight: 500, flexShrink: 0 }}>
            {g.carrier} <span style={{ color: 'var(--text-tertiary)', fontFamily: mono, fontSize: '11px' }}>({g.frequency}, {g.missing.length})</span>
          </span>
          <span style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
            {g.missing.map(p => (
              <span key={p} style={{ fontSize: '11px', fontFamily: mono, color: 'var(--brand-pink)', background: 'rgba(var(--brand-pink-rgb),0.12)', border: '1px solid rgba(var(--brand-pink-rgb),0.3)', borderRadius: '4px', padding: '1px 7px', whiteSpace: 'nowrap' }}>
                {p}
              </span>
            ))}
          </span>
        </div>
      ))}
    </div>
  )
}

export default function InvoiceList() {
  const [invoices,      setInvoices]      = useState([])
  const [carriers,      setCarriers]      = useState([])
  const [statusFilter,  setStatusFilter]  = useState('all')
  const [carrierFilter, setCarrierFilter] = useState('all')
  const [loading,       setLoading]       = useState(true)
  const [msg,           flash]            = useFlash()
  const navigate = useNavigate()
  const isMobile = useIsMobile()

  // Upload modal
  const [uploadModal,     setUploadModal]     = useState(false)
  const [uploadStep,      setUploadStep]      = useState('form')   // form | done
  const [uploadCarrierId, setUploadCarrierId] = useState('')
  const [uploadInvRef,    setUploadInvRef]    = useState('')
  const [uploadInvDate,   setUploadInvDate]   = useState('')
  const [uploadDueDate,   setUploadDueDate]   = useState('')
  const [uploadParsing,   setUploadParsing]   = useState(false)
  const [uploadPreview,   setUploadPreview]   = useState(null)
  const [uploadError,     setUploadError]     = useState(null)
  const [uploading,       setUploading]       = useState(false)
  const [uploadResult,    setUploadResult]    = useState(null)    // { ref, lines, match }
  const parseTokenRef = useRef(0)

  const fetchInvoices = () =>
    supabase.from('freight_invoices').select('*, carriers(*), freight_invoice_lines(*)').order('invoice_date', { ascending: false })
      .then(({ data }) => { if (data) setInvoices(data) })

  useEffect(() => {
    Promise.all([
      fetchInvoices(),
      supabase.from('carriers').select('*').order('name').then(({ data }) => { if (data) setCarriers(data) }),
    ]).finally(() => setLoading(false))
  }, [])

  const openUploadModal = () => {
    setUploadModal(true)
    setUploadStep('form')
    setUploadCarrierId('')
    setUploadInvRef('')
    setUploadInvDate('')
    setUploadDueDate('')
    setUploadPreview(null)
    setUploadError(null)
    setUploadResult(null)
  }

  const closeUploadModal = () => {
    if (uploading) return
    setUploadModal(false)
    if (uploadResult) fetchInvoices()
  }

  const handleFileChange = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    setUploadError(null)
    setUploadPreview(null)

    const ext = file.name.split('.').pop().toLowerCase()

    if (ext === 'csv') {
      const text = await file.text()
      const { rows, skipped = 0, error } = parseCsvLines(text)
      if (error) { setUploadError(error); return }
      if (!rows.length) { setUploadError(`No valid line items found in CSV${skipped ? ` (${skipped} skipped)` : ''}`); return }
      setUploadPreview({ lines: rows, _skipped: skipped, _source: 'csv' })
    } else if (ext === 'pdf') {
      const token = ++parseTokenRef.current
      setUploadParsing(true)
      try {
        const buffer = await file.arrayBuffer()
        const text = await extractPdfText(new Uint8Array(buffer))
        const { data: result, error: fnErr } = await supabase.functions.invoke('logistics-parse-invoice', { body: { text } })
        if (parseTokenRef.current !== token) return  // stale — a newer file was selected
        if (fnErr || result?.error) { setUploadError(result?.error ?? fnErr?.message ?? 'Failed to parse PDF'); return }
        setUploadPreview({ ...result, _source: 'pdf' })
        if (result.invoice_ref)  setUploadInvRef(result.invoice_ref)
        if (result.invoice_date) setUploadInvDate(result.invoice_date)
        if (result.due_date)     setUploadDueDate(result.due_date)
        if (result.carrier_name) {
          const match = carriers.find(c => c.name.toLowerCase().includes(result.carrier_name.toLowerCase()) || result.carrier_name.toLowerCase().includes(c.name.toLowerCase()))
          if (match) setUploadCarrierId(match.id)
        }
      } catch (err) {
        if (parseTokenRef.current === token) setUploadError(err.message)
      } finally {
        if (parseTokenRef.current === token) setUploadParsing(false)
      }
    } else {
      setUploadError('Unsupported file type — use PDF or CSV')
    }
  }

  const handleImport = async () => {
    if (!uploadCarrierId)     { setUploadError('Select a carrier'); return }
    if (!uploadInvRef.trim()) { setUploadError('Enter an invoice reference'); return }
    if (!uploadInvDate)       { setUploadError('Enter an invoice date'); return }
    if (!uploadPreview?.lines?.length) { setUploadError('No line items to import'); return }

    setUploading(true)
    setUploadError(null)

    // Atomic header + lines insert
    const { data: invoiceId, error: rpcErr } = await supabase.rpc('import_freight_invoice', {
      _invoice_ref:  uploadInvRef.trim(),
      _carrier_id:   uploadCarrierId,
      _invoice_date: uploadInvDate,
      _due_date:     uploadDueDate || null,
      _lines:        uploadPreview.lines,
    })
    if (rpcErr) { setUploadError(rpcErr.message); setUploading(false); return }

    // Run the rate engine immediately
    const { data: match, error: matchErr } = await supabase.functions.invoke('logistics-match-invoice', {
      body: { invoice_id: invoiceId },
    })
    setUploading(false)
    setUploadResult({
      ref: uploadInvRef.trim(),
      lines: uploadPreview.lines.length,
      match: matchErr || match?.error ? null : match,
    })
    setUploadStep('done')
    fetchInvoices()
  }

  const filtered = invoices.filter(inv => {
    if (statusFilter  !== 'all' && inv.status     !== statusFilter)  return false
    if (carrierFilter !== 'all' && inv.carrier_id !== carrierFilter) return false
    return true
  })

  if (loading) return <Spinner />

  return (
    <div style={{ ...pageWrap, padding: isMobile ? '20px 16px' : pageWrap.padding }}>
      <PageHeader title="Invoices" subtitle="All carrier freight invoices">
        <HoverBtn onClick={openUploadModal}>Upload invoice</HoverBtn>
      </PageHeader>

      <LogisticsNav />
      <Flash msg={msg} />

      <MissingInvoices carriers={carriers} invoices={invoices} />

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
        <span style={{ marginLeft: 'auto', fontSize: '11px', fontFamily: mono, color: 'var(--text-disabled)' }}>
          {filtered.length} invoice{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div style={{ ...card, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '560px' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              {['Invoice #', 'Carrier', 'Date', 'Due', 'Charged', 'Overcharge', 'Status', ''].map((h, i) => (
                <th key={i} style={thStyle(['Charged', 'Overcharge'].includes(h))}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(inv => {
              const lines = inv.freight_invoice_lines ?? []
              const over  = invoiceOvercharge(lines)
              const total = invoiceTotal(lines)
              return (
                <tr
                  key={inv.id}
                  onClick={() => navigate(`/logistics/invoices/${inv.id}`)}
                  style={{ borderBottom: '1px solid var(--border-subtle)', cursor: 'pointer', transition: 'background 120ms' }}
                  {...rowHover}
                >
                  <td style={{ ...tdStyle, color: 'var(--text-primary)', fontWeight: 500 }}>{inv.invoice_ref}</td>
                  <td style={{ ...tdStyle, color: 'var(--text-secondary)' }}>{inv.carriers?.name ?? '—'}</td>
                  <td style={{ ...tdStyle, fontSize: '12px', fontFamily: mono, color: 'var(--text-tertiary)' }}>{fmtDate(inv.invoice_date)}</td>
                  <td style={{ ...tdStyle, fontSize: '12px', fontFamily: mono, color: 'var(--text-secondary)' }}>{fmtDate(inv.due_date)}</td>
                  <td style={{ ...tdStyle, color: 'var(--text-primary)', textAlign: 'right' }}>{aud(total)}</td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>
                    {over > 0
                      ? <span style={{ color: 'var(--brand-pink)', fontWeight: 500 }}>{aud(over)}</span>
                      : <span style={{ color: 'var(--text-disabled)' }}>—</span>}
                  </td>
                  <td style={tdStyle}><Badge map={INVOICE_STATUS_STYLE} value={inv.status} /></td>
                  <td style={{ ...tdStyle, color: 'var(--text-disabled)', fontSize: '14px' }}>›</td>
                </tr>
              )
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={8} style={{ padding: '32px', textAlign: 'center', color: 'var(--text-disabled)', fontSize: '13px', fontFamily: mono }}>No invoices match the selected filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Upload modal ─────────────────────────────────────────────────────── */}
      <Modal open={uploadModal} onClose={closeUploadModal}>
        {uploadStep === 'done' ? (
          <>
            <p style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 12px' }}>Invoice imported</p>
            <div style={{ ...card, padding: '14px', marginBottom: '16px', fontSize: '13px', fontFamily: mono }}>
              <p style={{ margin: '0 0 4px', color: 'var(--brand-aqua)' }}>{uploadResult.ref} — {uploadResult.lines} line{uploadResult.lines !== 1 ? 's' : ''} added</p>
              {uploadResult.match ? (
                <>
                  <p style={{ margin: '0 0 4px', color: 'var(--text-secondary)' }}>
                    Rate check: {uploadResult.match.matched} matched · {uploadResult.match.no_rate} no rate · {uploadResult.match.skipped} skipped
                  </p>
                  {uploadResult.match.overcharge_aud > 0
                    ? <p style={{ margin: 0, color: 'var(--brand-pink)' }}>Overcharge detected: {aud(uploadResult.match.overcharge_aud)} — flagged for review</p>
                    : <p style={{ margin: 0, color: 'var(--brand-aqua)' }}>No overcharge against contracted rates</p>}
                </>
              ) : (
                <p style={{ margin: 0, color: 'var(--brand-accent)' }}>Rate check could not run — open the invoice and use “Run rate check”</p>
              )}
            </div>
            <HoverBtn onClick={closeUploadModal}>Done</HoverBtn>
          </>
        ) : (
          <>
            <p style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 4px' }}>Upload invoice</p>
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)', fontFamily: mono, margin: '0 0 20px' }}>
              PDF (AI-parsed) or CSV — rates are checked automatically after import
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '20px' }}>
              <div>
                <FieldLabel>File <span style={{ color: 'var(--text-disabled)', textTransform: 'none' }}>(PDF or CSV)</span></FieldLabel>
                <input type="file" accept=".pdf,.csv" onChange={handleFileChange} style={{ fontSize: '12px', color: 'var(--text-secondary)', fontFamily: mono, width: '100%' }} />
                {uploadParsing && <p style={{ margin: '6px 0 0', fontSize: '11px', fontFamily: mono, color: 'var(--text-secondary)' }}>Extracting & parsing…</p>}
                {uploadPreview && !uploadParsing && (
                  <p style={{ margin: '6px 0 0', fontSize: '11px', fontFamily: mono, color: 'var(--brand-aqua)' }}>
                    {uploadPreview.lines.length} line{uploadPreview.lines.length !== 1 ? 's' : ''} ready
                    {uploadPreview._skipped > 0 ? `, ${uploadPreview._skipped} skipped` : ''}
                    {uploadPreview._source === 'pdf' && uploadPreview.carrier_name ? ` · ${uploadPreview.carrier_name}` : ''}
                  </p>
                )}
              </div>

              <div>
                <FieldLabel>Carrier</FieldLabel>
                <select value={uploadCarrierId} onChange={e => setUploadCarrierId(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                  <option value="">Select carrier…</option>
                  {carriers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>

              <div>
                <FieldLabel>Invoice reference</FieldLabel>
                <input value={uploadInvRef} onChange={e => setUploadInvRef(e.target.value)} placeholder="e.g. INV-00123" style={inputStyle} />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <FieldLabel>Invoice date</FieldLabel>
                  <DatePicker value={uploadInvDate || null} onChange={v => setUploadInvDate(v ?? '')} />
                </div>
                <div>
                  <FieldLabel>Due date <span style={{ color: 'var(--text-disabled)' }}>(optional)</span></FieldLabel>
                  <DatePicker value={uploadDueDate || null} onChange={v => setUploadDueDate(v ?? '')} />
                </div>
              </div>

              {uploadPreview?.lines?.length > 0 && (
                <div>
                  <FieldLabel>Line items</FieldLabel>
                  <div style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-subtle)', borderRadius: '6px', overflow: 'hidden', maxHeight: '200px', overflowY: 'auto' }}>
                    {uploadPreview.lines.map((l, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', borderBottom: i < uploadPreview.lines.length - 1 ? '1px solid var(--border-subtle)' : 'none', fontSize: '12px' }}>
                        <span style={{ color: 'var(--text-secondary)' }}>
                          {l.description}
                          {(l.service || l.origin) && (
                            <span style={{ color: 'var(--text-disabled)', fontFamily: mono }}>
                              {' '}· {[l.service, l.origin && `${l.origin} → ${l.destination ?? '?'}`, l.weight_kg && `${l.weight_kg}kg`].filter(Boolean).join(' · ')}
                            </span>
                          )}
                        </span>
                        <span style={{ color: 'var(--brand-accent)', fontFamily: mono, whiteSpace: 'nowrap', marginLeft: '12px' }}>${l.charged_total.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {uploadError && (
              <div style={{ marginBottom: '16px', padding: '10px 14px', borderRadius: '6px', fontSize: '12px', fontFamily: mono, background: 'rgba(var(--brand-pink-rgb),0.1)', border: '1px solid rgba(var(--brand-pink-rgb),0.3)', color: 'var(--brand-pink)' }}>
                {uploadError}
              </div>
            )}

            <div style={{ display: 'flex', gap: '8px' }}>
              <HoverBtn onClick={handleImport} disabled={uploading || uploadParsing || !uploadPreview}>
                {uploading ? 'Importing…' : 'Import & check rates'}
              </HoverBtn>
              <button onClick={closeUploadModal} disabled={uploading} style={{ ...btnGhost, opacity: uploading ? 0.5 : 1, cursor: uploading ? 'not-allowed' : 'pointer' }}>
                Cancel
              </button>
            </div>
          </>
        )}
      </Modal>
    </div>
  )
}
