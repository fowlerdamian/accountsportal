// Tracking Lookup — paste any reference (Shopify order #, Cin7 invoice or SO
// number), get the tracking number(s) with a clickable carrier link. Nothing else.
import { useState } from 'react'
import { supabase } from '@portal/lib/supabase'
import LogisticsNav from './LogisticsNav.jsx'
import { pageWrap, card, mono, inputStyle, btnPrimary } from '../utils/ui.jsx'

export default function TrackingLookup() {
  const [reference, setReference] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)

  const lookup = async () => {
    const ref = reference.trim()
    if (!ref || busy) return
    setBusy(true)
    setResult(null)
    const { data, error } = await supabase.functions.invoke('tracking-lookup', { body: { reference: ref } })
    setResult(error ? { error: true } : data)
    setBusy(false)
  }

  return (
    <div className="flex flex-col h-full">
      <LogisticsNav />
      <div style={{ ...pageWrap, maxWidth: '560px' }}>
        <div style={{ ...card, padding: '20px' }}>
          <div style={{ display: 'flex', gap: '10px' }}>
            <input
              style={{ ...inputStyle, fontFamily: mono }}
              placeholder="Order # / Invoice # / SO number"
              value={reference}
              onChange={e => setReference(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && lookup()}
              autoFocus
            />
            <button style={{ ...btnPrimary, whiteSpace: 'nowrap', opacity: busy ? 0.5 : 1 }} disabled={busy} onClick={lookup}>
              {busy ? '…' : 'Lookup'}
            </button>
          </div>

          {result && (
            <div style={{ marginTop: '16px' }}>
              {result.error ? (
                <div style={{ fontSize: '13px', color: 'var(--brand-pink)' }}>Lookup failed</div>
              ) : !result.found ? (
                <div style={{ fontSize: '13px', color: 'var(--text-tertiary)' }}>No matching order</div>
              ) : result.tracking.length === 0 ? (
                <div style={{ fontSize: '13px', color: 'var(--text-tertiary)' }}>Not shipped yet</div>
              ) : (
                result.tracking.map(t => (
                  <div key={t.number} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 0' }}>
                    <a
                      href={t.url}
                      target="_blank"
                      rel="noreferrer"
                      style={{ fontFamily: mono, fontSize: '14px', color: 'var(--brand-accent)', textDecoration: 'none' }}
                    >
                      {t.number}
                    </a>
                    <span style={{ fontSize: '11px', fontFamily: mono, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                      {t.carrier}
                    </span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
