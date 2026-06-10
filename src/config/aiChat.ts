// ─── Ask AI chat configuration ────────────────────────────────────────────────
// Single source of truth for where the Ask AI button appears and which context
// each app's chat uses.
//
// Visibility is a DENYLIST: the button shows on every authenticated route
// unless listed in HIDDEN_ROUTES — so a brand-new app gets Ask AI with zero
// changes here. Add an entry to APP_CHAT_CONTEXTS only when the app should get
// its own label, suggestions, and data context (mirror it with a case in
// supabase/functions/chat/index.ts; unknown contexts fall back to the
// cross-business "dashboard" prompt server-side).

export type AppContext =
  | 'dashboard' | 'support' | 'sales-support' | 'logistics'
  | 'compliance' | 'accounts' | 'purchase-orders' | 'projects'
  | 'guide' | 'tasks'

export interface ChatContextEntry {
  prefix:      string
  context:     AppContext
  label:       string
  suggestions: string[]
}

// First prefix match wins — keep more specific prefixes before their parents.
export const APP_CHAT_CONTEXTS: ChatContextEntry[] = [
  {
    prefix: '/sales-support', context: 'sales-support', label: 'Sales Support',
    suggestions: ["What's on today's call list?", 'Show me top leads by score', 'How many leads per channel?'],
  },
  {
    prefix: '/support', context: 'support', label: 'Customer Service',
    suggestions: ['How many open cases?', "What's overdue?", 'Show me urgent cases'],
  },
  {
    prefix: '/logistics', context: 'logistics', label: 'Logistics',
    suggestions: ['Show disputed invoices', "What's our freight spend this month?", 'Any unresolved disputes?'],
  },
  {
    prefix: '/projects', context: 'projects', label: 'Projects',
    suggestions: ['What tasks are overdue?', 'Show active projects', 'Who has the most open tasks?'],
  },
  {
    prefix: '/tasks', context: 'tasks', label: 'Tasks',
    suggestions: ['What are my open tasks?', "What's blocked right now?", 'What is due this week?'],
  },
  {
    prefix: '/compliance', context: 'compliance', label: 'Compliance',
    suggestions: ['Which documents need updating?', "What's our ISO audit status?", 'Show incomplete sections'],
  },
  {
    prefix: '/accounts', context: 'accounts', label: 'Accounts',
    suggestions: ['Show me the latest profit report', 'Flag any low-margin lines', 'Compare this month to last'],
  },
  {
    prefix: '/purchase-orders', context: 'purchase-orders', label: 'Purchasing',
    suggestions: ['What POs are overdue?', 'Show POs due this week', 'Any critical outstanding orders?'],
  },
  {
    prefix: '/guide', context: 'guide', label: 'Guide Portal',
    suggestions: ['How many guides are published?', 'Show recent feedback', 'Which guides need updating?'],
  },
]

// Fallback for the dashboard and any app without its own entry.
export const DEFAULT_CHAT_CONTEXT: ChatContextEntry = {
  prefix: '/', context: 'dashboard', label: 'Portal',
  suggestions: ['What needs attention today?', 'Show me open cases', "What's on the call list?"],
}

// Routes where the chat must never appear (unauthenticated or auth flows).
export const HIDDEN_ROUTES = ['/login', '/reset-password']

export function detectChatContext(pathname: string): ChatContextEntry {
  return (
    APP_CHAT_CONTEXTS.find(e => pathname === e.prefix || pathname.startsWith(e.prefix + '/')) ??
    DEFAULT_CHAT_CONTEXT
  )
}

export function shouldShowChat(pathname: string, isAuthenticated: boolean): boolean {
  if (!isAuthenticated) return false
  // Public guide-viewer subdomains (guide.trailbait.com.au etc.) are
  // customer-facing — never overlay staff chat there.
  if (window.location.hostname.startsWith('guide.')) return false
  return !HIDDEN_ROUTES.some(r => pathname === r || pathname.startsWith(r + '/'))
}
