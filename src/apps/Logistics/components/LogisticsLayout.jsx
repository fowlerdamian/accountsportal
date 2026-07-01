import { useEffect, useRef, useState } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'
import { supabase } from '@portal/lib/supabase'
import { DatePicker } from '@portal/components/DatePicker'
import { autoImportInvoice, importAndCheck } from '../utils/importInvoice.js'
import { aud } from '../utils/helpers.js'
import { card, mono, inputStyle, btnGhost, Modal, FieldLabel, HoverBtn } from '../utils/ui.jsx'

// Logistics-wide invoice drop zone: drag a PDF/CSV anywhere in the app.
// Fully-parsed invoices import + rate-check with zero manual entry; the
// completion modal only appears when extraction couldn't fill every field.
export default function LogisticsLayout() {
  const navigate = useNavigate()
  const dragDepth = useRef(0)
  const [dragging, setDragging] = useState(false)
  const [busy,     setBusy]     = useState(false)
  const [error,    setError]    = useState(null)
  const [prefill,  setPrefill]  = useState(null)   // needs-input fallback
  const [carriers, setCarriers] = useState([])
  const [importing, setImporting] = useState(false)

  useEffect(() => {
    supabase.from('carriers').select('*').order('name').then(({ data }) => { if (data) setCarriers(data) })
  }, [])

  useEffect(() => {
    const hasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files')

    const onDragEnter = (e) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth.current++; setDragging(true) }
    const onDragOver  = (e) => { if (!hasFiles(e)) return; e.preventDefault() }
    const onDragLeave = (e) => { if (!hasFiles(e)) return; if (--dragDepth.current <= 0) { dragDepth.current = 0; setDragging(false) } }
    const onDrop = async (e) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      dragDepth.current = 0
      setDragging(false)
      const file = e.dataTransfer.files[0]
      if (!file) return
      setError(null)
      setBusy(true)
      try {
        const { data } = await supabase.from('carriers').select('*').order('name')
        const carrierList = data ?? []
        setCarriers(carrierList)
        const result = await autoImportInvoice(file, carrierList)
        if (result.status === 'imported') {
          navigate(`/logistics/invoices/${result.invoiceId}`)
        } else if (result.status === 'needs_input') {
          setPrefill(result.prefill)
        } else {
          setError(result.message)
        }
      } catch (err) {
        setError(err.message)
      } finally {
        setBusy(false)
      }
    }

    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [navigate])

  const completeImport = async () => {
    if (!prefill.carrier_id || !prefill.invoice_ref?.trim() || !prefill.invoice_date) return
    setImporting(true)
    const result = await importAndCheck(prefill)
    setImporting(false)
    if (result.status === 'error') { setError(result.message); return }
    setPrefill(null)
    navigate(`/logistics/invoices/${result.invoiceId}`)
  }

  const overlayText = { fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }

  return (
    <>
      <Outlet />

      {/* Drag highlight */}
      {dragging && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <div style={{ ...card, border: '2px dashed var(--brand-accent)', borderRadius: '12px', padding: '48px 64px', textAlign: 'center' }}>
            <p style={{ ...overlayText, color: 'var(--brand-accent)', fontSize: '16px' }}>Drop invoice to import</p>
            <p style={{ margin: '8px 0 0', fontSize: '12px', fontFamily: mono, color: 'var(--text-secondary)' }}>PDF or CSV — parsed and rate-checked automatically</p>
          </div>
        </div>
      )}

      {/* Busy overlay */}
      {busy && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ ...card, padding: '32px 48px', textAlign: 'center' }}>
            <div className="w-7 h-7 rounded-full border-2 animate-spin" style={{ margin: '0 auto 14px', borderColor: 'var(--brand-accent)', borderTopColor: 'transparent' }} />
            <p style={overlayText}>Reading invoice…</p>
            <p style={{ margin: '6px 0 0', fontSize: '12px', fontFamily: mono, color: 'var(--text-secondary)' }}>Extracting, importing and checking against ShipStation</p>
          </div>
        </div>
      )}

      {/* Error toast */}
      {error && !prefill && (
        <div style={{ position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)', zIndex: 60, padding: '12px 18px', borderRadius: '8px', fontSize: '13px', fontFamily: mono, background: 'rgba(var(--brand-pink-rgb),0.15)', border: '1px solid rgba(var(--brand-pink-rgb),0.4)', color: 'var(--brand-pink)', display: 'flex', gap: '14px', alignItems: 'center' }}>
          {error}
          <button onClick={() => setError(null)} style={{ background: 'none', border: 'none', color: 'var(--brand-pink)', cursor: 'pointer', fontSize: '15px', padding: 0, lineHeight: 1 }}>×</button>
        </div>
      )}

      {/* Completion modal — only when extraction couldn't fill everything */}
      <Modal open={!!prefill} onClose={() => { if (!importing) setPrefill(null) }} width={460}>
        {prefill && (
          <>
            <p style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 4px' }}>Almost there</p>
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)', fontFamily: mono, margin: '0 0 18px' }}>
              {prefill.lines.length} line{prefill.lines.length !== 1 ? 's' : ''} extracted ({aud(prefill.lines.reduce((s, l) => s + l.charged_total, 0))})
              {prefill.carrier_name && !prefill.carrier_id ? ` — couldn't match carrier "${prefill.carrier_name}"` : ' — fill in the missing details'}
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '18px' }}>
              <div>
                <FieldLabel>Carrier</FieldLabel>
                <select value={prefill.carrier_id} onChange={e => setPrefill(p => ({ ...p, carrier_id: e.target.value }))} style={{ ...inputStyle, cursor: 'pointer' }}>
                  <option value="">Select carrier…</option>
                  {carriers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <FieldLabel>Invoice reference</FieldLabel>
                <input value={prefill.invoice_ref} onChange={e => setPrefill(p => ({ ...p, invoice_ref: e.target.value }))} placeholder="e.g. INV-00123" style={inputStyle} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <FieldLabel>Invoice date</FieldLabel>
                  <DatePicker value={prefill.invoice_date || null} onChange={v => setPrefill(p => ({ ...p, invoice_date: v ?? '' }))} />
                </div>
                <div>
                  <FieldLabel>Due date <span style={{ color: 'var(--text-disabled)' }}>(optional)</span></FieldLabel>
                  <DatePicker value={prefill.due_date || null} onChange={v => setPrefill(p => ({ ...p, due_date: v ?? '' }))} />
                </div>
              </div>
            </div>

            {error && (
              <div style={{ marginBottom: '14px', padding: '10px 14px', borderRadius: '6px', fontSize: '12px', fontFamily: mono, background: 'rgba(var(--brand-pink-rgb),0.1)', border: '1px solid rgba(var(--brand-pink-rgb),0.3)', color: 'var(--brand-pink)' }}>
                {error}
              </div>
            )}

            <div style={{ display: 'flex', gap: '8px' }}>
              <HoverBtn onClick={completeImport} disabled={importing || !prefill.carrier_id || !prefill.invoice_ref?.trim() || !prefill.invoice_date}>
                {importing ? 'Importing…' : 'Import & check'}
              </HoverBtn>
              <button onClick={() => setPrefill(null)} disabled={importing} style={{ ...btnGhost, opacity: importing ? 0.5 : 1 }}>Cancel</button>
            </div>
          </>
        )}
      </Modal>
    </>
  )
}
