import { Outlet, Link, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const ROUTE_LABELS = {
  '/dashboard':                  null,
  '/apps/profit':                'Accounts',
  '/apps/logistics':             'Logistics',
  '/apps/logistics/invoices':    'Logistics / Invoices',
  '/apps/logistics/rate-cards':  'Logistics / Rate Cards',
  '/apps/logistics/disputes':    'Logistics / Disputes',
  '/apps/purchase-orders':       'Purchasing',
  '/settings':                   'Settings',
}

export default function Layout() {
  const { user, signOut } = useAuth()
  const { pathname } = useLocation()
  const breadcrumb = ROUTE_LABELS[pathname]
    ?? (pathname.startsWith('/apps/logistics/invoices/') ? 'Logistics / Invoice Detail' : null)
  const guestEmail = !user ? localStorage.getItem('portal_guest_email') : user?.email

  return (
    <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column', background: '#000000' }}>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header
        style={{
          flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 24px', height: '48px', background: '#0a0a0a', borderBottom: '1px solid #222222',
        }}
      >
        {/* Left: back to dashboard + breadcrumb */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <Link
            to="/dashboard"
            style={{ display: 'flex', alignItems: 'center', gap: '8px', textDecoration: 'none' }}
          >
            <div style={{ width: '4px', height: '18px', borderRadius: '2px', background: '#f3ca0f' }} />
            <span style={{
              fontSize: '12px', fontWeight: 600, letterSpacing: '0.12em',
              textTransform: 'uppercase', color: '#ffffff',
            }}>
              Dashboard
            </span>
          </Link>

          {breadcrumb && (
            <>
              <span style={{ color: '#333', fontSize: '14px' }}>/</span>
              <span style={{ fontSize: '12px', color: '#666', fontFamily: '"JetBrains Mono", monospace' }}>
                {breadcrumb}
              </span>
            </>
          )}
        </div>

        {/* Right: user + sign out */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          {guestEmail && (
            <span style={{
              fontSize: '11px', fontFamily: '"JetBrains Mono", monospace', color: '#a0a0a0',
              maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {guestEmail}
            </span>
          )}
          <button
            onClick={signOut}
            style={{
              fontSize: '11px', fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase',
              color: '#666', background: 'none', border: '1px solid #222222', borderRadius: '4px',
              padding: '4px 10px', cursor: 'pointer', transition: 'color 120ms, border-color 120ms',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = '#f3ca0f'; e.currentTarget.style.borderColor = 'rgba(243,202,15,0.4)' }}
            onMouseLeave={e => { e.currentTarget.style.color = '#666'; e.currentTarget.style.borderColor = '#222222' }}
          >
            Sign out
          </button>
        </div>
      </header>

      {/* ── Page content ───────────────────────────────────────────────── */}
      <main style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <Outlet />
      </main>
    </div>
  )
}
