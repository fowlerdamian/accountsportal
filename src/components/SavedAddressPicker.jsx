import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@portal/lib/supabase'

// Globally reusable saved-address picker. Renders a button that opens a modal
// with a live search bar over the shared `shipping_addresses` table. Selecting a
// result returns the full address via onSelect(address).
//
// Usage:
//   <SavedAddressPicker onSelect={addr => setForm(f => ({ ...f, ...addr }))} />

const DEFAULT_BTN_STYLE = {
  fontSize: '12px', fontWeight: 500, padding: '7px 14px', borderRadius: '6px',
  cursor: 'pointer', color: '#a0a0a0', border: '1px solid #222', background: 'transparent',
  whiteSpace: 'nowrap',
}

const inputStyle = {
  background: '#0a0a0a', border: '1px solid #222222', borderRadius: '6px',
  color: '#ffffff', fontSize: '14px', padding: '10px 12px', outline: 'none',
  fontFamily: 'inherit', width: '100%', boxSizing: 'border-box',
}

function oneLine(a) {
  return [a.line1, a.line2, a.suburb, a.state, a.postcode].filter(Boolean).join(', ')
}

export default function SavedAddressPicker({ onSelect, buttonLabel = 'Saved addresses', buttonStyle }) {
  const [open,      setOpen]      = useState(false)
  const [rows,      setRows]      = useState([])
  const [loading,   setLoading]   = useState(false)
  const [query,     setQuery]     = useState('')
  const [confirmId, setConfirmId] = useState(null)
  const searchRef = useRef(null)

  const fetchRows = async () => {
    setLoading(true)
    const { data } = await supabase
      .from('shipping_addresses')
      .select('*')
      .order('created_at', { ascending: false })
    setRows(data ?? [])
    setLoading(false)
  }

  useEffect(() => {
    if (open) { fetchRows(); setQuery(''); setConfirmId(null); setTimeout(() => searchRef.current?.focus(), 50) }
  }, [open])

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    if (open) document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(a =>
      [a.label, a.name, a.company, a.line1, a.line2, a.suburb, a.state, a.postcode, a.phone]
        .filter(Boolean).join(' ').toLowerCase().includes(q)
    )
  }, [rows, query])

  const choose = (a) => {
    onSelect?.({
      label: a.label ?? '', name: a.name ?? '', company: a.company ?? '',
      line1: a.line1 ?? '', line2: a.line2 ?? '', suburb: a.suburb ?? '',
      state: a.state ?? '', postcode: a.postcode ?? '', phone: a.phone ?? '',
      courier: a.courier ?? '',
    })
    setOpen(false)
  }

  const remove = async (id) => {
    await supabase.from('shipping_addresses').delete().eq('id', id)
    setRows(rows => rows.filter(r => r.id !== id))
    setConfirmId(null)
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={buttonStyle ?? DEFAULT_BTN_STYLE}
        onMouseEnter={e => { e.currentTarget.style.color = 'var(--brand-accent)'; e.currentTarget.style.borderColor = 'rgba(var(--brand-accent-rgb),0.35)' }}
        onMouseLeave={e => { e.currentTarget.style.color = (buttonStyle?.color ?? '#a0a0a0'); e.currentTarget.style.borderColor = '#222' }}
      >
        🔖 {buttonLabel}
      </button>

      {open && (
        <div
          onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false) }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 80, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '10vh 24px 24px' }}
        >
          <div style={{ background: '#0a0a0a', border: '1px solid #222222', borderRadius: '12px', width: '100%', maxWidth: '520px', maxHeight: '70vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '16px 16px 12px', borderBottom: '1px solid #1a1a1a' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <span style={{ fontSize: '14px', fontWeight: 600, color: '#fff' }}>Saved addresses</span>
                <button type="button" onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', color: '#666', fontSize: '18px', cursor: 'pointer', lineHeight: 1 }}>×</button>
              </div>
              <input
                ref={searchRef}
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search by name, company, suburb, postcode…"
                style={inputStyle}
                autoComplete="off"
              />
            </div>

            <div style={{ overflowY: 'auto', flex: 1 }}>
              {loading ? (
                <p style={{ padding: '24px', textAlign: 'center', color: '#555', fontSize: '13px', fontFamily: '"JetBrains Mono", monospace' }}>Loading…</p>
              ) : filtered.length === 0 ? (
                <p style={{ padding: '24px', textAlign: 'center', color: '#555', fontSize: '13px', fontFamily: '"JetBrains Mono", monospace' }}>
                  {rows.length === 0 ? 'No saved addresses yet.' : 'No matches.'}
                </p>
              ) : (
                filtered.map(a => (
                  <div
                    key={a.id}
                    style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid #161616', transition: 'background 120ms' }}
                    onMouseEnter={e => e.currentTarget.style.background = '#0e0e0e'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <button
                      type="button"
                      onClick={() => choose(a)}
                      style={{ flex: 1, textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: '11px 16px' }}
                    >
                      <div style={{ fontSize: '13px', color: '#fff', fontWeight: 500 }}>
                        {a.label || a.name}
                        {a.label && a.name && <span style={{ color: '#888', fontWeight: 400 }}> · {a.name}</span>}
                      </div>
                      <div style={{ fontSize: '12px', color: '#777', fontFamily: '"JetBrains Mono", monospace', marginTop: '2px' }}>{oneLine(a)}</div>
                    </button>
                    {confirmId === a.id ? (
                      <span style={{ display: 'flex', gap: '4px', paddingRight: '12px' }}>
                        <button type="button" onClick={() => remove(a.id)} style={{ fontSize: '11px', fontWeight: 600, color: '#fff', background: 'var(--brand-pink)', border: '1px solid var(--brand-pink)', borderRadius: '4px', padding: '4px 10px', cursor: 'pointer' }}>Delete</button>
                        <button type="button" onClick={() => setConfirmId(null)} style={{ fontSize: '11px', color: '#888', background: 'none', border: '1px solid #222', borderRadius: '4px', padding: '4px 10px', cursor: 'pointer' }}>Cancel</button>
                      </span>
                    ) : (
                      <button type="button" onClick={() => setConfirmId(a.id)} title="Delete address"
                        style={{ display: 'flex', alignItems: 'center', gap: '5px', background: 'none', border: '1px solid #2a2a2a', borderRadius: '6px', color: '#999', fontSize: '12px', cursor: 'pointer', padding: '6px 10px', margin: '0 12px' }}
                        onMouseEnter={e => { e.currentTarget.style.color = 'var(--brand-pink)'; e.currentTarget.style.borderColor = 'rgba(var(--brand-pink-rgb),0.4)' }}
                        onMouseLeave={e => { e.currentTarget.style.color = '#999'; e.currentTarget.style.borderColor = '#2a2a2a' }}
                      >🗑 Delete</button>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
