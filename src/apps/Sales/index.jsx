// Sales — one app for the two sales tools: lead generation / call lists
// (SalesSupport) and the open-deal bubble field (Opportunities).
// Mounted at /sales/* inside the portal Layout; /sales-support and
// /opportunities redirect here.
import { lazy } from 'react'
import { NavLink, Routes, Route, useLocation } from 'react-router-dom'

const SalesSupport        = lazy(() => import('../SalesSupport/index.jsx'))
const OpportunityPressure = lazy(() => import('../Opportunities/OpportunityPressure'))

const TABS = [
  { label: 'Leads',         to: '/sales' },
  { label: 'Opportunities', to: '/sales/opportunities' },
]

export default function Sales() {
  const { pathname } = useLocation()
  const onOpportunities = pathname.startsWith('/sales/opportunities')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 48px)' }}>
      <nav style={{ display: 'flex', gap: '4px', padding: '0 18px', borderBottom: '1px solid #222222', flexShrink: 0 }}>
        {TABS.map((tab) => {
          const active = tab.to === '/sales' ? !onOpportunities : onOpportunities
          return (
            <NavLink
              key={tab.to}
              to={tab.to}
              style={{
                padding: '10px 12px',
                fontSize: '11px',
                fontWeight: 500,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                textDecoration: 'none',
                color: active ? 'var(--brand-accent)' : '#666',
                borderBottom: `2px solid ${active ? 'var(--brand-accent)' : 'transparent'}`,
                marginBottom: '-1px',
              }}
            >
              {tab.label}
            </NavLink>
          )
        })}
      </nav>
      <div style={{ flex: 1, minHeight: 0 }}>
        <Routes>
          <Route path="opportunities" element={<OpportunityPressure />} />
          <Route path="*" element={<SalesSupport />} />
        </Routes>
      </div>
    </div>
  )
}
