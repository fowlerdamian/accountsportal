import { NavLink, useLocation } from 'react-router-dom'

// Sub-apps of the Warehouse tile. Add a row here and a <Route> in ../index.jsx.
export const WAREHOUSE_TABS = [
  { label: 'Barcodes', to: '/warehouse/barcodes', description: 'Product barcode labels from Cin7 — PDF or DYMO' },
]

export default function WarehouseNav() {
  const { pathname } = useLocation()
  return (
    <div
      className="flex flex-shrink-0"
      style={{ borderBottom: '1px solid var(--border-default)', marginBottom: '24px' }}
    >
      {WAREHOUSE_TABS.map((tab) => {
        const isActive = pathname.startsWith(tab.to)
        return (
          <NavLink
            key={tab.to}
            to={tab.to}
            className="flex items-center gap-2 px-5 py-3 text-sm font-medium transition-colors border-b-2 outline-none"
            style={{
              color: isActive ? 'var(--brand-accent)' : 'var(--text-tertiary)',
              borderBottomColor: isActive ? 'var(--brand-accent)' : 'transparent',
              background: isActive ? 'rgba(var(--brand-accent-rgb),0.04)' : 'transparent',
              textDecoration: 'none',
            }}
          >
            {tab.label}
          </NavLink>
        )
      })}
    </div>
  )
}
