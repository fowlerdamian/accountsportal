import { useEffect, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import * as pdfjsLib from 'pdfjs-dist'
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { supabase } from '@portal/lib/supabase'
import LogisticsNav from './LogisticsNav.jsx'
import { fmtRate, fmtLane, fmtDate } from '../utils/helpers.js'
import {
  pageWrap, card, mono, thStyle, tdStyle, inputStyle, btnGhost,
  Badge, Spinner, Flash, useFlash, PageHeader, HoverBtn, Modal, FieldLabel,
} from '../utils/ui.jsx'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker

const CARD_STATUS_STYLE = {
  active:     { color: 'var(--brand-aqua)',  background: 'rgba(var(--brand-aqua-rgb),0.1)',   border: '1px solid rgba(var(--brand-aqua-rgb),0.3)' },
  draft:      { color: 'var(--text-secondary)', background: 'var(--bg-surface)',              border: '1px solid var(--border-default)' },
  superseded: { color: 'var(--text-tertiary)',  background: 'var(--bg-surface)',              border: '1px solid var(--border-default)' },
}

const RATE_TYPES = [
  { value: 'per_kg',   label: '$ / kg'   },
  { value: 'per_item', label: '$ / item' },
  { value: 'flat',     label: 'Flat $'   },
  { value: 'percent',  label: '%'        },
]

async function extractFileText(file) {
  const ext = file.name.split('.').pop().toLowerCase()
  if (ext === 'pdf') {
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
    let text = ''
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p)
      const content = await page.getTextContent()
      text += content.items.map(i => i.str).join(' ') + '\n'
    }
    return text
  }
  if (ext === 'xlsx' || ext === 'xls') {
    const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' })
    return wb.SheetNames.map(n => `--- Sheet: ${n} ---\n${XLSX.utils.sheet_to_csv(wb.Sheets[n])}`).join('\n\n')
  }
  return file.text() // csv/tsv/txt
}

function SubTab({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '8px 16px', fontSize: '12px', fontWeight: 500, cursor: 'pointer',
        background: 'transparent', border: 'none', borderBottom: `2px solid ${active ? 'var(--brand-accent)' : 'transparent'}`,
        color: active ? 'var(--brand-accent)' : 'var(--text-tertiary)', transition: 'color 120ms',
      }}
    >
      {label}
    </button>
  )
}

export default function RateCards() {
  const [carriers,  setCarriers]  = useState([])
  const [cards,     setCards]     = useState([])   // rate_cards with entries
  const [loading,   setLoading]   = useState(true)
  const [msg,       flash]        = useFlash()
  const [activeSubTab, setActiveSubTab] = useState('rates')
  const [showHistory,  setShowHistory]  = useState({})   // { [carrierId]: bool }

  // Import wizard
  const [wizard,        setWizard]        = useState(false)
  const [wizStep,       setWizStep]       = useState('form')  // form | done
  const [wizCarrierId,  setWizCarrierId]  = useState('')
  const [wizFileName,   setWizFileName]   = useState('')
  const [wizParsing,    setWizParsing]    = useState(false)
  const [wizPreview,    setWizPreview]    = useState(null)    // { name, effective_from, entries }
  const [wizError,      setWizError]      = useState(null)
  const [wizSaving,     setWizSaving]     = useState(false)
  const [wizResult,     setWizResult]     = useState(null)
  const parseTokenRef = useRef(0)

  // Manual entry form
  const [showForm, setShowForm] = useState(false)
  const [form,     setForm]     = useState({ carrier_id: '', service: '', origin: '', destination: '', rate_type: 'per_kg', rate: '', min_charge: '' })
  const [saving,   setSaving]   = useState(false)

  // Carrier editing
  const [carrierEdits,  setCarrierEdits]  = useState({})
  const [savingCarrier, setSavingCarrier] = useState(null)

  const fetchAll = async () => {
    const [carRes, cardRes] = await Promise.all([
      supabase.from('carriers').select('*').order('name'),
      supabase.from('rate_cards').select('*, rate_card_entries(*)').order('created_at', { ascending: false }),
    ])
    if (carRes.data)  setCarriers(carRes.data)
    if (cardRes.data) setCards(cardRes.data)
    setLoading(false)
  }

  useEffect(() => { fetchAll() }, [])

  // ─── Import wizard ───────────────────────────────────────────────────────────

  const openWizard = () => {
    setWizard(true); setWizStep('form'); setWizCarrierId(''); setWizFileName('')
    setWizPreview(null); setWizError(null); setWizResult(null)
  }

  const handleWizFile = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    setWizFileName(file.name)
    setWizError(null)
    setWizPreview(null)
    const token = ++parseTokenRef.current
    setWizParsing(true)
    try {
      const text = await extractFileText(file)
      const { data, error } = await supabase.functions.invoke('logistics-parse-ratecard', { body: { text } })
      if (parseTokenRef.current !== token) return
      if (error || data?.error) { setWizError(data?.error ?? error?.message ?? 'Failed to parse rate card'); return }
      setWizPreview(data)
    } catch (err) {
      if (parseTokenRef.current === token) setWizError(err.message)
    } finally {
      if (parseTokenRef.current === token) setWizParsing(false)
    }
  }

  const handleWizImport = async () => {
    if (!wizCarrierId) { setWizError('Select a carrier'); return }
    if (!wizPreview?.entries?.length) { setWizError('No rate entries to import'); return }
    setWizSaving(true)
    setWizError(null)
    const { error } = await supabase.rpc('import_rate_card', {
      _carrier_id:      wizCarrierId,
      _name:            wizPreview.name || `${carriers.find(c => c.id === wizCarrierId)?.name ?? ''} rates`,
      _effective_from:  wizPreview.effective_from || null,
      _source_filename: wizFileName || null,
      _entries:         wizPreview.entries,
    })
    setWizSaving(false)
    if (error) { setWizError(error.message); return }
    setWizResult({ entries: wizPreview.entries.length })
    setWizStep('done')
    fetchAll()
  }

  // ─── Manual entry ────────────────────────────────────────────────────────────

  const handleAdd = async () => {
    const rate = parseFloat(form.rate)
    if (!form.carrier_id || !form.service.trim() || isNaN(rate)) {
      flash('err', 'Carrier, service and a numeric rate are required'); return
    }
    setSaving(true)
    try {
      // Append to the carrier's active card, or create one for manual entries
      let cardId = cards.find(c => c.carrier_id === form.carrier_id && c.status === 'active')?.id
      if (!cardId) {
        const { data, error } = await supabase.from('rate_cards').insert({
          carrier_id: form.carrier_id,
          name: 'Manual entries',
          status: 'active',
          effective_from: new Date().toISOString().slice(0, 10),
        }).select('id').single()
        if (error) throw error
        cardId = data.id
      }
      const minCharge = parseFloat(form.min_charge)
      const { error } = await supabase.from('rate_card_entries').insert({
        rate_card_id: cardId,
        service:      form.service.trim(),
        origin:       form.origin.trim() || null,
        destination:  form.destination.trim() || null,
        rate_type:    form.rate_type,
        rate,
        min_charge:   isNaN(minCharge) ? null : minCharge,
      })
      if (error) throw error
      flash('ok', 'Rate added')
      setForm({ carrier_id: '', service: '', origin: '', destination: '', rate_type: 'per_kg', rate: '', min_charge: '' })
      setShowForm(false)
      fetchAll()
    } catch (err) {
      flash('err', err.message)
    } finally {
      setSaving(false)
    }
  }

  const deleteEntry = async (entryId) => {
    const { error } = await supabase.from('rate_card_entries').delete().eq('id', entryId)
    if (error) { flash('err', error.message); return }
    fetchAll()
  }

  // ─── Carrier editing ─────────────────────────────────────────────────────────

  const getCarrierEdit = (carrierId) => {
    const c = carriers.find(x => x.id === carrierId)
    return carrierEdits[carrierId] ?? {
      name: c?.name ?? '', email: c?.email ?? '', claims_email: c?.claims_email ?? '',
      fuel_levy_pct: c?.fuel_levy_pct != null ? String(c.fuel_levy_pct) : '',
      cubic_factor_kg_m3: c?.cubic_factor_kg_m3 != null ? String(c.cubic_factor_kg_m3) : '250',
    }
  }

  const updateCarrierEdit = (carrierId, field, value) => {
    setCarrierEdits(prev => ({ ...prev, [carrierId]: { ...getCarrierEdit(carrierId), [field]: value } }))
  }

  const saveCarrier = async (carrierId) => {
    const edit = getCarrierEdit(carrierId)
    if (!edit.name.trim()) { flash('err', 'Carrier name is required'); return }
    const levy  = parseFloat(edit.fuel_levy_pct)
    const cubic = parseFloat(edit.cubic_factor_kg_m3)
    setSavingCarrier(carrierId)
    const { error } = await supabase.from('carriers').update({
      name:          edit.name.trim(),
      email:         edit.email.trim() || null,
      claims_email:  edit.claims_email.trim() || null,
      fuel_levy_pct: isNaN(levy) ? null : levy,
      cubic_factor_kg_m3: isNaN(cubic) ? 250 : cubic,
    }).eq('id', carrierId)
    setSavingCarrier(null)
    if (error) { flash('err', error.message); return }
    flash('ok', 'Carrier updated')
    setCarrierEdits(prev => { const next = { ...prev }; delete next[carrierId]; return next })
    fetchAll()
  }

  if (loading) return <Spinner />

  return (
    <div style={pageWrap}>
      <PageHeader title="Rate Cards" subtitle="Contracted freight rates — versioned per carrier">
        {activeSubTab === 'rates' && (
          <>
            <HoverBtn onClick={openWizard}>Import rate card</HoverBtn>
            <HoverBtn onClick={() => setShowForm(v => !v)}>+ Add rate</HoverBtn>
          </>
        )}
      </PageHeader>

      <LogisticsNav />

      <div style={{ display: 'flex', borderBottom: '1px solid var(--border-subtle)', marginBottom: '24px' }}>
        <SubTab label="Rate Cards" active={activeSubTab === 'rates'}    onClick={() => setActiveSubTab('rates')} />
        <SubTab label="Carriers"   active={activeSubTab === 'carriers'} onClick={() => setActiveSubTab('carriers')} />
      </div>

      <Flash msg={msg} />

      {/* ── Rate Cards tab ─────────────────────────────────────────────────────── */}
      {activeSubTab === 'rates' && (
        <>
          {showForm && (
            <div style={{ ...card, padding: '16px', marginBottom: '24px' }}>
              <p style={{ fontSize: '11px', fontFamily: mono, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 12px' }}>New rate entry</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '10px', marginBottom: '12px' }}>
                <select value={form.carrier_id} onChange={e => setForm(f => ({ ...f, carrier_id: e.target.value }))} style={{ ...inputStyle, cursor: 'pointer' }}>
                  <option value="">Carrier</option>
                  {carriers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <input style={inputStyle} placeholder="Service (e.g. Road Express)" value={form.service} onChange={e => setForm(f => ({ ...f, service: e.target.value }))} />
                <input style={inputStyle} placeholder="Origin (blank = any)"        value={form.origin} onChange={e => setForm(f => ({ ...f, origin: e.target.value }))} />
                <input style={inputStyle} placeholder="Destination (blank = any)"   value={form.destination} onChange={e => setForm(f => ({ ...f, destination: e.target.value }))} />
                <select value={form.rate_type} onChange={e => setForm(f => ({ ...f, rate_type: e.target.value }))} style={{ ...inputStyle, cursor: 'pointer' }}>
                  {RATE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
                <input style={inputStyle} placeholder={form.rate_type === 'percent' ? 'Rate (e.g. 18.5)' : 'Rate (e.g. 0.85)'} value={form.rate} onChange={e => setForm(f => ({ ...f, rate: e.target.value }))} />
                <input style={inputStyle} placeholder="Min charge (optional)" value={form.min_charge} onChange={e => setForm(f => ({ ...f, min_charge: e.target.value }))} />
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <HoverBtn onClick={handleAdd} disabled={saving}>{saving ? 'Saving…' : 'Save'}</HoverBtn>
                <button onClick={() => setShowForm(false)} style={btnGhost}>Cancel</button>
              </div>
            </div>
          )}

          {carriers.map(carrier => {
            const carrierCards = cards.filter(c => c.carrier_id === carrier.id)
            const active       = carrierCards.find(c => c.status === 'active')
            const history      = carrierCards.filter(c => c.status !== 'active')
            const entries      = [...(active?.rate_card_entries ?? [])].sort((a, b) => (a.service + fmtLane(a)).localeCompare(b.service + fmtLane(b)))
            return (
              <div key={carrier.id} style={{ marginBottom: '28px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>{carrier.name}</span>
                  {active && <Badge map={CARD_STATUS_STYLE} value="active" />}
                  {active?.name && <span style={{ fontSize: '12px', color: 'var(--text-tertiary)', fontFamily: mono }}>{active.name}{active.effective_from ? ` · from ${fmtDate(active.effective_from)}` : ''}</span>}
                  {carrier.fuel_levy_pct != null && <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', fontFamily: mono }}>fuel levy {carrier.fuel_levy_pct}%</span>}
                  <span style={{ marginLeft: 'auto', fontSize: '11px', color: 'var(--text-disabled)', fontFamily: mono }}>
                    {entries.length} rate{entries.length !== 1 ? 's' : ''}
                    {history.length > 0 && (
                      <button
                        onClick={() => setShowHistory(h => ({ ...h, [carrier.id]: !h[carrier.id] }))}
                        style={{ marginLeft: '10px', background: 'none', border: 'none', color: 'var(--brand-accent)', cursor: 'pointer', fontSize: '11px', fontFamily: mono, padding: 0 }}
                      >
                        {showHistory[carrier.id] ? 'hide history' : `history (${history.length})`}
                      </button>
                    )}
                  </span>
                </div>

                <div style={{ ...card, overflow: 'hidden' }}>
                  {entries.length === 0 ? (
                    <p style={{ padding: '16px', fontSize: '13px', color: 'var(--text-disabled)', fontFamily: mono, margin: 0 }}>
                      No active rate card — import one or add rates manually
                    </p>
                  ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                          {['Service', 'Lane', 'Type', 'Rate', 'Min', ''].map((h, i) => (
                            <th key={i} style={thStyle(h === 'Rate' || h === 'Min')}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {entries.map(r => (
                          <tr key={r.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                            <td style={{ ...tdStyle, color: 'var(--text-secondary)' }}>{r.service}</td>
                            <td style={{ ...tdStyle, fontSize: '12px', color: 'var(--text-tertiary)', fontFamily: mono }}>{fmtLane(r)}</td>
                            <td style={{ ...tdStyle, fontSize: '11px', color: 'var(--text-tertiary)', fontFamily: mono }}>{r.rate_type.replace('_', '/')}</td>
                            <td style={{ ...tdStyle, color: 'var(--brand-accent)', fontWeight: 500, textAlign: 'right', fontFamily: mono }}>{fmtRate(r)}</td>
                            <td style={{ ...tdStyle, fontSize: '12px', color: 'var(--text-tertiary)', textAlign: 'right', fontFamily: mono }}>{r.min_charge != null ? `$${Number(r.min_charge).toFixed(2)}` : '—'}</td>
                            <td style={{ ...tdStyle, textAlign: 'right' }}>
                              <button
                                onClick={() => deleteEntry(r.id)}
                                title="Delete rate"
                                style={{ background: 'none', border: 'none', color: 'var(--text-disabled)', cursor: 'pointer', fontSize: '13px', padding: 0, transition: 'color 120ms' }}
                                onMouseEnter={e => { e.currentTarget.style.color = 'var(--brand-pink)' }}
                                onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-disabled)' }}
                              >
                                ×
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>

                {showHistory[carrier.id] && history.map(h => (
                  <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 14px', fontSize: '12px', fontFamily: mono, color: 'var(--text-tertiary)' }}>
                    <Badge map={CARD_STATUS_STYLE} value={h.status} />
                    <span>{h.name}</span>
                    <span>{h.effective_from ? fmtDate(h.effective_from) : '—'} → {h.effective_to ? fmtDate(h.effective_to) : '—'}</span>
                    <span>{(h.rate_card_entries ?? []).length} rates</span>
                    {h.source_filename && <span style={{ color: 'var(--text-disabled)' }}>{h.source_filename}</span>}
                  </div>
                ))}
              </div>
            )
          })}
        </>
      )}

      {/* ── Carriers tab ───────────────────────────────────────────────────────── */}
      {activeSubTab === 'carriers' && (
        <div style={{ ...card, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '720px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                {['Name', 'Billing Email', 'Claims Email', 'Fuel Levy %', 'Cubic kg/m³', ''].map((h, i) => (
                  <th key={i} style={thStyle()}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {carriers.map(carrier => {
                const edit  = getCarrierEdit(carrier.id)
                const clean = {
                  name: carrier.name ?? '', email: carrier.email ?? '', claims_email: carrier.claims_email ?? '',
                  fuel_levy_pct: carrier.fuel_levy_pct != null ? String(carrier.fuel_levy_pct) : '',
                  cubic_factor_kg_m3: carrier.cubic_factor_kg_m3 != null ? String(carrier.cubic_factor_kg_m3) : '250',
                }
                const dirty = JSON.stringify(edit) !== JSON.stringify(clean)
                const isSaving = savingCarrier === carrier.id
                return (
                  <tr key={carrier.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '10px 14px' }}>
                      <input value={edit.name} onChange={e => updateCarrierEdit(carrier.id, 'name', e.target.value)} style={{ ...inputStyle, width: '170px' }} />
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <input value={edit.email} onChange={e => updateCarrierEdit(carrier.id, 'email', e.target.value)} placeholder="billing@carrier.com" style={{ ...inputStyle, width: '200px' }} />
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <input value={edit.claims_email} onChange={e => updateCarrierEdit(carrier.id, 'claims_email', e.target.value)} placeholder="claims@carrier.com" style={{ ...inputStyle, width: '200px' }} />
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <input value={edit.fuel_levy_pct} onChange={e => updateCarrierEdit(carrier.id, 'fuel_levy_pct', e.target.value)} placeholder="e.g. 18.5" style={{ ...inputStyle, width: '90px' }} />
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <input value={edit.cubic_factor_kg_m3} onChange={e => updateCarrierEdit(carrier.id, 'cubic_factor_kg_m3', e.target.value)} placeholder="250" style={{ ...inputStyle, width: '80px' }} />
                    </td>
                    <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                      <HoverBtn onClick={() => saveCarrier(carrier.id)} disabled={!dirty || isSaving}>
                        {isSaving ? 'Saving…' : 'Save'}
                      </HoverBtn>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Import wizard modal ────────────────────────────────────────────────── */}
      <Modal open={wizard} onClose={() => { if (!wizSaving) setWizard(false) }}>
        {wizStep === 'done' ? (
          <>
            <p style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 12px' }}>Rate card imported</p>
            <div style={{ ...card, padding: '14px', marginBottom: '16px', fontSize: '13px', fontFamily: mono }}>
              <p style={{ margin: 0, color: 'var(--brand-aqua)' }}>{wizResult.entries} rate{wizResult.entries !== 1 ? 's' : ''} imported — previous active card superseded</p>
            </div>
            <HoverBtn onClick={() => setWizard(false)}>Done</HoverBtn>
          </>
        ) : (
          <>
            <p style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 4px' }}>Import rate card</p>
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)', fontFamily: mono, margin: '0 0 20px' }}>
              AI reads any carrier format (PDF, CSV, Excel) into structured rates. Importing supersedes the carrier's current active card.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '20px' }}>
              <div>
                <FieldLabel>Carrier</FieldLabel>
                <select value={wizCarrierId} onChange={e => setWizCarrierId(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                  <option value="">Select carrier…</option>
                  {carriers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>

              <div>
                <FieldLabel>File <span style={{ color: 'var(--text-disabled)', textTransform: 'none' }}>(PDF, CSV, Excel)</span></FieldLabel>
                <input type="file" accept=".pdf,.csv,.tsv,.txt,.xlsx,.xls" onChange={handleWizFile} style={{ fontSize: '12px', color: 'var(--text-secondary)', fontFamily: mono, width: '100%' }} />
                {wizParsing && <p style={{ margin: '6px 0 0', fontSize: '11px', fontFamily: mono, color: 'var(--text-secondary)' }}>Extracting & parsing with AI…</p>}
                {wizPreview && !wizParsing && (
                  <p style={{ margin: '6px 0 0', fontSize: '11px', fontFamily: mono, color: 'var(--brand-aqua)' }}>
                    {wizPreview.entries.length} rate{wizPreview.entries.length !== 1 ? 's' : ''} found
                    {wizPreview.name ? ` · ${wizPreview.name}` : ''}
                    {wizPreview.effective_from ? ` · from ${fmtDate(wizPreview.effective_from)}` : ''}
                  </p>
                )}
              </div>

              {wizPreview?.entries?.length > 0 && (
                <div>
                  <FieldLabel>Preview</FieldLabel>
                  <div style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-subtle)', borderRadius: '6px', overflow: 'hidden', maxHeight: '240px', overflowY: 'auto' }}>
                    {wizPreview.entries.map((e, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', padding: '7px 12px', borderBottom: i < wizPreview.entries.length - 1 ? '1px solid var(--border-subtle)' : 'none', fontSize: '12px' }}>
                        <span style={{ color: 'var(--text-secondary)' }}>
                          {e.service}
                          <span style={{ color: 'var(--text-disabled)', fontFamily: mono }}> · {fmtLane(e)}</span>
                        </span>
                        <span style={{ color: 'var(--brand-accent)', fontFamily: mono, whiteSpace: 'nowrap' }}>{fmtRate(e)}{e.min_charge != null ? ` (min $${Number(e.min_charge).toFixed(2)})` : ''}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {wizError && (
              <div style={{ marginBottom: '16px', padding: '10px 14px', borderRadius: '6px', fontSize: '12px', fontFamily: mono, background: 'rgba(var(--brand-pink-rgb),0.1)', border: '1px solid rgba(var(--brand-pink-rgb),0.3)', color: 'var(--brand-pink)' }}>
                {wizError}
              </div>
            )}

            <div style={{ display: 'flex', gap: '8px' }}>
              <HoverBtn onClick={handleWizImport} disabled={wizSaving || wizParsing || !wizPreview || !wizCarrierId}>
                {wizSaving ? 'Importing…' : 'Import & activate'}
              </HoverBtn>
              <button onClick={() => setWizard(false)} disabled={wizSaving} style={{ ...btnGhost, opacity: wizSaving ? 0.5 : 1 }}>Cancel</button>
            </div>
          </>
        )}
      </Modal>
    </div>
  )
}
