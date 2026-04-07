// ─── App tile configuration ───────────────────────────────────────────────────
// To add a new tool, append an object to this array.
// status: 'live' | 'beta' | 'coming-soon'
// external: true  → opens in new tab (for tools hosted elsewhere)
// external: false → internal React Router route

export const APPS = [
  {
    name:        'Profit Processor',
    description: 'Process and flag Cin7 Core Profit Summary Report exports',
    route:       '/apps/profit',
    icon:        '📊',
    status:      'live',
    external:    false,
  },
  {
    name:        'Logistics',
    description: 'Freight invoice management, rate card reconciliation, and dispute letters',
    route:       '/apps/logistics',
    icon:        '🚚',
    status:      'live',
    external:    false,
  },
  {
    name:        'Purchase Orders',
    description: 'Monitor PO due dates with live sync from Cin7 Core',
    route:       '/apps/purchase-orders',
    icon:        '📦',
    status:      'live',
    external:    false,
  },
  {
    name:        'Support Hub',
    description: 'Case management, action items, and warehouse task tracking',
    route:       '/support',
    icon:        '🎧',
    status:      'live',
    external:    false,
  },
  {
    name:        'Contractor Hub',
    description: 'Project and contractor management, time tracking, and AI assistant',
    route:       '/hub',
    icon:        '🏗️',
    status:      'live',
    external:    false,
  },
]
