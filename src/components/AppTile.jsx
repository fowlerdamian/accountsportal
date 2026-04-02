import { Link } from 'react-router-dom'
import { useState } from 'react'

// ─── Status badge ─────────────────────────────────────────────────────────────

const STATUS_CONFIG = {
  live:          { label: 'Live',         color: '#22C55E', bg: 'rgba(34,197,94,0.1)',   border: 'rgba(34,197,94,0.25)'   },
  beta:          { label: 'Beta',         color: '#E8A838', bg: 'rgba(232,168,56,0.1)', border: 'rgba(232,168,56,0.25)' },
  'coming-soon': { label: 'Coming Soon', color: '#555',     bg: 'rgba(85,85,85,0.1)',   border: 'rgba(85,85,85,0.2)'    },
}

function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG['coming-soon']
  return (
    <span style={{
      fontSize: '9px',
      fontFamily: '"JetBrains Mono", monospace',
      fontWeight: 500,
      letterSpacing: '0.1em',
      textTransform: 'uppercase',
      color: cfg.color,
      background: cfg.bg,
      border: `1px solid ${cfg.border}`,
      borderRadius: '3px',
      padding: '2px 6px',
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
      background: '#111116',
      border: `1px solid ${hovered && !isComingSoon ? 'rgba(232,168,56,0.35)' : '#222228'}`,
      borderRadius: '8px',
      padding: '20px',
      display: 'flex',
      flexDirection: 'column',
      gap: '12px',
      opacity: isComingSoon ? 0.5 : 1,
      cursor: isComingSoon ? 'not-allowed' : 'pointer',
      transform: hovered && !isComingSoon ? 'translateY(-1px)' : 'none',
      boxShadow: hovered && !isComingSoon ? '0 4px 24px rgba(0,0,0,0.4)' : 'none',
      transition: 'border-color 150ms, transform 150ms, box-shadow 150ms',
      userSelect: 'none',
    }}>
      {/* Icon + badge row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <span style={{ fontSize: '28px', lineHeight: 1 }}>{app.icon}</span>
        <StatusBadge status={app.status} />
      </div>

      {/* Text */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <p style={{
          fontSize: '14px',
          fontWeight: 600,
          color: '#E5E5E5',
          margin: 0,
        }}>
          {app.name}
        </p>
        <p style={{
          fontSize: '12px',
          color: '#666',
          margin: 0,
          lineHeight: '1.5',
        }}>
          {app.description}
        </p>
      </div>

      {/* Arrow indicator for non-coming-soon */}
      {!isComingSoon && (
        <div style={{
          marginTop: 'auto',
          fontSize: '11px',
          fontFamily: '"JetBrains Mono", monospace',
          color: hovered ? '#E8A838' : '#3a3a3a',
          transition: 'color 150ms',
        }}>
          {app.external ? 'Open ↗' : 'Open →'}
        </div>
      )}
    </div>
  )
}

// ─── Exported tile (handles routing) ─────────────────────────────────────────

export default function AppTile({ app }) {
  const [hovered, setHovered] = useState(false)
  const isComingSoon = app.status === 'coming-soon'

  const card = <TileCard app={app} hovered={hovered} />

  const wrapperProps = {
    onMouseEnter: () => setHovered(true),
    onMouseLeave: () => setHovered(false),
    style: { textDecoration: 'none', display: 'block' },
  }

  if (isComingSoon) {
    return <div {...wrapperProps}>{card}</div>
  }

  if (app.external) {
    return (
      <a href={app.route} target="_blank" rel="noopener noreferrer" {...wrapperProps}>
        {card}
      </a>
    )
  }

  return (
    <Link to={app.route} {...wrapperProps}>
      {card}
    </Link>
  )
}
