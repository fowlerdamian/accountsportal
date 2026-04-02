import AppTile from '../components/AppTile.jsx'
import { APPS } from '../config/apps.js'

export default function PortalDashboard() {
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
      <div style={{ marginBottom: '32px' }}>
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
          {APPS.filter(a => a.status === 'live' || a.status === 'beta').length} available
        </p>
      </div>

      {/* Tile grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
        gap: '16px',
      }}>
        {APPS.map((app) => (
          <AppTile key={app.name} app={app} />
        ))}
      </div>
    </div>
  )
}
