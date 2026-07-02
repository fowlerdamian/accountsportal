import { NavLink, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { supabase } from '@portal/lib/supabase'

const tabs = [
  { label: 'Invoices',     to: '/logistics/invoices',     end: false, flagKey: 'flagged'  },
  { label: 'Disputes',     to: '/logistics/disputes',     end: false, flagKey: 'disputed' },
  { label: 'Manual Label', to: '/logistics/manual-label', end: false },
]

export default function LogisticsNav() {
  const { pathname } = useLocation()
  const [flaggedCount,  setFlaggedCount]  = useState(0)
  const [disputedCount, setDisputedCount] = useState(0)

  const fetchCounts = async () => {
    const [inv, disp] = await Promise.all([
      supabase.from('freight_invoices').select('id', { count: 'exact', head: true }).eq('status', 'flagged'),
      supabase.from('disputes').select('id', { count: 'exact', head: true }).in('status', ['draft', 'sent', 'acknowledged']),
    ])
    setFlaggedCount(inv.count ?? 0)
    setDisputedCount(disp.count ?? 0)
  }

  useEffect(() => {
    fetchCounts()
    const channel = supabase
      .channel('logistics_nav_counts')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'freight_invoices' }, fetchCounts)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'disputes' }, fetchCounts)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [])

  const badgeCount = { flagged: flaggedCount, disputed: disputedCount }

  return (
    <div
      className="flex flex-shrink-0 logistics-nav"
      style={{ borderBottom: '1px solid var(--border-default)', marginBottom: '24px' }}
    >
      {tabs.map((tab) => {
        const isActive = tab.end ? pathname === tab.to : pathname.startsWith(tab.to)
        const count = tab.flagKey ? badgeCount[tab.flagKey] : 0
        const isDanger = tab.flagKey === 'disputed'

        return (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className="flex items-center gap-2 px-5 py-3 text-sm font-medium transition-colors border-b-2 outline-none"
            style={{
              color: isActive ? 'var(--brand-accent)' : 'var(--text-tertiary)',
              borderBottomColor: isActive ? 'var(--brand-accent)' : 'transparent',
              background: isActive ? 'rgba(var(--brand-accent-rgb),0.04)' : 'transparent',
              textDecoration: 'none',
            }}
          >
            {tab.label}
            {count > 0 && (
              <span
                style={{
                  width: '7px', height: '7px', borderRadius: '50%',
                  background: isDanger ? 'var(--brand-pink)' : 'var(--brand-accent)',
                  flexShrink: 0,
                }}
              />
            )}
          </NavLink>
        )
      })}

      {/* Carriers = settings, right-aligned gear */}
      <NavLink
        to="/logistics/carriers"
        title="Carriers & settings"
        className="flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors border-b-2 outline-none"
        style={{
          marginLeft: 'auto',
          color: pathname.startsWith('/logistics/carriers') ? 'var(--brand-accent)' : 'var(--text-tertiary)',
          borderBottomColor: pathname.startsWith('/logistics/carriers') ? 'var(--brand-accent)' : 'transparent',
          background: pathname.startsWith('/logistics/carriers') ? 'rgba(var(--brand-accent-rgb),0.04)' : 'transparent',
          textDecoration: 'none',
        }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
        Carriers
      </NavLink>
    </div>
  )
}
