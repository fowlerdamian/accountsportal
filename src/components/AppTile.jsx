import { Link } from 'react-router-dom'
import { useState } from 'react'
import {
  BarChart3, Truck, ShoppingCart, Headphones, Wrench, BookOpen, Settings,
  Package, Users, DollarSign, TrendingUp, ClipboardCheck, ShieldCheck,
} from 'lucide-react'

// ─── Icon resolver ───────────────────────────────────────────────────────────

const ICON_MAP = {
  BarChart3, Truck, ShoppingCart, Headphones, Wrench, BookOpen, Settings,
  Package, Users, DollarSign, TrendingUp, ClipboardCheck, ShieldCheck,
}

function AppIcon({ name, size = 22, className = '' }) {
  const Icon = ICON_MAP[name]
  if (!Icon) return null
  return <Icon size={size} strokeWidth={1.5} className={className} />
}

// ─── Status badge ─────────────────────────────────────────────────────────────

const STATUS_CONFIG = {
  live:          { label: 'Live',        color: 'var(--status-success)', bg: 'rgba(96,165,126,0.1)',  border: 'rgba(96,165,126,0.25)' },
  beta:          { label: 'Beta',        color: 'var(--accent)',         bg: 'var(--accent-subtle)',   border: 'rgba(243,202,15,0.25)' },
  'coming-soon': { label: 'Coming Soon', color: 'var(--text-tertiary)',  bg: 'rgba(102,102,102,0.1)', border: 'rgba(102,102,102,0.2)' },
}

function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG['coming-soon']
  return (
    <span style={{
      fontSize: '11px', fontFamily: 'var(--font-mono)', fontWeight: 500,
      letterSpacing: '0.05em', textTransform: 'uppercase',
      color: cfg.color, background: cfg.bg,
      border: `1px solid ${cfg.border}`, borderRadius: '4px', padding: '4px 8px',
    }}>
      {cfg.label}
    </span>
  )
}

// ─── Tile card ────────────────────────────────────────────────────────────────

function TileCard({ app, hovered }) {
  const isComingSoon = app.status === 'coming-soon'
  return (
    <div style={{
      background: 'var(--bg-elevated)',
      border: `1px solid ${hovered && !isComingSoon ? 'rgba(243,202,15,0.35)' : 'var(--border-default)'}`,
      borderRadius: 'var(--radius-md)',
      padding: '24px',
      height: '100%', boxSizing: 'border-box',
      display: 'flex', flexDirection: 'column', gap: '16px',
      opacity: isComingSoon ? 0.5 : 1,
      cursor: isComingSoon ? 'not-allowed' : 'pointer',
      transform: hovered && !isComingSoon ? 'translateY(-1px)' : 'none',
      transition: 'border-color 150ms, transform 150ms, box-shadow 150ms',
      userSelect: 'none',
    }}>
      {/* Icon row */}
      <div style={{ display: 'flex', alignItems: 'flex-start' }}>
        <AppIcon name={app.icon} size={22} />
      </div>

      {/* Text */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <p style={{ fontSize: '15px', fontWeight: 500, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.01em' }}>
          {app.name}
        </p>
        <p style={{ fontSize: '14px', color: 'var(--text-secondary)', margin: 0, lineHeight: '1.5' }}>
          {app.description}
        </p>
      </div>

      {/* Arrow */}
      {!isComingSoon && (
        <div style={{
          marginTop: 'auto', fontSize: '12px',
          fontFamily: 'var(--font-mono)',
          color: hovered ? 'var(--accent)' : 'var(--text-disabled)',
          transition: 'color 150ms',
        }}>
          {app.external ? 'Open ↗' : 'Open →'}
        </div>
      )}
    </div>
  )
}

// ─── Exported tile ───────────────────────────────────────────────────────────

export default function AppTile({ app }) {
  const [hovered, setHovered] = useState(false)
  const isComingSoon = app.status === 'coming-soon'
  const card = <TileCard app={app} hovered={hovered} />
  const wrapperProps = {
    onMouseEnter: () => setHovered(true),
    onMouseLeave: () => setHovered(false),
    style: { textDecoration: 'none', display: 'block', height: '100%' },
  }

  if (isComingSoon) return <div {...wrapperProps} style={{ ...wrapperProps.style, height: '100%' }}>{card}</div>
  if (app.external) return <a href={app.route} target="_blank" rel="noopener noreferrer" {...wrapperProps}>{card}</a>
  return <Link to={app.route} {...wrapperProps}>{card}</Link>
}

export { ICON_MAP, AppIcon }
