// Tracking Lookup — paste any reference (Shopify order #, Cin7 invoice or SO
// number), get the tracking number(s) with a clickable carrier link. A secondary
// field looks up by customer/company name: all matches newest→oldest with dates,
// 5 at a time with View more. Nothing else.
import { useState } from 'react'
import { supabase } from '@portal/lib/supabase'
import LogisticsNav from './LogisticsNav.jsx'
import { pageWrap, card, mono, sectionLabel, inputStyle, btnPrimary, btnGhost } from '../utils/ui.jsx'

const fmtDate = (d) => {
  if (!d) return '—'
  const dt = new Date(d)
  return isNaN(dt) ? '—' : dt.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })
}

const TrackingLinks = ({ tracking }) =>
  tracking.length === 0 ? (
    <span style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>Not shipped yet</span>
  ) : (
    tracking.map(t => (
      <span key={t.number} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', marginRight: '14px' }}>
        <a
          href={t.url}
          target="_blank"
          rel="noreferrer"
          style={{ fontFamily: mono, fontSize: '13px', color: 'var(--brand-accent)', textDecoration: 'none' }}
        >
          {t.number}
        </a>
        <span style={{ fontSize: '10px', fontFamily: mono, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {t.carrier}
        </span>
      </span>
    ))
  )

export default function TrackingLookup() {
  // Reference lookup
  const [reference, setReference] = useState('')
  const [refBusy, setRefBusy] = useState(false)
  const [refResult, setRefResult] = useState(null)

  // Customer lookup
  const [customer, setCustomer] = useState('')
  const [custBusy, setCustBusy] = useState(false)
  const [custError, setCustError] = useState(false)
  const [entries, setEntries] = useState(null)
  const [hasMore, setHasMore] = useState(false)

  const lookupRef = async () => {
    const ref = reference.trim()
    if (!ref || refBusy) return
    setRefBusy(true)
    setRefResult(null)
    const { data, error } = await supabase.functions.invoke('tracking-lookup', { body: { reference: ref } })
    setRefResult(error ? { error: true } : data)
    setRefBusy(false)
  }

  const lookupCustomer = async (offset = 0) => {
    const name = customer.trim()
    if (!name || custBusy) return
    setCustBusy(true)
    setCustError(false)
    if (offset === 0) { setEntries(null); setHasMore(false) }
    const { data, error } = await supabase.functions.invoke('tracking-lookup', { body: { customer: name, offset } })
    if (error || data?.error) {
      setCustError(true)
    } else {
      setEntries(prev => offset === 0 ? data.entries : [...(prev ?? []), ...data.entries])
      setHasMore(data.hasMore)
    }
    setCustBusy(false)
  }

  return (
    <div className="flex flex-col h-full">
      <LogisticsNav />
      <div style={{ ...pageWrap, maxWidth: '640px' }}>

        {/* ── Reference lookup ── */}
        <div style={{ ...card, padding: '20px' }}>
          <p style={sectionLabel}>Reference number</p>
          <div style={{ display: 'flex', gap: '10px' }}>
            <input
              style={{ ...inputStyle, fontFamily: mono }}
              placeholder="Order # / Invoice # / SO number"
              value={reference}
              onChange={e => setReference(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && lookupRef()}
              autoFocus
            />
            <button style={{ ...btnPrimary, whiteSpace: 'nowrap', opacity: refBusy ? 0.5 : 1 }} disabled={refBusy} onClick={lookupRef}>
              {refBusy ? '…' : 'Lookup'}
            </button>
          </div>

          {refResult && (
            <div style={{ marginTop: '16px' }}>
              {refResult.error ? (
                <div style={{ fontSize: '13px', color: 'var(--brand-pink)' }}>Lookup failed</div>
              ) : !refResult.found ? (
                <div style={{ fontSize: '13px', color: 'var(--text-tertiary)' }}>No matching order</div>
              ) : (
                <TrackingLinks tracking={refResult.tracking} />
              )}
            </div>
          )}
        </div>

        {/* ── Customer / company lookup ── */}
        <div style={{ ...card, padding: '20px', marginTop: '16px' }}>
          <p style={sectionLabel}>No reference? Search by customer</p>
          <div style={{ display: 'flex', gap: '10px' }}>
            <input
              style={inputStyle}
              placeholder="Customer / company name"
              value={customer}
              onChange={e => setCustomer(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && lookupCustomer(0)}
            />
            <button style={{ ...btnPrimary, whiteSpace: 'nowrap', opacity: custBusy ? 0.5 : 1 }} disabled={custBusy} onClick={() => lookupCustomer(0)}>
              {custBusy && !entries ? '…' : 'Lookup'}
            </button>
          </div>

          {custError && (
            <div style={{ marginTop: '16px', fontSize: '13px', color: 'var(--brand-pink)' }}>Lookup failed</div>
          )}
          {entries && entries.length === 0 && !custError && (
            <div style={{ marginTop: '16px', fontSize: '13px', color: 'var(--text-tertiary)' }}>No matching orders</div>
          )}
          {entries && entries.length > 0 && (
            <div style={{ marginTop: '12px' }}>
              {entries.map(e => (
                <div
                  key={`${e.orderNumber}-${e.date}`}
                  style={{ padding: '10px 0', borderBottom: '1px solid var(--border-subtle)' }}
                >
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'baseline', marginBottom: '4px' }}>
                    <span style={{ fontSize: '12px', fontFamily: mono, color: 'var(--text-secondary)' }}>{fmtDate(e.date)}</span>
                    <span style={{ fontSize: '11px', fontFamily: mono, color: 'var(--text-tertiary)' }}>{e.orderNumber}</span>
                  </div>
                  <TrackingLinks tracking={e.tracking} />
                </div>
              ))}
              {hasMore && (
                <button
                  style={{ ...btnGhost, marginTop: '12px', opacity: custBusy ? 0.5 : 1 }}
                  disabled={custBusy}
                  onClick={() => lookupCustomer(entries.length)}
                >
                  {custBusy ? '…' : 'View more'}
                </button>
              )}
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
