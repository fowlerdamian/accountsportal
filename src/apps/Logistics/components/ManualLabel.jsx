import { useEffect, useState } from 'react'
import { jsPDF } from 'jspdf'
import { supabase } from '@portal/lib/supabase'
import LogisticsNav from './LogisticsNav.jsx'
import AddressAutocomplete from '@portal/components/AddressAutocomplete.jsx'
import SavedAddressPicker from '@portal/components/SavedAddressPicker.jsx'
import { AGA_LOGO, TRAILBAIT_LOGO } from '../utils/labelLogos.js'

const BRAND_LOGO = { AGA: AGA_LOGO, TrailBait: TRAILBAIT_LOGO }

// ─── Brand "from" addresses ───────────────────────────────────────────────────
// AGA labels intentionally ship WITHOUT a return address.
// TrailBait ships from the Ribbon Gum warehouse. The full address is editable in
// the UI (persisted to localStorage) so staff can correct it without a redeploy.
const TRAILBAIT_FROM_DEFAULT = {
  name:     'TrailBait',
  line1:    '8 Ribbon Gum Avenue',
  line2:    '',
  suburb:   'Armidale',
  state:    'NSW',
  postcode: '2350',
  phone:    '',
}
const TRAILBAIT_FROM_KEY = 'logistics.trailbait_from'

const BRANDS = [
  { key: 'AGA',       label: 'AGA',       hasFrom: false },
  { key: 'TrailBait', label: 'TrailBait', hasFrom: true  },
]

const SIZES = [
  { key: '4x6', label: '4×6" label' },
  { key: 'A4',  label: 'A4 sheet'   },
]

const AU_STATES = ['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT']

const EMPTY_TO = { label: '', name: '', company: '', line1: '', line2: '', suburb: '', state: '', postcode: '', phone: '', courier: '' }

// ─── PDF generation ───────────────────────────────────────────────────────────
// A label is drawn inside a 101.6 × 152.4 mm (4×6") area. For the 4×6 size the
// area fills the page; for A4 it is positioned top-left with a cut border.
const LABEL_W = 101.6
const LABEL_H = 152.4

function addressLines(addr) {
  const lines = []
  if (addr.company)  lines.push(addr.company)
  if (addr.line1)    lines.push(addr.line1)
  if (addr.line2)    lines.push(addr.line2)
  const cityLine = [addr.suburb, addr.state, addr.postcode].filter(Boolean).join('  ')
  if (cityLine)      lines.push(cityLine)
  if (addr.country && addr.country !== 'Australia') lines.push(addr.country)
  if (addr.phone)    lines.push(`Ph: ${addr.phone}`)
  return lines
}

function drawLabel(doc, ox, oy, { brand, from, to, courier }) {
  const m = 6                       // inner margin
  const W = LABEL_W, H = LABEL_H

  // Outer border
  doc.setDrawColor(0)
  doc.setLineWidth(0.4)
  doc.rect(ox, oy, W, H)

  let y = oy + m + 4

  // Brand header — logo image, scaled to a fixed height, aspect preserved.
  const logo = BRAND_LOGO[brand]
  if (logo) {
    const logoH = 14                                  // mm
    const logoW = Math.min((logo.w / logo.h) * logoH, W - 2 * m)
    doc.addImage(logo.dataUri, 'PNG', ox + m, y - 6, logoW, logoH)
    y += logoH - 2
  } else {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(22)
    doc.text(brand, ox + m, y)
    y += 6
  }

  // FROM block (TrailBait only) — kept small/secondary.
  if (from) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.5)
    doc.text('FROM:', ox + m, y)
    y += 3
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    const fromLines = [from.name, ...addressLines(from)]
    for (const line of fromLines) {
      doc.text(line, ox + m, y)
      y += 3
    }
    y += 2
  } else {
    y += 2
  }

  // Divider
  doc.setLineWidth(0.3)
  doc.line(ox + m, y, ox + W - m, y)
  y += 9

  // SHIP TO block — the dominant element on the label.
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text('SHIP TO:', ox + m, y)
  y += 10

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(20)
  doc.text(to.name || '', ox + m, y)
  y += 10

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(16)
  for (const line of addressLines(to)) {
    doc.text(line, ox + m, y)
    y += 8.5
  }

  // Footer — Courier sits at the very bottom (bold, with a separator); the
  // generated timestamp is tucked just above it.
  if (courier) {
    doc.setDrawColor(0)
    doc.setLineWidth(0.3)
    doc.line(ox + m, oy + H - 13, ox + W - m, oy + H - 13)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(14)
    doc.setTextColor(0)
    doc.text(`Courier: ${courier}`, ox + m, oy + H - 4)
  }
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(120)
  doc.text(new Date().toLocaleString('en-AU'), ox + m, courier ? oy + H - 16 : oy + H - 4)
  doc.setTextColor(0)
}

function generatePdf({ size, brand, from, to, courier }) {
  let doc, ox, oy
  if (size === '4x6') {
    doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [LABEL_W, LABEL_H] })
    ox = 0; oy = 0
  } else {
    doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    ox = 10; oy = 10
  }
  drawLabel(doc, ox, oy, { brand, from, to, courier })
  const fname = `label_${brand}_${(to.name || 'recipient').replace(/[^a-z0-9]+/gi, '_')}_${size}.pdf`
  doc.save(fname)
}

// ─── Component ─────────────────────────────────────────────────────────────────
export default function ManualLabel() {
  const [brand,     setBrand]     = useState('TrailBait')
  const [size,      setSize]      = useState('4x6')
  const [to,        setTo]        = useState(EMPTY_TO)
  const [saveAddr,  setSaveAddr]  = useState(false)
  const [msg,       setMsg]       = useState(null)
  const [saving,    setSaving]    = useState(false)

  // TrailBait from address — editable, persisted to localStorage
  const [trailbaitFrom, setTrailbaitFrom] = useState(() => {
    try {
      const stored = localStorage.getItem(TRAILBAIT_FROM_KEY)
      return stored ? { ...TRAILBAIT_FROM_DEFAULT, ...JSON.parse(stored) } : TRAILBAIT_FROM_DEFAULT
    } catch { return TRAILBAIT_FROM_DEFAULT }
  })
  const [editFrom, setEditFrom] = useState(false)

  const flash = (type, text) => { setMsg({ type, text }); setTimeout(() => setMsg(null), 3000) }

  const updTo   = (field, value) => setTo(t => ({ ...t, [field]: value }))
  const updFrom = (field, value) => setTrailbaitFrom(f => ({ ...f, [field]: value }))

  const persistFrom = () => {
    try { localStorage.setItem(TRAILBAIT_FROM_KEY, JSON.stringify(trailbaitFrom)) } catch { /* ignore */ }
    setEditFrom(false)
    flash('ok', 'TrailBait return address saved')
  }

  const validTo = to.name.trim() && to.line1.trim() && to.suburb.trim() && to.state.trim() && to.postcode.trim()

  const handleGenerate = async () => {
    if (!validTo) { flash('err', 'Name, address line 1, suburb, state and postcode are required'); return }

    // Optionally save the destination address first
    if (saveAddr) {
      setSaving(true)
      const { data: { user } } = await supabase.auth.getUser()
      const { error } = await supabase.from('shipping_addresses').insert({
        label:    to.label.trim() || null,
        name:     to.name.trim(),
        company:  to.company.trim() || null,
        line1:    to.line1.trim(),
        line2:    to.line2.trim() || null,
        suburb:   to.suburb.trim(),
        state:    to.state.trim(),
        postcode: to.postcode.trim(),
        phone:    to.phone.trim() || null,
        courier:  to.courier.trim() || null,
        created_by: user?.id ?? null,
      })
      setSaving(false)
      if (error) { flash('err', `Could not save address: ${error.message}`); return }
      setSaveAddr(false)
    }

    const brandObj = BRANDS.find(b => b.key === brand)
    generatePdf({
      size,
      brand,
      courier: to.courier.trim(),
      from: brandObj.hasFrom ? trailbaitFrom : null,
      to:   { ...to, country: 'Australia' },
    })
    flash('ok', `${size === '4x6' ? '4×6"' : 'A4'} ${brand} label generated`)
  }

  // ─── Styles (match Logistics design language) ──────────────────────────────
  const inputStyle = {
    background: '#0a0a0a', border: '1px solid #222222', borderRadius: '6px',
    color: '#ffffff', fontSize: '13px', padding: '7px 10px', outline: 'none',
    fontFamily: 'inherit', width: '100%', boxSizing: 'border-box',
  }
  const labelStyle = {
    fontSize: '11px', fontFamily: '"JetBrains Mono", monospace', color: '#a0a0a0',
    textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: '6px',
  }
  const btnPrimary = {
    fontSize: '12px', fontWeight: 500, padding: '8px 18px', borderRadius: '6px',
    cursor: 'pointer', color: 'var(--brand-accent)', border: '1px solid rgba(var(--brand-accent-rgb),0.35)',
    background: 'transparent', transition: 'background 120ms',
  }
  const btnGhost = {
    fontSize: '12px', padding: '6px 14px', borderRadius: '6px',
    cursor: 'pointer', color: '#a0a0a0', border: '1px solid #222', background: 'transparent',
  }
  const cardStyle = { background: '#0a0a0a', border: '1px solid #1e1e1e', borderRadius: '8px', padding: '20px', marginBottom: '20px' }

  const Toggle = ({ options, value, onChange }) => (
    <div style={{ display: 'inline-flex', border: '1px solid #222222', borderRadius: '8px', overflow: 'hidden' }}>
      {options.map(opt => {
        const active = value === opt.key
        return (
          <button
            key={opt.key}
            onClick={() => onChange(opt.key)}
            style={{
              padding: '8px 18px', fontSize: '13px', fontWeight: 500, cursor: 'pointer', border: 'none',
              background: active ? 'rgba(var(--brand-accent-rgb),0.1)' : 'transparent',
              color: active ? 'var(--brand-accent)' : '#666', transition: 'color 120ms, background 120ms',
            }}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '32px 24px', maxWidth: '1200px', margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>

      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '18px', fontWeight: 600, color: '#ffffff', margin: 0, letterSpacing: '-0.01em' }}>
          Manual Shipping Label
        </h1>
        <p style={{ fontSize: '13px', color: '#a0a0a0', margin: '4px 0 0', fontFamily: '"JetBrains Mono", monospace' }}>
          Generate an AGA or TrailBait shipping label as a 4×6" or A4 PDF
        </p>
      </div>

      <LogisticsNav />

      {/* Flash message */}
      {msg && (
        <div style={{ marginBottom: '16px', padding: '10px 14px', borderRadius: '6px', fontSize: '12px', fontFamily: '"JetBrains Mono", monospace',
          background: msg.type === 'ok' ? 'rgba(var(--brand-aqua-rgb),0.1)' : 'rgba(var(--brand-pink-rgb),0.1)',
          border: `1px solid ${msg.type === 'ok' ? 'rgba(var(--brand-aqua-rgb),0.3)' : 'rgba(var(--brand-pink-rgb),0.3)'}`,
          color: msg.type === 'ok' ? 'var(--brand-aqua)' : 'var(--brand-pink)' }}>
          {msg.text}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px' }}>

        {/* ── Left column: options ───────────────────────────────────────────── */}
        <div>
          {/* Brand */}
          <div style={cardStyle}>
            <label style={labelStyle}>Label brand</label>
            <Toggle options={BRANDS} value={brand} onChange={setBrand} />

            {brand === 'AGA' && (
              <p style={{ fontSize: '12px', color: '#666', fontFamily: '"JetBrains Mono", monospace', margin: '14px 0 0' }}>
                AGA labels ship without a return address.
              </p>
            )}

            {brand === 'TrailBait' && (
              <div style={{ marginTop: '16px', borderTop: '1px solid #1e1e1e', paddingTop: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                  <label style={{ ...labelStyle, marginBottom: 0 }}>Return address (from)</label>
                  <button onClick={() => setEditFrom(v => !v)} style={{ ...btnGhost, padding: '4px 10px' }}>
                    {editFrom ? 'Done' : 'Edit'}
                  </button>
                </div>

                {!editFrom ? (
                  <div style={{ fontSize: '13px', color: '#AAA', lineHeight: 1.5 }}>
                    <div style={{ color: '#fff', fontWeight: 500 }}>{trailbaitFrom.name}</div>
                    {addressLines(trailbaitFrom).map((l, i) => <div key={i}>{l}</div>)}
                    {(!trailbaitFrom.suburb || !trailbaitFrom.state || !trailbaitFrom.postcode) && (
                      <div style={{ color: 'var(--brand-accent)', fontSize: '11px', fontFamily: '"JetBrains Mono", monospace', marginTop: '6px' }}>
                        ⚠ Incomplete — click Edit to add suburb / state / postcode
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ display: 'grid', gap: '8px' }}>
                    <input style={inputStyle} placeholder="Name"            value={trailbaitFrom.name}     onChange={e => updFrom('name', e.target.value)} />
                    <input style={inputStyle} placeholder="Address line 1"  value={trailbaitFrom.line1}    onChange={e => updFrom('line1', e.target.value)} />
                    <input style={inputStyle} placeholder="Address line 2"  value={trailbaitFrom.line2}    onChange={e => updFrom('line2', e.target.value)} />
                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '8px' }}>
                      <input style={inputStyle} placeholder="Suburb"   value={trailbaitFrom.suburb}   onChange={e => updFrom('suburb', e.target.value)} />
                      <select style={{ ...inputStyle, cursor: 'pointer' }} value={trailbaitFrom.state} onChange={e => updFrom('state', e.target.value)}>
                        <option value="">State</option>
                        {AU_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                      <input style={inputStyle} placeholder="Postcode" value={trailbaitFrom.postcode} onChange={e => updFrom('postcode', e.target.value)} />
                    </div>
                    <input style={inputStyle} placeholder="Phone (optional)" value={trailbaitFrom.phone} onChange={e => updFrom('phone', e.target.value)} />
                    <button onClick={persistFrom} style={{ ...btnPrimary, alignSelf: 'flex-start', padding: '6px 14px' }}>Save return address</button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Size */}
          <div style={cardStyle}>
            <label style={labelStyle}>Label size</label>
            <Toggle options={SIZES} value={size} onChange={setSize} />
            <p style={{ fontSize: '12px', color: '#666', fontFamily: '"JetBrains Mono", monospace', margin: '14px 0 0' }}>
              {size === '4x6' ? 'Thermal printer format (101.6 × 152.4 mm).' : 'Label printed top-left of an A4 sheet with a cut border.'}
            </p>
          </div>
        </div>

        {/* ── Right column: to address ───────────────────────────────────────── */}
        <div>
          <div style={cardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <label style={{ ...labelStyle, marginBottom: 0 }}>Ship to</label>
              <SavedAddressPicker onSelect={addr => { setTo(t => ({ ...t, ...addr })); flash('ok', 'Address loaded') }} />
            </div>

            {/* Google Maps address search — prefills the fields below */}
            <div style={{ marginBottom: '10px' }}>
              <AddressAutocomplete
                onResolved={addr => {
                  setTo(t => ({
                    ...t,
                    company:  addr.company  || t.company,
                    line1:    addr.line1    || t.line1,
                    line2:    addr.line2    || t.line2,
                    suburb:   addr.suburb   || t.suburb,
                    state:    addr.state    || t.state,
                    postcode: addr.postcode || t.postcode,
                    phone:    addr.phone    || t.phone,
                  }))
                  flash('ok', 'Address picked up from Google Maps')
                }}
              />
            </div>

            <div style={{ display: 'grid', gap: '10px' }}>
              <input style={inputStyle} placeholder="Recipient name *"  value={to.name}    onChange={e => updTo('name', e.target.value)} />
              <input style={inputStyle} placeholder="Company"           value={to.company} onChange={e => updTo('company', e.target.value)} />
              <input style={inputStyle} placeholder="Address line 1 *"  value={to.line1}   onChange={e => updTo('line1', e.target.value)} />
              <input style={inputStyle} placeholder="Address line 2"    value={to.line2}   onChange={e => updTo('line2', e.target.value)} />
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '10px' }}>
                <input style={inputStyle} placeholder="Suburb *"   value={to.suburb}   onChange={e => updTo('suburb', e.target.value)} />
                <select style={{ ...inputStyle, cursor: 'pointer' }} value={to.state} onChange={e => updTo('state', e.target.value)}>
                  <option value="">State *</option>
                  {AU_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <input style={inputStyle} placeholder="Postcode *" value={to.postcode} onChange={e => updTo('postcode', e.target.value)} />
              </div>
              <input style={inputStyle} placeholder="Phone (optional)" value={to.phone} onChange={e => updTo('phone', e.target.value)} />
              <input style={inputStyle} placeholder="Courier (optional) — printed at the bottom of the label" value={to.courier} onChange={e => updTo('courier', e.target.value)} />
            </div>

            {/* Save address */}
            <div style={{ marginTop: '16px', borderTop: '1px solid #1e1e1e', paddingTop: '14px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', color: '#AAA' }}>
                <input type="checkbox" checked={saveAddr} onChange={e => setSaveAddr(e.target.checked)} style={{ accentColor: 'var(--brand-accent)', width: '15px', height: '15px' }} />
                Save this address for next time
              </label>
              {saveAddr && (
                <input
                  style={{ ...inputStyle, marginTop: '10px' }}
                  placeholder="Nickname (optional, e.g. Main warehouse)"
                  value={to.label}
                  onChange={e => updTo('label', e.target.value)}
                />
              )}
            </div>
          </div>

          <button
            onClick={handleGenerate}
            disabled={!validTo || saving}
            style={{ ...btnPrimary, width: '100%', padding: '12px', fontSize: '13px', opacity: (!validTo || saving) ? 0.5 : 1, cursor: (!validTo || saving) ? 'not-allowed' : 'pointer' }}
            onMouseEnter={e => { if (validTo && !saving) e.currentTarget.style.background = 'rgba(var(--brand-accent-rgb),0.08)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
          >
            {saving ? 'Saving…' : `Generate ${size === '4x6' ? '4×6"' : 'A4'} ${brand} label PDF`}
          </button>
        </div>
      </div>
    </div>
  )
}
