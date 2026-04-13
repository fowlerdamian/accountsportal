import { Link } from 'react-router-dom'
import AppTile from '../components/AppTile.jsx'
import { APPS } from '../config/apps.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useTileSettings } from '../hooks/useTileSettings.js'
import { useIsAdmin } from '../hooks/useIsAdmin.js'

export default function PortalDashboard() {
  const { user } = useAuth()
  const { settings } = useTileSettings(user?.id)
  const { isAdmin } = useIsAdmin()

  const visibleApps = APPS.filter(app => {
    if (settings === null) return true
    return settings[app.route] !== false
  })

  const liveCount = visibleApps.filter(a => a.status === 'live' || a.status === 'beta').length

  return (
    <div style={{
      flex: 1, overflowY: 'auto',
      padding: '32px 24px',
      maxWidth: '1200px', margin: '0 auto', width: '100%', boxSizing: 'border-box',
    }}>

      {/* Page heading */}
      <div style={{ marginBottom: '24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: '18px', fontWeight: 600, color: '#ffffff', margin: 0, letterSpacing: '-0.01em' }}>
            Tools
          </h1>
          <p style={{ fontSize: '12px', color: '#a0a0a0', margin: '4px 0 0', fontFamily: '"JetBrains Mono", monospace' }}>
            {liveCount} available
          </p>
        </div>

        {isAdmin && (
          <Link
            to="/dashboard/settings"
            style={{
              fontSize: '11px', fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase',
              color: '#a0a0a0', background: 'none', border: '1px solid #222222', borderRadius: '4px',
              padding: '6px 12px', cursor: 'pointer', textDecoration: 'none',
              transition: 'color 120ms, border-color 120ms', display: 'inline-flex', alignItems: 'center', gap: '6px',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = '#f3ca0f'; e.currentTarget.style.borderColor = 'rgba(243,202,15,0.4)' }}
            onMouseLeave={e => { e.currentTarget.style.color = '#555'; e.currentTarget.style.borderColor = '#222222' }}
          >
            Manage Access
          </Link>
        )}
      </div>

      {/* Tile grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
        gap: '12px',
      }}>
        {visibleApps.map((app) => (
          <AppTile key={app.name} app={app} />
        ))}
      </div>
    </div>
  )
}
