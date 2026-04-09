// ─── App tile configuration ───────────────────────────────────────────────────
// icon: Lucide icon name (resolved in AppTile.jsx and Layout.jsx)
// status: 'live' | 'beta' | 'coming-soon'
// external: true  → opens in new tab (for tools hosted elsewhere)
// external: false → internal React Router route

export const APPS = [
  {
    name:        'Accounts',
    description: 'Process and flag Cin7 Core Profit Summary Report exports',
    route:       '/apps/profit',
    icon:        'BarChart3',
    status:      'live',
    external:    false,
  },
  {
    name:        'Logistics',
    description: 'Freight invoice management, rate card reconciliation, and dispute letters',
    route:       '/apps/logistics',
    icon:        'Truck',
    status:      'live',
    external:    false,
  },
  {
    name:        'Purchasing',
    description: 'Monitor PO due dates with live sync from Cin7 Core',
    route:       '/apps/purchase-orders',
    icon:        'ShoppingCart',
    status:      'live',
    external:    false,
  },
  {
    name:        'Customer Service',
    description: 'Case management, action items, and warehouse task tracking',
    route:       '/support',
    icon:        'Headphones',
    status:      'live',
    external:    false,
  },
  {
    name:        'Projects',
    description: 'Project and contractor management, time tracking, and AI assistant',
    route:       '/hub',
    icon:        'Wrench',
    status:      'live',
    external:    false,
  },
  {
    name:        'Guide Portal',
    description: 'Product guides, categories, brands, and customer feedback management',
    route:       '/guide',
    icon:        'BookOpen',
    status:      'live',
    external:    false,
  },
  {
    name:        'Settings',
    description: 'Account details, login links, and user role & tile access management',
    route:       '/settings',
    icon:        'Settings',
    status:      'live',
    external:    false,
  },
]
