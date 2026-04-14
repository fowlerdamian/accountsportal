import { Outlet, NavLink } from 'react-router-dom'
import { BarChart3, MessageSquare } from 'lucide-react'
import { useIsMobile } from '../../hooks/useIsMobile.js'

const NAV = [
  { label: 'Invoice Profit Analysis', shortLabel: 'P&L',  route: '/accounts',      icon: BarChart3,     end: true },
  { label: 'Xero Chatbot',            shortLabel: 'Xero', route: '/accounts/xero', icon: MessageSquare, end: false },
]

export default function AccountsLayout() {
  const isMobile = useIsMobile()

  if (isMobile) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
        {/* Top tab bar */}
        <nav style={{
          display: 'flex', flexShrink: 0,
          background: '#050505', borderBottom: '1px solid #1a1a1a',
        }}>
          {NAV.map(({ shortLabel, route, icon: Icon, end }) => (
            <NavLink
              key={route}
              to={route}
              end={end}
              style={({ isActive }) => ({
                flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
                gap: '4px', padding: '10px 8px', textDecoration: 'none',
                fontSize: '11px', fontFamily: '"JetBrains Mono", monospace',
                color: isActive ? '#fff' : '#555',
                borderBottom: isActive ? '2px solid #f3ca0f' : '2px solid transparent',
                background: isActive ? 'rgba(243,202,15,0.04)' : 'transparent',
                transition: 'color 120ms, border-color 120ms',
              })}
            >
              <Icon size={15} strokeWidth={1.5} />
              <span>{shortLabel}</span>
            </NavLink>
          ))}
        </nav>

        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <Outlet />
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>

      {/* Sidebar */}
      <aside style={{
        width: '200px',
        flexShrink: 0,
        background: '#050505',
        borderRight: '1px solid #1a1a1a',
        display: 'flex',
        flexDirection: 'column',
        padding: '20px 0',
      }}>
        <div style={{
          padding: '0 16px 16px',
          borderBottom: '1px solid #111',
          marginBottom: '8px',
        }}>
          <span style={{
            fontSize: '10px',
            fontFamily: '"JetBrains Mono", monospace',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: '#444',
          }}>
            Accounts
          </span>
        </div>

        <nav style={{ display: 'flex', flexDirection: 'column', gap: '2px', padding: '0 8px' }}>
          {NAV.map(({ label, route, icon: Icon, end }) => (
            <NavLink
              key={route}
              to={route}
              end={end}
              style={({ isActive }) => ({
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '9px 10px',
                borderRadius: '5px',
                textDecoration: 'none',
                fontSize: '13px',
                color: isActive ? '#fff' : '#666',
                background: isActive ? '#141414' : 'transparent',
                transition: 'background 120ms, color 120ms',
              })}
              className="accounts-nav-link"
            >
              <Icon size={14} strokeWidth={1.5} style={{ flexShrink: 0 }} />
              <span style={{ lineHeight: 1.3 }}>{label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <Outlet />
      </div>
    </div>
  )
}
