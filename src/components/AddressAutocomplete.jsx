import { useEffect, useRef, useState } from 'react'
import { supabase } from '@portal/lib/supabase'

// Globally reusable Google Maps (Places) address autocomplete.
// Type an address → live AU predictions → on select the structured address is
// returned via onResolved({ line1, line2, suburb, state, postcode, country }).
// The Google API key never reaches the browser — calls go through the `places`
// Supabase edge function.
//
// Usage:
//   <AddressAutocomplete onResolved={addr => setForm(f => ({ ...f, ...addr }))} />

const DEFAULT_INPUT_STYLE = {
  background: '#0a0a0a', border: '1px solid #222222', borderRadius: '6px',
  color: '#ffffff', fontSize: '13px', padding: '7px 10px', outline: 'none',
  fontFamily: 'inherit', width: '100%', boxSizing: 'border-box',
}

function newToken() {
  try { return crypto.randomUUID() } catch { return String(Math.random()).slice(2) }
}

export default function AddressAutocomplete({
  onResolved,
  placeholder = 'Search address (Google Maps)…',
  inputStyle,
  autoFocus = false,
}) {
  const [query,       setQuery]       = useState('')
  const [predictions, setPredictions] = useState([])
  const [open,        setOpen]        = useState(false)
  const [loading,     setLoading]     = useState(false)
  const [highlight,   setHighlight]   = useState(-1)
  const tokenRef = useRef(newToken())
  const boxRef   = useRef(null)
  const debounce = useRef(null)

  // Close on outside click
  useEffect(() => {
    const onDoc = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const runSearch = (input) => {
    if (debounce.current) clearTimeout(debounce.current)
    if (input.trim().length < 3) { setPredictions([]); setOpen(false); return }
    debounce.current = setTimeout(async () => {
      setLoading(true)
      const { data, error } = await supabase.functions.invoke('places', {
        body: { action: 'autocomplete', input, sessiontoken: tokenRef.current },
      })
      setLoading(false)
      if (error) { setPredictions([]); return }
      setPredictions(data?.predictions ?? [])
      setHighlight(-1)
      setOpen(true)
    }, 250)
  }

  const handleChange = (e) => {
    const v = e.target.value
    setQuery(v)
    runSearch(v)
  }

  const select = async (p) => {
    setQuery(p.description)
    setOpen(false)
    setPredictions([])
    const { data, error } = await supabase.functions.invoke('places', {
      body: { action: 'details', place_id: p.place_id, sessiontoken: tokenRef.current },
    })
    tokenRef.current = newToken()  // end of billing session
    if (error || !data?.address) return
    onResolved?.(data.address, { formatted: data.formatted, description: p.description })
  }

  const onKeyDown = (e) => {
    if (!open || predictions.length === 0) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => Math.min(h + 1, predictions.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(h => Math.max(h - 1, 0)) }
    else if (e.key === 'Enter' && highlight >= 0) { e.preventDefault(); select(predictions[highlight]) }
    else if (e.key === 'Escape') { setOpen(false) }
  }

  const style = inputStyle ?? DEFAULT_INPUT_STYLE

  return (
    <div ref={boxRef} style={{ position: 'relative', width: '100%' }}>
      <input
        value={query}
        onChange={handleChange}
        onKeyDown={onKeyDown}
        onFocus={() => { if (predictions.length) setOpen(true) }}
        placeholder={placeholder}
        autoFocus={autoFocus}
        style={style}
        autoComplete="off"
      />
      {loading && (
        <span style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', fontSize: '11px', color: '#666', fontFamily: '"JetBrains Mono", monospace' }}>…</span>
      )}
      {open && predictions.length > 0 && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 60,
          background: '#0d0d0d', border: '1px solid #222222', borderRadius: '8px', overflow: 'hidden',
          boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
        }}>
          {predictions.map((p, i) => (
            <button
              key={p.place_id}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); select(p) }}
              onMouseEnter={() => setHighlight(i)}
              style={{
                display: 'flex', alignItems: 'center', gap: '8px', width: '100%', textAlign: 'left',
                padding: '9px 12px', border: 'none', cursor: 'pointer', fontSize: '13px',
                color: i === highlight ? '#f3ca0f' : '#ccc',
                background: i === highlight ? 'rgba(243,202,15,0.06)' : 'transparent',
                borderBottom: i < predictions.length - 1 ? '1px solid #181818' : 'none',
              }}
            >
              <span style={{ color: '#555', fontSize: '12px' }}>📍</span>
              {p.description}
            </button>
          ))}
          <div style={{ padding: '5px 12px', fontSize: '9px', color: '#444', fontFamily: '"JetBrains Mono", monospace', textAlign: 'right', borderTop: '1px solid #181818' }}>
            powered by Google
          </div>
        </div>
      )}
    </div>
  )
}
