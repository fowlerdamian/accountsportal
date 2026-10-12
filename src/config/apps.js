// ─── App tile configuration ───────────────────────────────────────────────────
// icon: Lucide icon name (resolved in AppTile.jsx and Layout.jsx)
// status: 'live' | 'beta' | 'coming-soon'
// external: true  → opens in new tab (for tools hosted elsewhere)
// external: false → internal React Router route

export const APPS = [
  {
    name:        'Finance',
    route:       '/accounts',
    icon:        'BarChart3',
    status:      'live',
    external:    false,
  },
  {
    name:        'Logistics',
    route:       '/logistics',
    icon:        'Truck',
    status:      'live',
    external:    false,
  },
  {
    name:        'Purchasing',
    route:       '/purchase-orders',
    icon:        'ShoppingCart',
    status:      'live',
    external:    false,
  },
  {
    name:        'Cases',
    route:       '/support',
    icon:        'Headphones',
    status:      'live',
    external:    false,
  },
  {
    name:        'R&D',
    route:       '/projects',
    icon:        'Wrench',
    status:      'live',
    external:    false,
  },
  {
    name:        'Tasks',
    route:       '/tasks',
    icon:        'ClipboardCheck',
    status:      'live',
    external:    false,
  },
  {
    name:        'Guide Portal',
    route:       '/guide',
    icon:        'BookOpen',
    status:      'live',
    external:    false,
  },
  {
    name:        'Sales',
    route:       '/sales',
    icon:        'TrendingUp',
    status:      'live',
    external:    false,
  },
  {
    name:        'Marketing',
    route:       '/marketing',
    icon:        'Target',
    status:      'live',
    external:    false,
  },
  {
    name:        'Compliance',
    route:       '/compliance',
    icon:        'ShieldCheck',
    status:      'live',
    external:    false,
  },
  {
    name:        'Warehouse',
    route:       '/warehouse',
    icon:        'Package',
    status:      'live',
    external:    false,
  },
  {
    name:        'Settings',
    route:       '/settings',
    icon:        'Settings',
    status:      'live',
    external:    false,
  },
]
