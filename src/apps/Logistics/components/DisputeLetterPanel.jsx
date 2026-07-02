import { useState } from 'react'
import { mono, btnGhost, FieldLabel } from '../utils/ui.jsx'

// Slide-in dispute letter panel: three copy-ready fields (To / Subject / Body)
// so the email is sent from the user's own mail client, plus draft saving and
// a "Mark as sent" action to keep the dispute pipeline tracking.

function CopyBtn({ value, disabled }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(value ?? ''); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
      disabled={disabled || !value}
      style={{
        fontSize: '11px', fontFamily: mono, padding: '3px 10px', borderRadius: '5px', cursor: (disabled || !value) ? 'not-allowed' : 'pointer',
        color: copied ? 'var(--brand-aqua)' : 'var(--brand-accent)',
        border: `1px solid ${copied ? 'rgba(var(--brand-aqua-rgb),0.4)' : 'rgba(var(--brand-accent-rgb),0.35)'}`,
        background: 'transparent', flexShrink: 0, opacity: (disabled || !value) ? 0.5 : 1,
      }}
    >
      {copied ? 'Copied ✓' : 'Copy text'}
    </button>
  )
}

function FieldRow({ label, value, children }) {
  return (
    <div style={{ marginBottom: '14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
        <FieldLabel>{label}</FieldLabel>
        <CopyBtn value={value} />
      </div>
      {children}
    </div>
  )
}

const roStyle = {
  width: '100%', boxSizing: 'border-box', background: 'var(--bg-surface)', border: '1px solid var(--border-default)',
  borderRadius: '6px', color: 'var(--text-primary)', fontSize: '13px', padding: '8px 10px',
  fontFamily: 'inherit', outline: 'none',
}

export default function DisputeLetterPanel({
  open, onClose, invoiceRef, carrierName, claimsEmail, claimsCc,
  letter, setLetter, busy, onMarkSent, onSaveDraft,
}) {
  const subject = `Invoice Dispute - ${invoiceRef ?? ''}`

  // Open a prefilled Gmail compose window (AGA is on Google Workspace).
  // Gmail's compose reliably prefills to/cc/subject but silently drops the
  // body param (new-Gmail regression, verified 2026-07) — so the body is
  // auto-copied to the clipboard for a single paste.
  const gmailAddr = (s) => (s ?? '').split(';').map(a => a.trim()).filter(Boolean).join(',')
  const [gmailOpened, setGmailOpened] = useState(false)
  const openInGmail = () => {
    navigator.clipboard.writeText(letter)
    const params = new URLSearchParams({ view: 'cm', fs: '1', to: gmailAddr(claimsEmail), su: subject })
    if (claimsCc) params.set('cc', gmailAddr(claimsCc))
    window.open(`https://mail.google.com/mail/?${params.toString()}`, '_blank')
    setGmailOpened(true)
    setTimeout(() => setGmailOpened(false), 6000)
  }
  return (
    <>
      {open && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 40 }} onClick={() => { if (!busy) onClose() }} />
      )}
      <div
        style={{
          position: 'fixed', right: 0, top: 0, height: '100%', width: '520px', maxWidth: '100vw',
          background: 'var(--bg-elevated)', borderLeft: '1px solid var(--border-default)',
          transform: open ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 220ms ease',
          zIndex: 50, display: 'flex', flexDirection: 'column', boxSizing: 'border-box',
        }}
      >
        {open && (
          <>
            <div style={{ padding: '20px 24px 14px', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
                <p style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                  Dispute email — {invoiceRef}
                </p>
                <button
                  onClick={onClose}
                  style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '18px', lineHeight: 1, padding: 0, flexShrink: 0 }}
                >
                  ×
                </button>
              </div>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '4px 0 0', fontFamily: mono }}>
                Opens Gmail with addresses + subject filled; the body is copied — just paste
              </p>
            </div>

            <div style={{ flex: 1, padding: '16px 24px', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
              <FieldRow label="To" value={claimsEmail ?? ''}>
                <input readOnly value={claimsEmail ?? ''} placeholder="No claims email — set one in Settings" style={roStyle} />
              </FieldRow>

              {claimsCc && (
                <FieldRow label="Cc" value={claimsCc}>
                  <input readOnly value={claimsCc} style={roStyle} />
                </FieldRow>
              )}

              <FieldRow label="Subject" value={subject}>
                <input readOnly value={subject} style={roStyle} />
              </FieldRow>

              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: '220px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <FieldLabel>Body</FieldLabel>
                  <CopyBtn value={letter} />
                </div>
                <textarea
                  value={letter}
                  onChange={e => setLetter(e.target.value)}
                  placeholder="Write the dispute letter…"
                  style={{
                    flex: 1, width: '100%', boxSizing: 'border-box',
                    background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: '6px',
                    color: 'var(--text-primary)', fontSize: '13px', padding: '14px',
                    fontFamily: mono, resize: 'none', outline: 'none', lineHeight: 1.7,
                  }}
                />
              </div>
            </div>

            <div style={{ padding: '14px 24px 22px', borderTop: '1px solid var(--border-subtle)', flexShrink: 0, display: 'flex', gap: '10px' }}>
              <button
                onClick={openInGmail}
                disabled={busy || !letter.trim()}
                style={{
                  flex: 1, fontSize: '13px', fontWeight: 600, padding: '9px 16px', borderRadius: '6px',
                  cursor: (busy || !letter.trim()) ? 'not-allowed' : 'pointer',
                  color: 'var(--accent-text)', background: 'var(--brand-accent)',
                  border: 'none', opacity: (busy || !letter.trim()) ? 0.5 : 1,
                }}
              >
                {gmailOpened ? 'Body copied — paste into Gmail (Ctrl+V)' : 'Open in Gmail'}
              </button>
              <button
                onClick={onMarkSent}
                disabled={busy || !letter.trim()}
                style={{
                  fontSize: '13px', fontWeight: 500, padding: '9px 16px', borderRadius: '6px',
                  cursor: (busy || !letter.trim()) ? 'not-allowed' : 'pointer',
                  color: 'var(--brand-aqua)', border: '1px solid rgba(var(--brand-aqua-rgb),0.4)', background: 'transparent',
                  opacity: (busy || !letter.trim()) ? 0.5 : 1,
                }}
              >
                {busy ? 'Saving…' : 'Mark as sent'}
              </button>
              <button
                onClick={onSaveDraft}
                disabled={busy || !letter.trim()}
                style={{ ...btnGhost, padding: '9px 16px', fontSize: '13px', opacity: (busy || !letter.trim()) ? 0.6 : 1 }}
              >
                Save draft
              </button>
            </div>
          </>
        )}
      </div>
    </>
  )
}
