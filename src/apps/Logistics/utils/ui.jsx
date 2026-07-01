// Shared Logistics UI primitives — all colours come from portal design tokens
// (src/index.css); no hardcoded hex so palette changes recolour this app.
import { useState, useCallback } from 'react'

export const mono = '"JetBrains Mono", monospace'

export const card = {
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border-subtle)',
  borderRadius: '8px',
}

export const pageWrap = {
  flex: 1, overflowY: 'auto', padding: '32px 24px',
  maxWidth: '1200px', margin: '0 auto', width: '100%', boxSizing: 'border-box',
}

export const sectionLabel = {
  fontSize: '11px', fontFamily: mono, color: 'var(--text-secondary)',
  textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 10px',
}

export const thStyle = (right = false) => ({
  padding: '10px 14px', textAlign: right ? 'right' : 'left', fontSize: '10px',
  fontFamily: mono, color: 'var(--text-tertiary)', textTransform: 'uppercase',
  letterSpacing: '0.08em', fontWeight: 500,
})

export const tdStyle = { padding: '11px 14px', fontSize: '13px' }

export const inputStyle = {
  background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: '6px',
  color: 'var(--text-primary)', fontSize: '13px', padding: '7px 10px', outline: 'none',
  fontFamily: 'inherit', width: '100%', boxSizing: 'border-box',
}

export const btnPrimary = {
  fontSize: '12px', fontWeight: 500, padding: '6px 14px', borderRadius: '6px',
  cursor: 'pointer', color: 'var(--brand-accent)', border: '1px solid rgba(var(--brand-accent-rgb),0.35)',
  background: 'transparent', transition: 'background 120ms',
}

export const btnGhost = {
  fontSize: '12px', padding: '6px 14px', borderRadius: '6px',
  cursor: 'pointer', color: 'var(--text-secondary)', border: '1px solid var(--border-default)',
  background: 'transparent',
}

// ─── Status colour maps ───────────────────────────────────────────────────────

const tint = (rgbVar, colorVar) => ({
  color: `var(${colorVar})`,
  background: `rgba(var(${rgbVar}),0.1)`,
  border: `1px solid rgba(var(${rgbVar}),0.3)`,
})
const greyTint = {
  color: 'var(--text-secondary)', background: 'var(--bg-surface)',
  border: '1px solid var(--border-default)',
}

export const INVOICE_STATUS_STYLE = {
  pending:  greyTint,
  matched:  tint('--brand-aqua-rgb', '--brand-aqua'),
  flagged:  tint('--brand-accent-rgb', '--brand-accent'),
  disputed: tint('--brand-pink-rgb', '--brand-pink'),
  approved: tint('--brand-aqua-rgb', '--brand-aqua'),
  resolved: tint('--brand-aqua-rgb', '--brand-blue'),
}

export const DISPUTE_STATUS_STYLE = {
  draft:        greyTint,
  sent:         tint('--brand-accent-rgb', '--brand-accent'),
  acknowledged: tint('--brand-aqua-rgb', '--brand-blue'),
  credited:     tint('--brand-aqua-rgb', '--brand-aqua'),
  rejected:     tint('--brand-pink-rgb', '--brand-pink'),
  written_off:  greyTint,
}

export function Badge({ map, value }) {
  const ss = map[value] ?? greyTint
  return (
    <span style={{ ...ss, display: 'inline-block', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontFamily: mono, textTransform: 'capitalize', whiteSpace: 'nowrap' }}>
      {String(value).replace('_', ' ')}
    </span>
  )
}

export function Spinner({ size = 28 }) {
  return (
    <div className="flex items-center justify-center" style={{ flex: 1 }}>
      <div className="rounded-full border-2 animate-spin" style={{ width: size, height: size, borderColor: 'var(--brand-accent)', borderTopColor: 'transparent' }} />
    </div>
  )
}

export function useFlash() {
  const [msg, setMsg] = useState(null)
  const flash = useCallback((type, text) => {
    setMsg({ type, text })
    setTimeout(() => setMsg(null), 3500)
  }, [])
  return [msg, flash]
}

export function Flash({ msg }) {
  if (!msg) return null
  const ok = msg.type === 'ok'
  return (
    <div style={{
      marginBottom: '16px', padding: '10px 14px', borderRadius: '6px', fontSize: '12px', fontFamily: mono,
      background: ok ? 'rgba(var(--brand-aqua-rgb),0.1)' : 'rgba(var(--brand-pink-rgb),0.1)',
      border: `1px solid ${ok ? 'rgba(var(--brand-aqua-rgb),0.3)' : 'rgba(var(--brand-pink-rgb),0.3)'}`,
      color: ok ? 'var(--brand-aqua)' : 'var(--brand-pink)',
    }}>
      {msg.text}
    </div>
  )
}

export function PageHeader({ title, subtitle, children }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px', gap: '12px', flexWrap: 'wrap' }}>
      <div>
        <h1 style={{ fontSize: '18px', fontWeight: 600, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.01em' }}>{title}</h1>
        {subtitle && <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '4px 0 0', fontFamily: mono }}>{subtitle}</p>}
      </div>
      {children && <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>{children}</div>}
    </div>
  )
}

export function HoverBtn({ style = btnPrimary, hoverBg = 'rgba(var(--brand-accent-rgb),0.08)', disabled, onClick, children }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{ ...style, opacity: disabled ? 0.5 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }}
      onMouseEnter={e => { if (!disabled) e.currentTarget.style.background = hoverBg }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
    >
      {children}
    </button>
  )
}

export function Modal({ open, onClose, width = 560, children }) {
  if (!open) return null
  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}
      onClick={onClose}
    >
      <div
        style={{ ...card, background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: '10px', width: '100%', maxWidth: `${width}px`, padding: '24px', maxHeight: '90vh', overflowY: 'auto' }}
        onClick={e => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}

export function FieldLabel({ children }) {
  return (
    <label style={{ fontSize: '11px', fontFamily: mono, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: '6px' }}>
      {children}
    </label>
  )
}

// Standard clickable table-row hover handlers
export const rowHover = {
  onMouseEnter: e => { e.currentTarget.style.background = 'var(--bg-hover)' },
  onMouseLeave: e => { e.currentTarget.style.background = 'transparent' },
}
