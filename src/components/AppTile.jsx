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
          {app.submenu ? 'Choose ↓' : app.external ? 'Open ↗' : 'Open →'}
        </div>
      )}
    </div>
  )
}

// ─── Submenu tile ─────────────────────────────────────────────────────────────

function SubmenuTile({ app }) {
  const [hovered, setHovered] = useState(false)
  const [open, setOpen] = useState(false)

  return (
    <div
      style={{ position: 'relative', height: '100%' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        onClick={() => setOpen(o => !o)}
        style={{ textDecoration: 'none', display: 'block', height: '100%', cursor: 'pointer' }}
      >
        <TileCard app={{ ...app, external: false }} hovered={hovered} />
      </div>

      {open && (
        <>
          {/* Backdrop to close on outside click */}
          <div
            onClick={() => setOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 10 }}
          />
          {/* Submenu panel */}
          <div style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: '6px',
            zIndex: 20,
            background: '#0d0d0d',
            border: '1px solid #222',
            borderRadius: '8px',
            padding: '6px',
            minWidth: '220px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
          }}>
            {app.submenu.map(item => (
              <Link
                key={item.route}
                to={item.route}
                onClick={() => setOpen(false)}
                style={{
                  display: 'block',
                  padding: '10px 14px',
                  borderRadius: '5px',
                  fontSize: '13px',
                  color: '#ccc',
                  textDecoration: 'none',
                  transition: 'background 120ms, color 120ms',
                  fontFamily: 'inherit',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = '#1a1a1a'; e.currentTarget.style.color = '#fff' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#ccc' }}
              >
                {item.label} →
              </Link>
            ))}
          </div>
        </>
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

  if (app.submenu) return <SubmenuTile app={app} />
  if (isComingSoon) return <div {...wrapperProps} style={{ ...wrapperProps.style, height: '100%' }}>{card}</div>
  if (app.external) return <a href={app.route} target="_blank" rel="noopener noreferrer" {...wrapperProps}>{card}</a>
  return <Link to={app.route} {...wrapperProps}>{card}</Link>
}

export { ICON_MAP, AppIcon }
