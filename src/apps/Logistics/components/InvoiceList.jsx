import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import * as pdfjsLib from 'pdfjs-dist'
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { supabase } from '@portal/lib/supabase'
import LogisticsNav from './LogisticsNav.jsx'
import { aud, fmtDate, invoiceTotal, invoiceOvercharge } from '../utils/helpers.js'
import { useIsMobile } from '../../../hooks/useIsMobile.js'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker

// ─── CSV invoice parser ───────────────────────────────────────────────────────
// Expected columns: description, detail, charged_total, contracted_total
function parseCsvLines(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) return { rows: [], error: 'CSV has no data rows' }

  const headers = lines[0].split(',').map(h => h.trim().toLowerCase())
  if (!headers.includes('description') || !headers.includes('charged_total')) {
    return { rows: [], error: 'Missing required columns: description, charged_total' }
  }

  const idx = k => headers.indexOf(k)
  const rows = []
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',').map(c => c.trim())
    const description    = cells[idx('description')]     ?? ''
    const detail         = cells[idx('detail')]          ?? ''
    const charged_total  = parseFloat(cells[idx('charged_total')]  ?? '')
    const contracted_raw = idx('contracted_total') !== -1 ? cells[idx('contracted_total')] : ''
    const contracted_total = contracted_raw ? parseFloat(contracted_raw) : null

    if (!description || isNaN(charged_total)) continue
    rows.push({ description, detail: detail || null, charged_total, contracted_total: isNaN(contracted_total) ? null : contracted_total })
  }
  return { rows }
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

const inputStyle = {
  background: '#0a0a0a', border: '1px solid #222222', borderRadius: '6px',
  color: '#ffffff', fontSize: '13px', padding: '7px 10px', outline: 'none',
  fontFamily: 'inherit', width: '100%', boxSizing: 'border-box',
}
const btnPrimary = {
  fontSize: '12px', fontWeight: 500, padding: '6px 14px', borderRadius: '6px',
  cursor: 'pointer', color: '#f3ca0f', border: '1px solid rgba(243,202,15,0.35)',
  background: 'transparent', transition: 'background 120ms',
}
const btnGhost = {
  fontSize: '12px', padding: '6px 14px', borderRadius: '6px',
  cursor: 'pointer', color: '#a0a0a0', border: '1px solid #222', background: 'transparent',
}

export default function InvoiceList() {
  const [invoices,      setInvoices]      = useState([])
  const [carriers,      setCarriers]      = useState([])
  const [statusFilter,  setStatusFilter]  = useState('all')
  const [carrierFilter, setCarrierFilter] = useState('all')
  const [loading,       setLoading]       = useState(true)
  const navigate = useNavigate()
  const isMobile = useIsMobile()

  // Upload modal
  const [uploadModal,     setUploadModal]     = useState(false)
  const [uploadStep,      setUploadStep]      = useState('form')   // form | preview | done
  const [uploadCarrierId, setUploadCarrierId] = useState('')
  const [uploadInvRef,    setUploadInvRef]    = useState('')
  const [uploadInvDate,   setUploadInvDate]   = useState('')
  const [uploadDueDate,   setUploadDueDate]   = useState('')
  const [uploadFile,      setUploadFile]      = useState(null)
  const [uploadParsing,   setUploadParsing]   = useState(false)
  const [uploadPreview,   setUploadPreview]   = useState(null)    // { invoice_ref, carrier_name, invoice_date, due_date, lines[] }
  const [uploadError,     setUploadError]     = useState(null)
  const [uploading,       setUploading]       = useState(false)
  const [uploadResult,    setUploadResult]    = useState(null)
  const parseTokenRef = useRef(0)

  useEffect(() => {
    Promise.all([
      supabase.from('freight_invoices').select('*, carriers(*), freight_invoice_lines(*)').order('invoice_date', { ascending: false }),
      supabase.from('carriers').select('*').order('name'),
    ]).then(([invRes, carRes]) => {
      if (invRes.data) setInvoices(invRes.data)
      if (carRes.data) setCarriers(carRes.data)
    }).catch(() => {
      // Queries failed — leave lists empty, still exit loading state
    }).finally(() => {
      setLoading(false)
    })
  }, [])

  const fetchInvoices = () =>
    supabase.from('freight_invoices').select('*, carriers(*), freight_invoice_lines(*)').order('invoice_date', { ascending: false })
      .then(({ data }) => { if (data) setInvoices(data) })

  const openUploadModal = () => {
    setUploadModal(true)
    setUploadStep('form')
    setUploadCarrierId('')
    setUploadInvRef('')
    setUploadInvDate('')
    setUploadDueDate('')
    setUploadFile(null)
    setUploadPreview(null)
    setUploadError(null)
    setUploadResult(null)
  }

  const closeUploadModal = () => {
    setUploadModal(false)
    if (uploadResult) fetchInvoices()
  }

  const handleFileChange = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    setUploadFile(file)
    setUploadError(null)
    setUploadPreview(null)

    const ext = file.name.split('.').pop().toLowerCase()

    if (ext === 'csv') {
      const text = await file.text()
      const { rows, error } = parseCsvLines(text)
      if (error) { setUploadError(error); return }
      if (!rows.length) { setUploadError('No valid line items found in CSV'); return }
      setUploadPreview({ lines: rows, _source: 'csv' })
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
    }
  }

  const handleImport = async () => {
    if (!uploadCarrierId)    { setUploadError('Select a carrier'); return }
    if (!uploadInvRef.trim()) { setUploadError('Enter an invoice reference'); return }
    if (!uploadInvDate)      { setUploadError('Enter an invoice date'); return }
    if (!uploadPreview?.lines?.length) { setUploadError('No line items to import'); return }

    setUploading(true)
    setUploadError(null)

    const { data: inv, error: invErr } = await supabase.from('freight_invoices').insert({
      invoice_ref:  uploadInvRef.trim(),
      carrier_id:   uploadCarrierId,
      invoice_date: uploadInvDate,
      due_date:     uploadDueDate || null,
      status:       'pending',
    }).select().single()

    if (invErr) { setUploadError(invErr.message); setUploading(false); return }

    const lineRows = uploadPreview.lines.map((l, i) => ({
      invoice_id:       inv.id,
      description:      l.description,
      detail:           l.detail ?? null,
      charged_total:    l.charged_total,
      contracted_total: l.contracted_total ?? null,
      sort_order:       i,
    }))

    const { error: linesErr } = await supabase.from('freight_invoice_lines').insert(lineRows)
    setUploading(false)

    if (linesErr) {
      await supabase.from('freight_invoices').delete().eq('id', inv.id)
      setUploadError(linesErr.message)
      return
    }
    setUploadResult({ ref: uploadInvRef.trim(), lines: lineRows.length })
    setUploadStep('done')
  }

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
    <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '20px 16px' : '32px 24px', maxWidth: '1200px', margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
        <div>
          <h1 style={{ fontSize: '18px', fontWeight: 600, color: '#ffffff', margin: 0 }}>Invoices</h1>
          <p style={{ fontSize: '13px', color: '#a0a0a0', margin: '4px 0 0', fontFamily: '"JetBrains Mono", monospace' }}>All carrier freight invoices</p>
        </div>
        <button
          onClick={openUploadModal}
          style={btnPrimary}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(243,202,15,0.08)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
        >
          Upload invoice
        </button>
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

      <div style={{ background: '#0a0a0a', border: '1px solid #1e1e1e', borderRadius: '8px', overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '560px' }}>
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
                  onClick={() => navigate(`/logistics/invoices/${inv.id}`)}
                  style={{ borderBottom: '1px solid #181818', cursor: 'pointer', transition: 'background 120ms' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#0a0a0a'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <td style={{ padding: '11px 14px', fontSize: '13px', color: '#ffffff', fontWeight: 500 }}>{inv.invoice_ref}</td>
                  <td style={{ padding: '11px 14px', fontSize: '13px', color: '#AAA' }}>{inv.carriers?.name ?? '—'}</td>
                  <td style={{ padding: '11px 14px', fontSize: '12px', fontFamily: '"JetBrains Mono", monospace', color: '#666' }}>{fmtDate(inv.invoice_date)}</td>
                  <td style={{ padding: '11px 14px', fontSize: '12px', fontFamily: '"JetBrains Mono", monospace', color: '#a0a0a0' }}>{fmtDate(inv.due_date)}</td>
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
      {/* ── Upload modal ─────────────────────────────────────────────────────── */}
      {uploadModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
          <div style={{ background: '#0a0a0a', border: '1px solid #222222', borderRadius: '10px', width: '100%', maxWidth: '560px', padding: '24px', maxHeight: '90vh', overflowY: 'auto' }}>

            {uploadStep === 'done' ? (
              <>
                <p style={{ fontSize: '14px', fontWeight: 600, color: '#ffffff', margin: '0 0 12px' }}>Invoice imported</p>
                <div style={{ background: '#0a0a0a', border: '1px solid #1e1e1e', borderRadius: '6px', padding: '14px', marginBottom: '16px', fontSize: '13px', fontFamily: '"JetBrains Mono", monospace' }}>
                  <p style={{ margin: '0 0 4px', color: '#4ade80' }}>{uploadResult.ref} — {uploadResult.lines} line{uploadResult.lines !== 1 ? 's' : ''} added</p>
                </div>
                <button onClick={closeUploadModal} style={btnPrimary} onMouseEnter={e => { e.currentTarget.style.background = 'rgba(243,202,15,0.08)' }} onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>Done</button>
              </>
            ) : (
              <>
                <p style={{ fontSize: '14px', fontWeight: 600, color: '#ffffff', margin: '0 0 4px' }}>Upload invoice</p>
                <p style={{ fontSize: '12px', color: '#a0a0a0', fontFamily: '"JetBrains Mono", monospace', margin: '0 0 20px' }}>Accepts PDF (AI-parsed) or CSV (line items)</p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '20px' }}>

                  {/* File picker — first so PDF auto-fills fields below */}
                  <div>
                    <label style={{ fontSize: '11px', fontFamily: '"JetBrains Mono", monospace', color: '#a0a0a0', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: '6px' }}>
                      File <span style={{ color: '#444', textTransform: 'none' }}>(PDF or CSV)</span>
                    </label>
                    <input type="file" accept=".pdf,.csv" onChange={handleFileChange} style={{ fontSize: '12px', color: '#AAA', fontFamily: '"JetBrains Mono", monospace', width: '100%' }} />
                    {uploadParsing && <p style={{ margin: '6px 0 0', fontSize: '11px', fontFamily: '"JetBrains Mono", monospace', color: '#a0a0a0' }}>Extracting & parsing…</p>}
                    {uploadPreview && !uploadParsing && (
                      <p style={{ margin: '6px 0 0', fontSize: '11px', fontFamily: '"JetBrains Mono", monospace', color: '#4ade80' }}>
                        {uploadPreview.lines.length} line{uploadPreview.lines.length !== 1 ? 's' : ''} ready
                        {uploadPreview._source === 'pdf' && uploadPreview.carrier_name ? ` · ${uploadPreview.carrier_name}` : ''}
                      </p>
                    )}
                  </div>

                  {/* Carrier */}
                  <div>
                    <label style={{ fontSize: '11px', fontFamily: '"JetBrains Mono", monospace', color: '#a0a0a0', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: '6px' }}>Carrier</label>
                    <select value={uploadCarrierId} onChange={e => setUploadCarrierId(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                      <option value="">Select carrier…</option>
                      {carriers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>

                  {/* Invoice ref */}
                  <div>
                    <label style={{ fontSize: '11px', fontFamily: '"JetBrains Mono", monospace', color: '#a0a0a0', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: '6px' }}>Invoice reference</label>
                    <input value={uploadInvRef} onChange={e => setUploadInvRef(e.target.value)} placeholder="e.g. INV-00123" style={inputStyle} />
                  </div>

                  {/* Dates */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                    <div>
                      <label style={{ fontSize: '11px', fontFamily: '"JetBrains Mono", monospace', color: '#a0a0a0', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: '6px' }}>Invoice date</label>
                      <input type="date" value={uploadInvDate} onChange={e => setUploadInvDate(e.target.value)} style={inputStyle} />
                    </div>
                    <div>
                      <label style={{ fontSize: '11px', fontFamily: '"JetBrains Mono", monospace', color: '#a0a0a0', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: '6px' }}>Due date <span style={{ color: '#444' }}>(optional)</span></label>
                      <input type="date" value={uploadDueDate} onChange={e => setUploadDueDate(e.target.value)} style={inputStyle} />
                    </div>
                  </div>

                  {/* Line items preview */}
                  {uploadPreview?.lines?.length > 0 && (
                    <div>
                      <p style={{ fontSize: '11px', fontFamily: '"JetBrains Mono", monospace', color: '#a0a0a0', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 8px' }}>Line items</p>
                      <div style={{ background: '#050505', border: '1px solid #1e1e1e', borderRadius: '6px', overflow: 'hidden', maxHeight: '200px', overflowY: 'auto' }}>
                        {uploadPreview.lines.map((l, i) => (
                          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', borderBottom: i < uploadPreview.lines.length - 1 ? '1px solid #181818' : 'none', fontSize: '12px' }}>
                            <span style={{ color: '#AAA' }}>{l.description}{l.detail ? <span style={{ color: '#555', fontFamily: '"JetBrains Mono", monospace' }}> · {l.detail}</span> : null}</span>
                            <span style={{ color: '#f3ca0f', fontFamily: '"JetBrains Mono", monospace', whiteSpace: 'nowrap', marginLeft: '12px' }}>${l.charged_total.toFixed(2)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {uploadError && (
                  <div style={{ marginBottom: '16px', padding: '10px 14px', borderRadius: '6px', fontSize: '12px', fontFamily: '"JetBrains Mono", monospace', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#ff1744' }}>
                    {uploadError}
                  </div>
                )}

                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    onClick={handleImport}
                    disabled={uploading || uploadParsing || !uploadPreview}
                    style={{ ...btnPrimary, opacity: (uploading || uploadParsing || !uploadPreview) ? 0.5 : 1, cursor: (uploading || uploadParsing || !uploadPreview) ? 'not-allowed' : 'pointer' }}
                    onMouseEnter={e => { if (!uploading && !uploadParsing && uploadPreview) e.currentTarget.style.background = 'rgba(243,202,15,0.08)' }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                  >
                    {uploading ? 'Importing…' : 'Import'}
                  </button>
                  <button onClick={closeUploadModal} style={btnGhost}>Cancel</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
