import { Outlet, Link, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

// ─── Breadcrumb label for the current route ───────────────────────────────────

const ROUTE_LABELS = {
  '/dashboard':                  null,              // no breadcrumb on home
  '/apps/profit':                'Profit Processor',
  '/apps/logistics':             'Logistics',
  '/apps/logistics/invoices':    'Logistics / Invoices',
  '/apps/logistics/rate-cards':  'Logistics / Rate Cards',
  '/apps/logistics/disputes':    'Logistics / Disputes',
}

export default function Layout() {
  const { user, signOut } = useAuth()
  const { pathname } = useLocation()
  const breadcrumb = ROUTE_LABELS[pathname]
    ?? (pathname.startsWith('/apps/logistics/invoices/') ? 'Logistics / Invoice Detail' : null)

  return (
    <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column', background: '#080808' }}>

      {/* ── Global header ──────────────────────────────────────────────────── */}
      <header
        style={{
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 24px',
          height: '48px',
          background: '#0c0c0e',
          borderBottom: '1px solid #1e1e22',
        }}
      >
        {/* Left: wordmark + optional breadcrumb */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <Link
            to="/dashboard"
            style={{ display: 'flex', alignItems: 'center', gap: '8px', textDecoration: 'none' }}
          >
            <div style={{ width: '4px', height: '18px', borderRadius: '2px', background: '#E8A838' }} />
            <span style={{
              fontSize: '12px',
              fontWeight: 600,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: '#E5E5E5',
            }}>
              AGA Tools
            </span>
          </Link>

          {breadcrumb && (
            <>
              <span style={{ color: '#333', fontSize: '14px' }}>/</span>
              <span style={{ fontSize: '12px', color: '#666', fontFamily: 'inherit' }}>
                {breadcrumb}
              </span>
            </>
          )}
        </div>

        {/* Right: user email + sign out */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <span style={{
            fontSize: '11px',
            fontFamily: '"JetBrains Mono", monospace',
            color: '#555',
            maxWidth: '240px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {user?.email}
          </span>
          <button
            onClick={signOut}
            style={{
              fontSize: '11px',
              fontWeight: 500,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: '#666',
              background: 'none',
              border: '1px solid #282828',
              borderRadius: '4px',
              padding: '4px 10px',
              cursor: 'pointer',
              transition: 'color 120ms, border-color 120ms',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = '#E8A838'
              e.currentTarget.style.borderColor = 'rgba(232,168,56,0.4)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = '#666'
              e.currentTarget.style.borderColor = '#282828'
            }}
          >
            Sign out
          </button>
        </div>
      </header>

      {/* ── Page content ───────────────────────────────────────────────────── */}
      <main style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <Outlet />
      </main>
    </div>
  )
}
