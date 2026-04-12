import { useEffect, useState } from 'react'
import { supabase } from '@portal/lib/supabase'
import LogisticsNav from './LogisticsNav.jsx'

// ─── CSV parser ───────────────────────────────────────────────────────────────

function parseRateCsv(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) return { rows: [], skipped: [{ row: '—', reason: 'CSV has no data rows' }] }

  const headers = lines[0].split(',').map(h => h.trim().toLowerCase())
  const col = {
    service:        headers.indexOf('service'),
    lane:           headers.indexOf('lane'),
    rate:           headers.indexOf('rate'),
    effective_from: headers.indexOf('effective_from'),
    effective_to:   headers.indexOf('effective_to'),
  }

  const missingCols = ['service', 'lane', 'rate'].filter(k => col[k] === -1)
  if (missingCols.length) {
    return { rows: [], skipped: [{ row: '—', reason: `Missing required columns: ${missingCols.join(', ')}` }] }
  }

  const rows = []
  const skipped = []

  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',').map(c => c.trim())
    const service        = col.service        !== -1 ? (cells[col.service]        ?? '') : ''
    const lane           = col.lane           !== -1 ? (cells[col.lane]           ?? '') : ''
    const rate           = col.rate           !== -1 ? (cells[col.rate]           ?? '') : ''
    const effective_from = col.effective_from !== -1 ? (cells[col.effective_from] ?? '') : ''
    const effective_to   = col.effective_to   !== -1 ? (cells[col.effective_to]   ?? '') : ''
    const rowNum = i + 1

    if (!service) { skipped.push({ row: rowNum, reason: 'Missing service' }); continue }
    if (!lane)    { skipped.push({ row: rowNum, reason: 'Missing lane' });    continue }
    if (!rate)    { skipped.push({ row: rowNum, reason: 'Missing rate' });    continue }

    if (effective_from && isNaN(new Date(effective_from).getTime())) {
      skipped.push({ row: rowNum, reason: 'Invalid effective_from date' }); continue
    }
    if (effective_to && isNaN(new Date(effective_to).getTime())) {
      skipped.push({ row: rowNum, reason: 'Invalid effective_to date' }); continue
    }

    rows.push({ service, lane, rate, effective_from: effective_from || null, effective_to: effective_to || null })
  }

  return { rows, skipped }
}

function downloadTemplate() {
  const csv = [
    'service,lane,rate,effective_from,effective_to',
    'Road Express,SYD → MEL,$0.85/kg,2025-01-01,',
    'Fuel Levy,All lanes,18.5%,2025-01-01,',
  ].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url; a.download = 'rate_card_template.csv'; a.click()
  URL.revokeObjectURL(url)
}

// ─── Sub-tab bar ──────────────────────────────────────────────────────────────

function SubTab({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '8px 16px', fontSize: '12px', fontWeight: 500, cursor: 'pointer',
        background: 'transparent', border: 'none', borderBottom: `2px solid ${active ? '#f3ca0f' : 'transparent'}`,
        color: active ? '#f3ca0f' : '#666', transition: 'color 120ms',
      }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.color = '#AAA' }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.color = '#666' }}
    >
      {label}
    </button>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function RateCards() {
  const [carriers,      setCarriers]      = useState([])
  const [rateCards,     setRateCards]     = useState([])
  const [loading,       setLoading]       = useState(true)
  const [saving,        setSaving]        = useState(false)
  const [showForm,      setShowForm]      = useState(false)
  const [form,          setForm]          = useState({ carrier_id: '', service: '', lane: '', rate: '' })
  const [msg,           setMsg]           = useState(null)
  const [activeSubTab,  setActiveSubTab]  = useState('rates')

  // Upload modal state
  const [uploadModal,      setUploadModal]      = useState(false)    // open/closed
  const [uploadDone,       setUploadDone]       = useState(false)    // showing result
  const [uploadCarrierId,  setUploadCarrierId]  = useState('')
  const [uploadCsvText,    setUploadCsvText]    = useState('')
  const [uploadFile,       setUploadFile]       = useState(null)
  const [uploading,        setUploading]        = useState(false)
  const [uploadResult,     setUploadResult]     = useState(null)     // { added, superseded, skipped }

  // Carrier editing state
  const [carrierEdits,  setCarrierEdits]  = useState({})            // { [id]: { name, email, claims_email } }
  const [savingCarrier, setSavingCarrier] = useState(null)

  const fetchAll = async () => {
    const [carRes, rateRes] = await Promise.all([
      supabase.from('carriers').select('*').order('name'),
      supabase.from('rate_cards').select('*').order('service'),
    ])
    if (carRes.data)  setCarriers(carRes.data)
    if (rateRes.data) setRateCards(rateRes.data)
    setLoading(false)
  }

  useEffect(() => { fetchAll() }, [])

  const flash = (type, text) => { setMsg({ type, text }); setTimeout(() => setMsg(null), 3000) }

  // ─── Add rate ───────────────────────────────────────────────────────────────

  const handleAdd = async () => {
    if (!form.carrier_id || !form.service.trim() || !form.lane.trim() || !form.rate.trim()) {
      flash('err', 'All fields are required'); return
    }
    setSaving(true)
    const { error } = await supabase.from('rate_cards').insert({
      carrier_id: form.carrier_id,
      service:    form.service.trim(),
      lane:       form.lane.trim(),
      rate:       form.rate.trim(),
    })
    setSaving(false)
    if (error) { flash('err', error.message); return }
    flash('ok', 'Rate card added')
    setForm({ carrier_id: '', service: '', lane: '', rate: '' })
    setShowForm(false)
    fetchAll()
  }

  // ─── CSV upload ─────────────────────────────────────────────────────────────

  const openUploadModal = () => {
    setUploadCarrierId('')
    setUploadCsvText('')
    setUploadFile(null)
    setUploadResult(null)
    setUploadDone(false)
    setUploadModal(true)
  }

  const closeUploadModal = () => {
    setUploadModal(false)
    setUploadDone(false)
    setUploadResult(null)
    if (uploadResult?.added > 0) fetchAll()
  }

  const handleFileChange = (e) => {
    const file = e.target.files[0]
    if (!file) return
    setUploadFile(file)
    const reader = new FileReader()
    reader.onload = (ev) => setUploadCsvText(ev.target.result ?? '')
    reader.readAsText(file)
  }

  const handleUpload = async () => {
    if (!uploadCarrierId) { flash('err', 'Select a carrier'); return }
    if (!uploadCsvText)   { flash('err', 'Choose a CSV file'); return }

    const { rows, skipped } = parseRateCsv(uploadCsvText)
    const today = new Date().toISOString().slice(0, 10)

    setUploading(true)
    let added = 0, superseded = 0

    for (const row of rows) {
      // Find existing active rates for same carrier + service + lane
      const { data: existing } = await supabase
        .from('rate_cards')
        .select('id')
        .eq('carrier_id', uploadCarrierId)
        .eq('service', row.service)
        .eq('lane', row.lane)
        .is('effective_to', null)

      if (existing && existing.length > 0) {
        await supabase
          .from('rate_cards')
          .update({ effective_to: today })
          .in('id', existing.map(e => e.id))
        superseded += existing.length
      }

      const { error } = await supabase.from('rate_cards').insert({
        carrier_id:     uploadCarrierId,
        service:        row.service,
        lane:           row.lane,
        rate:           row.rate,
        effective_from: row.effective_from,
        effective_to:   row.effective_to,
      })
      if (!error) added++
    }

    setUploading(false)
    setUploadResult({ added, superseded, skipped })
    setUploadDone(true)
  }

  // ─── Carrier editing ────────────────────────────────────────────────────────

  const getCarrierEdit = (carrierId) => {
    const c = carriers.find(x => x.id === carrierId)
    return carrierEdits[carrierId] ?? { name: c?.name ?? '', email: c?.email ?? '', claims_email: c?.claims_email ?? '' }
  }

  const updateCarrierEdit = (carrierId, field, value) => {
    setCarrierEdits(prev => ({ ...prev, [carrierId]: { ...getCarrierEdit(carrierId), [field]: value } }))
  }

  const saveCarrier = async (carrierId) => {
    const edit = getCarrierEdit(carrierId)
    if (!edit.name.trim()) { flash('err', 'Carrier name is required'); return }
    setSavingCarrier(carrierId)
    const { error } = await supabase.from('carriers').update({
      name:        edit.name.trim(),
      email:       edit.email.trim() || null,
      claims_email: edit.claims_email.trim() || null,
    }).eq('id', carrierId)
    setSavingCarrier(null)
    if (error) { flash('err', error.message); return }
    flash('ok', 'Carrier updated')
    setCarriers(prev => prev.map(c => c.id === carrierId ? { ...c, name: edit.name.trim(), email: edit.email.trim() || null, claims_email: edit.claims_email.trim() || null } : c))
    setCarrierEdits(prev => { const next = { ...prev }; delete next[carrierId]; return next })
  }

  // ─── Styles ─────────────────────────────────────────────────────────────────

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

  if (loading) {
    return (
      <div className="flex items-center justify-center" style={{ flex: 1 }}>
        <div className="w-7 h-7 rounded-full border-2 animate-spin" style={{ borderColor: '#f3ca0f', borderTopColor: 'transparent' }} />
      </div>
    )
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '32px 24px', maxWidth: '1200px', margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
        <div>
          <h1 style={{ fontSize: '18px', fontWeight: 600, color: '#ffffff', margin: 0 }}>Rate Cards</h1>
          <p style={{ fontSize: '13px', color: '#a0a0a0', margin: '4px 0 0', fontFamily: '"JetBrains Mono", monospace' }}>Contracted freight rates by carrier and lane</p>
        </div>
        {activeSubTab === 'rates' && (
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={openUploadModal}
              style={btnPrimary}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(243,202,15,0.08)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
            >
              Upload rate card
            </button>
            <button
              onClick={() => setShowForm(v => !v)}
              style={btnPrimary}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(243,202,15,0.08)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
            >
              + Add rate
            </button>
          </div>
        )}
      </div>

      <LogisticsNav />

      {/* Sub-tab bar */}
      <div style={{ display: 'flex', borderBottom: '1px solid #1e1e1e', marginBottom: '24px' }}>
        <SubTab label="Rate Cards" active={activeSubTab === 'rates'}    onClick={() => setActiveSubTab('rates')} />
        <SubTab label="Carriers"   active={activeSubTab === 'carriers'} onClick={() => setActiveSubTab('carriers')} />
      </div>

      {/* Flash message */}
      {msg && (
        <div style={{ marginBottom: '16px', padding: '10px 14px', borderRadius: '6px', fontSize: '12px', fontFamily: '"JetBrains Mono", monospace',
          background: msg.type === 'ok' ? 'rgba(74,222,128,0.1)' : 'rgba(239,68,68,0.1)',
          border: `1px solid ${msg.type === 'ok' ? 'rgba(74,222,128,0.3)' : 'rgba(239,68,68,0.3)'}`,
          color: msg.type === 'ok' ? '#4ade80' : '#ff1744' }}>
          {msg.text}
        </div>
      )}

      {/* ── Rate Cards tab ─────────────────────────────────────────────────────── */}
      {activeSubTab === 'rates' && (
        <>
          {showForm && (
            <div style={{ background: '#0a0a0a', border: '1px solid #1e1e1e', borderRadius: '8px', padding: '16px', marginBottom: '24px' }}>
              <p style={{ fontSize: '11px', fontFamily: '"JetBrains Mono", monospace', color: '#a0a0a0', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 12px' }}>New rate card entry</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '10px', marginBottom: '12px' }}>
                <select
                  value={form.carrier_id}
                  onChange={e => setForm(f => ({ ...f, carrier_id: e.target.value }))}
                  style={{ ...inputStyle, cursor: 'pointer' }}
                >
                  <option value="">Carrier</option>
                  {carriers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <input style={inputStyle} placeholder="Service (e.g. Road Express)" value={form.service} onChange={e => setForm(f => ({ ...f, service: e.target.value }))} />
                <input style={inputStyle} placeholder="Lane (e.g. SYD → MEL)"      value={form.lane}    onChange={e => setForm(f => ({ ...f, lane: e.target.value }))} />
                <input style={inputStyle} placeholder="Rate (e.g. $0.85/kg)"        value={form.rate}    onChange={e => setForm(f => ({ ...f, rate: e.target.value }))} />
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={handleAdd}
                  disabled={saving}
                  style={{ ...btnPrimary, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.5 : 1 }}
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
                <button onClick={() => setShowForm(false)} style={btnGhost}>Cancel</button>
              </div>
            </div>
          )}

          {carriers.map(carrier => {
            const rates = rateCards.filter(r => r.carrier_id === carrier.id)
            return (
              <div key={carrier.id} style={{ marginBottom: '24px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                  <span style={{ fontSize: '14px', fontWeight: 600, color: '#ffffff' }}>{carrier.name}</span>
                  {carrier.email && <span style={{ fontSize: '12px', color: '#a0a0a0', fontFamily: '"JetBrains Mono", monospace' }}>{carrier.email}</span>}
                  <span style={{ marginLeft: 'auto', fontSize: '11px', color: '#444', fontFamily: '"JetBrains Mono", monospace' }}>{rates.length} rate{rates.length !== 1 ? 's' : ''}</span>
                </div>
                <div style={{ background: '#0a0a0a', border: '1px solid #1e1e1e', borderRadius: '8px', overflow: 'hidden' }}>
                  {rates.length === 0 ? (
                    <p style={{ padding: '16px', fontSize: '13px', color: '#444', fontFamily: '"JetBrains Mono", monospace', margin: 0 }}>
                      No rate card loaded — add rates above
                    </p>
                  ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid #1e1e1e' }}>
                          {['Service', 'Lane', 'Contracted Rate'].map((h, i) => (
                            <th key={h} style={{ padding: '10px 14px', textAlign: i === 2 ? 'right' : 'left', fontSize: '10px', fontFamily: '"JetBrains Mono", monospace', color: '#444', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500 }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rates.map(r => (
                          <tr key={r.id} style={{ borderBottom: '1px solid #181818', transition: 'background 120ms' }}
                            onMouseEnter={e => e.currentTarget.style.background = '#0a0a0a'}
                            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                            <td style={{ padding: '11px 14px', fontSize: '13px', color: '#AAA' }}>{r.service}</td>
                            <td style={{ padding: '11px 14px', fontSize: '12px', color: '#666', fontFamily: '"JetBrains Mono", monospace' }}>{r.lane}</td>
                            <td style={{ padding: '11px 14px', fontSize: '13px', color: '#f3ca0f', fontWeight: 500, textAlign: 'right' }}>{r.rate}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            )
          })}
        </>
      )}

      {/* ── Carriers tab ───────────────────────────────────────────────────────── */}
      {activeSubTab === 'carriers' && (
        <div style={{ background: '#0a0a0a', border: '1px solid #1e1e1e', borderRadius: '8px', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #1e1e1e' }}>
                {['Name', 'Billing Email', 'Claims Email', ''].map((h, i) => (
                  <th key={i} style={{ padding: '10px 14px', textAlign: 'left', fontSize: '10px', fontFamily: '"JetBrains Mono", monospace', color: '#444', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {carriers.map(carrier => {
                const edit  = getCarrierEdit(carrier.id)
                const dirty = JSON.stringify(edit) !== JSON.stringify({ name: carrier.name ?? '', email: carrier.email ?? '', claims_email: carrier.claims_email ?? '' })
                const isSaving = savingCarrier === carrier.id
                return (
                  <tr key={carrier.id} style={{ borderBottom: '1px solid #181818' }}>
                    <td style={{ padding: '10px 14px' }}>
                      <input
                        value={edit.name}
                        onChange={e => updateCarrierEdit(carrier.id, 'name', e.target.value)}
                        style={{ ...inputStyle, width: '180px' }}
                      />
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <input
                        value={edit.email}
                        onChange={e => updateCarrierEdit(carrier.id, 'email', e.target.value)}
                        placeholder="billing@carrier.com"
                        style={{ ...inputStyle, width: '220px' }}
                      />
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <input
                        value={edit.claims_email}
                        onChange={e => updateCarrierEdit(carrier.id, 'claims_email', e.target.value)}
                        placeholder="claims@carrier.com"
                        style={{ ...inputStyle, width: '220px' }}
                      />
                    </td>
                    <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                      <button
                        onClick={() => saveCarrier(carrier.id)}
                        disabled={!dirty || isSaving}
                        style={{ ...btnPrimary, opacity: (!dirty || isSaving) ? 0.4 : 1, cursor: (!dirty || isSaving) ? 'default' : 'pointer' }}
                        onMouseEnter={e => { if (dirty && !isSaving) e.currentTarget.style.background = 'rgba(243,202,15,0.08)' }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                      >
                        {isSaving ? 'Saving…' : 'Save'}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Upload modal ───────────────────────────────────────────────────────── */}
      {uploadModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
          <div style={{ background: '#0a0a0a', border: '1px solid #222222', borderRadius: '10px', width: '100%', maxWidth: '480px', padding: '24px' }}>

            {!uploadDone ? (
              <>
                <p style={{ fontSize: '14px', fontWeight: 600, color: '#ffffff', margin: '0 0 4px' }}>Upload rate card</p>
                <p style={{ fontSize: '12px', color: '#a0a0a0', fontFamily: '"JetBrains Mono", monospace', margin: '0 0 20px' }}>CSV will be appended — existing rates are not deleted</p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '20px' }}>
                  <div>
                    <label style={{ fontSize: '11px', fontFamily: '"JetBrains Mono", monospace', color: '#a0a0a0', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: '6px' }}>Carrier</label>
                    <select
                      value={uploadCarrierId}
                      onChange={e => setUploadCarrierId(e.target.value)}
                      style={{ ...inputStyle, cursor: 'pointer' }}
                    >
                      <option value="">Select carrier…</option>
                      {carriers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>

                  <div>
                    <label style={{ fontSize: '11px', fontFamily: '"JetBrains Mono", monospace', color: '#a0a0a0', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: '6px' }}>CSV File</label>
                    <input
                      type="file"
                      accept=".csv"
                      onChange={handleFileChange}
                      style={{ fontSize: '12px', color: '#AAA', fontFamily: '"JetBrains Mono", monospace', width: '100%' }}
                    />
                  </div>

                  <button
                    onClick={downloadTemplate}
                    style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: '12px', fontFamily: '"JetBrains Mono", monospace', color: '#a0a0a0', textAlign: 'left', transition: 'color 120ms' }}
                    onMouseEnter={e => { e.currentTarget.style.color = '#f3ca0f' }}
                    onMouseLeave={e => { e.currentTarget.style.color = '#555' }}
                  >
                    ↓ Download template
                  </button>
                </div>

                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    onClick={handleUpload}
                    disabled={uploading || !uploadCarrierId || !uploadCsvText}
                    style={{ ...btnPrimary, opacity: (uploading || !uploadCarrierId || !uploadCsvText) ? 0.5 : 1, cursor: (uploading || !uploadCarrierId || !uploadCsvText) ? 'not-allowed' : 'pointer' }}
                    onMouseEnter={e => { if (!uploading) e.currentTarget.style.background = 'rgba(243,202,15,0.08)' }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                  >
                    {uploading ? 'Uploading…' : 'Upload'}
                  </button>
                  <button onClick={closeUploadModal} style={btnGhost}>Cancel</button>
                </div>
              </>
            ) : (
              <>
                <p style={{ fontSize: '14px', fontWeight: 600, color: '#ffffff', margin: '0 0 16px' }}>Upload complete</p>

                <div style={{ background: '#0a0a0a', border: '1px solid #1e1e1e', borderRadius: '6px', padding: '14px', marginBottom: '16px', fontSize: '13px', fontFamily: '"JetBrains Mono", monospace' }}>
                  <p style={{ margin: '0 0 4px', color: '#4ade80' }}>{uploadResult.added} rate{uploadResult.added !== 1 ? 's' : ''} added</p>
                  {uploadResult.superseded > 0 && <p style={{ margin: '0 0 4px', color: '#f3ca0f' }}>{uploadResult.superseded} existing rate{uploadResult.superseded !== 1 ? 's' : ''} superseded</p>}
                  {uploadResult.skipped.length > 0 && <p style={{ margin: '0 0 4px', color: '#ff1744' }}>{uploadResult.skipped.length} row{uploadResult.skipped.length !== 1 ? 's' : ''} skipped</p>}
                </div>

                {uploadResult.skipped.length > 0 && (
                  <div style={{ marginBottom: '16px' }}>
                    <p style={{ fontSize: '11px', fontFamily: '"JetBrains Mono", monospace', color: '#a0a0a0', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 8px' }}>Skipped rows</p>
                    <div style={{ background: '#0a0a0a', border: '1px solid #1e1e1e', borderRadius: '6px', overflow: 'hidden' }}>
                      {uploadResult.skipped.map((s, i) => (
                        <div key={i} style={{ padding: '8px 12px', borderBottom: i < uploadResult.skipped.length - 1 ? '1px solid #181818' : 'none', fontSize: '12px', fontFamily: '"JetBrains Mono", monospace' }}>
                          <span style={{ color: '#a0a0a0' }}>Row {s.row} · </span>
                          <span style={{ color: '#ff1744' }}>{s.reason}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <button
                  onClick={closeUploadModal}
                  style={btnPrimary}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(243,202,15,0.08)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                >
                  Done
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
