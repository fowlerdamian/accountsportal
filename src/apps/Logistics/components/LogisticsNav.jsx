import { NavLink, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { supabase } from '@portal/lib/supabase'

const tabs = [
  { label: 'Dashboard',  to: '/logistics',          end: true  },
  { label: 'Invoices',   to: '/logistics/invoices', end: false, flagKey: 'flagged'   },
  { label: 'Rate Cards', to: '/logistics/rate-cards', end: false },
  { label: 'Disputes',   to: '/logistics/disputes', end: false, flagKey: 'disputed'  },
]

export default function LogisticsNav() {
  const { pathname } = useLocation()
  const [flaggedCount,  setFlaggedCount]  = useState(0)
  const [disputedCount, setDisputedCount] = useState(0)

  const fetchCounts = async () => {
    const { data } = await supabase
      .from('freight_invoices')
      .select('status')
      .in('status', ['flagged', 'disputed'])
    if (data) {
      setFlaggedCount(data.filter(r => r.status === 'flagged').length)
      setDisputedCount(data.filter(r => r.status === 'disputed').length)
    }
  }

  useEffect(() => {
    fetchCounts()
    const channel = supabase
      .channel('logistics_nav_counts')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'freight_invoices' }, fetchCounts)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [])

  const badgeCount = { flagged: flaggedCount, disputed: disputedCount }

  return (
    <div
      className="flex flex-shrink-0 logistics-nav"
      style={{ borderBottom: '1px solid #222222', marginBottom: '24px' }}
    >
      {tabs.map((tab) => {
        const isActive = tab.end
          ? pathname === tab.to
          : pathname.startsWith(tab.to)
        const count = tab.flagKey ? badgeCount[tab.flagKey] : 0
        const isDanger = tab.flagKey === 'disputed'

        return (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className="flex items-center gap-2 px-5 py-3 text-sm font-medium transition-colors border-b-2 outline-none"
            style={{
              color: isActive ? '#f3ca0f' : '#666',
              borderBottomColor: isActive ? '#f3ca0f' : 'transparent',
              background: isActive ? 'rgba(243,202,15,0.04)' : 'transparent',
              textDecoration: 'none',
            }}
          >
            {tab.label}
            {count > 0 && (
              <span
                style={{
                  width: '7px',
                  height: '7px',
                  borderRadius: '50%',
                  background: isDanger ? '#ff1744' : '#f3ca0f',
                  flexShrink: 0,
                }}
              />
            )}
          </NavLink>
        )
      })}
    </div>
  )
}
