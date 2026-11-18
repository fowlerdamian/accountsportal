// ─── App tile configuration ───────────────────────────────────────────────────
// icon: Lucide icon name (resolved in AppTile.jsx and Layout.jsx)
// status: 'live' | 'beta' | 'coming-soon'
// external: true  → opens in new tab (for tools hosted elsewhere)
// external: false → internal React Router route
// shortcut: letter for the "g <letter>" keyboard shortcut (useGlobalKeyboardShortcuts)
//
// This list is the single source for app names, routes and shortcuts: the
// dashboard tiles, tab titles, header breadcrumb, shortcuts and the per-user
// access check (ProtectedRoute) all read it.

export const APPS = [
  {
    name:        'Finance',
    route:       '/accounts',
    shortcut:    'a',
    icon:        'BarChart3',
    status:      'live',
    external:    false,
  },
  {
    name:        'Logistics',
    route:       '/logistics',
    shortcut:    'l',
    icon:        'Truck',
    status:      'live',
    external:    false,
  },
  {
    name:        'Purchasing',
    route:       '/purchase-orders',
    shortcut:    'o',
    icon:        'ShoppingCart',
    status:      'live',
    external:    false,
  },
  {
    name:        'Cases',
    route:       '/support',
    shortcut:    's',
    icon:        'Headphones',
    status:      'live',
    external:    false,
  },
  {
    name:        'R&D',
    route:       '/projects',
    shortcut:    'p',
    icon:        'Wrench',
    status:      'live',
    external:    false,
  },
  {
    name:        'Tasks',
    route:       '/tasks',
    shortcut:    't',
    icon:        'ClipboardCheck',
    status:      'live',
    external:    false,
  },
  {
    name:        'Guide Portal',
    route:       '/guide',
    shortcut:    'g',
    icon:        'BookOpen',
    status:      'live',
    external:    false,
  },
  {
    name:        'Sales',
    route:       '/sales',
    shortcut:    'x',
    icon:        'TrendingUp',
    status:      'live',
    external:    false,
  },
  {
    name:        'Marketing',
    route:       '/marketing',
    shortcut:    'm',
    icon:        'Target',
    status:      'live',
    external:    false,
  },
  {
    name:        'Compliance',
    route:       '/compliance',
    shortcut:    'c',
    icon:        'ShieldCheck',
    status:      'live',
    external:    false,
  },
  {
    name:        'Warehouse',
    route:       '/warehouse',
    shortcut:    'w',
    icon:        'Package',
    status:      'live',
    external:    false,
  },
  {
    name:        'Settings',
    route:       '/settings',
    shortcut:    'e',
    icon:        'Settings',
    status:      'live',
    external:    false,
  },
]

// The app a path belongs to (longest route prefix wins), or undefined.
export function appForPath(pathname) {
  return APPS
    .filter(app => pathname === app.route || pathname.startsWith(app.route + '/'))
    .sort((x, y) => y.route.length - x.route.length)[0]
}
