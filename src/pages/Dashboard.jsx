import { Link } from 'react-router-dom'
import AppTile from '../components/AppTile.jsx'
import { APPS } from '../config/apps.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useTileSettings } from '../hooks/useTileSettings.js'
import { useIsAdmin } from '../hooks/useIsAdmin.js'

export default function PortalDashboard() {
  const { user } = useAuth()
  const { settings } = useTileSettings(user?.id)
  const isAdmin = useIsAdmin()

  // settings === null means still loading — show all while loading
  const visibleApps = APPS.filter(app => {
    if (settings === null) return true
    // If there's an explicit false entry, hide it; otherwise show
    return settings[app.route] !== false
  })

  const liveCount = visibleApps.filter(a => a.status === 'live' || a.status === 'beta').length

  return (
    <div style={{
      flex: 1,
      overflowY: 'auto',
      padding: '40px 24px',
      maxWidth: '1200px',
      margin: '0 auto',
      width: '100%',
      boxSizing: 'border-box',
    }}>

      {/* Page heading */}
      <div style={{ marginBottom: '32px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{
            fontSize: '18px',
            fontWeight: 600,
            color: '#E5E5E5',
            margin: 0,
            letterSpacing: '-0.01em',
          }}>
            Tools
          </h1>
          <p style={{
            fontSize: '13px',
            color: '#555',
            margin: '4px 0 0',
            fontFamily: '"JetBrains Mono", monospace',
          }}>
            {liveCount} available
          </p>
        </div>

        {isAdmin && (
          <Link
            to="/dashboard/settings"
            style={{
              fontSize: '11px',
              fontWeight: 500,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: '#555',
              background: 'none',
              border: '1px solid #282828',
              borderRadius: '4px',
              padding: '6px 12px',
              cursor: 'pointer',
              textDecoration: 'none',
              transition: 'color 120ms, border-color 120ms',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = '#E8A838'; e.currentTarget.style.borderColor = 'rgba(232,168,56,0.4)' }}
            onMouseLeave={e => { e.currentTarget.style.color = '#555'; e.currentTarget.style.borderColor = '#282828' }}
          >
            Manage Access
          </Link>
        )}
      </div>

      {/* Tile grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
        gap: '16px',
      }}>
        {visibleApps.map((app) => (
          <AppTile key={app.name} app={app} />
        ))}
      </div>
    </div>
  )
}
