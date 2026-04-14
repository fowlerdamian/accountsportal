import { Outlet, NavLink } from 'react-router-dom'
import { BarChart3, MessageSquare } from 'lucide-react'

const NAV = [
  { label: 'Invoice Profit Analysis', route: '/accounts',      icon: BarChart3,     end: true },
  { label: 'Xero Chatbot',            route: '/accounts/xero', icon: MessageSquare, end: false },
]

export default function AccountsLayout() {
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
