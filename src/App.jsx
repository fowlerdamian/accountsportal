import { BrowserRouter, Routes, Route, Navigate, useParams, useLocation } from 'react-router-dom'
import { lazy, Suspense, useEffect } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from './context/AuthContext.jsx'
import { AuthProvider as GuideAuthProvider } from './apps/Guide/contexts/AuthContext'
import ProtectedRoute from './components/ProtectedRoute.jsx'
import Layout from './components/Layout.jsx'
import GlobalChat from './components/GlobalChat'
import LoginPage from './components/LoginPage.jsx'
import PortalDashboard from './pages/Dashboard.jsx'
import TileSettings from './pages/TileSettings.jsx'
import Settings from './pages/Settings.jsx'
import ResetPassword from './pages/ResetPassword.jsx'
import { TaskDock } from './components/TaskDock'
import { GlobalShortcuts } from './components/GlobalShortcuts'
import { GlobalMentions } from './components/GlobalMentions'
import { DelegatePromptDialog } from './apps/Tasks/components/DelegatePromptDialog'

// App modules are code-split: each route chunk loads on first visit instead of
// shipping every app (recharts, three.js, jspdf, …) in one bundle on refresh.
const ProfitProcessor = lazy(() => import('./apps/ProfitProcessor/index.jsx'))
const PurchaseOrders = lazy(() => import('./apps/PurchaseOrders/index.jsx'))
const InvoiceList = lazy(() => import('./apps/Logistics/components/InvoiceList.jsx'))
const InvoiceDetail = lazy(() => import('./apps/Logistics/components/InvoiceDetail.jsx'))
const Carriers = lazy(() => import('./apps/Logistics/components/Carriers.jsx'))
const Disputes = lazy(() => import('./apps/Logistics/components/Disputes.jsx'))
const ManualLabel = lazy(() => import('./apps/Logistics/components/ManualLabel.jsx'))
const TrackingLookup = lazy(() => import('./apps/Logistics/components/TrackingLookup.jsx'))
const SupportApp = lazy(() => import('./apps/Support/SupportApp'))
const SalesSupport = lazy(() => import('./apps/SalesSupport/index.jsx'))
const OpportunityPressure = lazy(() => import('./apps/Opportunities/OpportunityPressure'))
const Marketing = lazy(() => import('./apps/Marketing/index.jsx'))
const ComplianceApp = lazy(() => import('./apps/Compliance/index'))
const XeroChat = lazy(() => import('./apps/Xero/index'))
const AccountsLayout = lazy(() => import('./apps/Accounts/AccountsLayout'))
const ChatFunctions = lazy(() => import('./apps/Accounts/ChatFunctions.jsx'))
const FinanceDashboard = lazy(() => import('./apps/Accounts/finance/FinanceDashboard.jsx'))
const RevenueTargets = lazy(() => import('./apps/Accounts/finance/RevenueTargets.jsx'))
const CashFlow = lazy(() => import('./apps/Accounts/finance/CashFlow.jsx'))

// Contractor Hub
const ContractorsList = lazy(() => import('./apps/ContractorHub/pages/ContractorsList'))
const ContractorProfile = lazy(() => import('./apps/ContractorHub/pages/ContractorProfile'))
const ProjectsList = lazy(() => import('./apps/ContractorHub/pages/ProjectsList'))
const ProjectView = lazy(() => import('./apps/ContractorHub/pages/ProjectView'))
const HubSettings = lazy(() => import('./apps/ContractorHub/pages/HubSettings'))

// Tasks (staff_tasks app)
const TasksApp = lazy(() => import('./apps/Tasks/TasksApp'))
const TaskWidget = lazy(() => import('./apps/Tasks/pages/TaskWidget'))

// Guide Portal
const AdminLayout = lazy(() => import('./apps/Guide/admin/AdminLayout').then((m) => ({ default: m.AdminLayout })))
const GuidesList = lazy(() => import('./apps/Guide/pages/admin/GuidesList'))
const GuideEditor = lazy(() => import('./apps/Guide/pages/admin/GuideEditor'))
const GuideShare = lazy(() => import('./apps/Guide/pages/admin/GuideShare'))
const GuideReports = lazy(() => import('./apps/Guide/pages/admin/Reports'))
const GuideSupport = lazy(() => import('./apps/Guide/pages/admin/Support'))
const GuideFeedback = lazy(() => import('./apps/Guide/pages/admin/Feedback'))
const GuideSettings = lazy(() => import('./apps/Guide/pages/admin/Settings'))
const GuideCategories = lazy(() => import('./apps/Guide/pages/admin/Categories'))
const GuideBrands = lazy(() => import('./apps/Guide/pages/admin/Brands'))
const GuideUsers = lazy(() => import('./apps/Guide/pages/admin/Users'))
const GuideDeliveries = lazy(() => import('./apps/Guide/pages/admin/Deliveries'))
const GuideViewer = lazy(() => import('./apps/Guide/pages/guide/GuideViewer'))

// Shown while a route chunk downloads (first visit to an app only).
function RouteFallback() {
  return (
    <div style={{
      height: '100%', minHeight: '40vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#0a0a0a', color: '#666', fontFamily: '"JetBrains Mono", monospace', fontSize: 12,
    }}>
      Loading…
    </div>
  )
}

// Redirect old viewer URL formats to the current /:slug public route
function SlugRedirect() {
  const { slug } = useParams()
  return <Navigate to={`/${slug}`} replace />
}

// On guide subdomains (guide.trailbait.com.au etc.), any /guide/:slug path
// is a legacy QR-code URL — redirect to the public viewer.
// On the admin domain, render the normal protected admin routes.
function GuideAppRouter() {
  const params = useParams()
  const rest = params['*'] || ''
  if (window.location.hostname.startsWith('guide.') && rest) {
    const slug = rest.split('/')[0]
    return <Navigate to={`/${slug}`} replace />
  }
  return (
    <ProtectedRoute>
      <GuideAuthProvider>
        <Routes>
          <Route element={<AdminLayout />}>
            <Route index element={<GuidesList />} />
            {/* Dashboard + All Guides merged into one page at /guide */}
            <Route path="guides" element={<Navigate to="/guide" replace />} />
            <Route path="guides/:id" element={<GuideEditor />} />
            <Route path="guides/:id/edit" element={<GuideEditor />} />
            <Route path="guides/:id/share" element={<GuideShare />} />
            <Route path="reports" element={<GuideReports />} />
            <Route path="support" element={<GuideSupport />} />
            <Route path="feedback" element={<GuideFeedback />} />
            <Route path="settings" element={<GuideSettings />} />
            <Route path="categories" element={<GuideCategories />} />
            <Route path="brands" element={<GuideBrands />} />
            <Route path="users" element={<GuideUsers />} />
            <Route path="deliveries" element={<GuideDeliveries />} />
          </Route>
        </Routes>
      </GuideAuthProvider>
    </ProtectedRoute>
  )
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000 } },
})

// Longest prefix wins — more specific paths must come before their parents.
const PATH_TITLES = [
  ['/accounts/xero',         'Xero'],
  ['/accounts',              'Finance'],
  ['/logistics/invoices',    'Invoices'],
  ['/logistics/settings',    'Settings'],
  ['/logistics/disputes',    'Disputes'],
  ['/logistics/manual-label','Manual Label'],
  ['/logistics/tracking',    'Tracking Lookup'],
  ['/logistics',             'Logistics'],
  ['/purchase-orders',       'Purchasing'],
  ['/sales-support',         'Sales Support'],
  ['/opportunities',         'Opportunities'],
  ['/marketing',             'Marketing'],
  ['/compliance',            'Compliance'],
  ['/support',               'Customer Service'],
  ['/projects',              'Projects'],
  ['/tasks',                 'Tasks'],
  ['/guide',                 'Guide Portal'],
  ['/dashboard/settings',    'Tile Settings'],
  ['/dashboard',             'Dashboard'],
  ['/settings',              'Settings'],
  ['/login',                 'Login'],
]

function DocumentTitle() {
  const { pathname } = useLocation()
  useEffect(() => {
    const match = PATH_TITLES.find(([prefix]) => pathname === prefix || pathname.startsWith(prefix + '/'))
    document.title = match ? `${match[1]} — Staff Portal` : 'Staff Portal'
  }, [pathname])
  return null
}

// Global chrome mounted above the router. The pinned desktop widget
// (/tasks/widget) is intentionally chrome-free — no floating "Ask AI" button
// and no bottom task dock — so those are suppressed on that route.
function PortalChrome() {
  const { pathname } = useLocation()
  const isWidget = pathname === '/tasks/widget'
  return (
    <>
      {!isWidget && <GlobalChat />}
      {!isWidget && <TaskDock />}
      <GlobalShortcuts />
      <GlobalMentions />
      <DelegatePromptDialog />
    </>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <DocumentTitle />
          <PortalChrome />
          <Suspense fallback={<RouteFallback />}>
          <Routes>
            {/* Public */}
            <Route path="/login" element={<LoginPage />} />
            <Route path="/reset-password" element={<ResetPassword />} />

            {/* Support Hub */}
            <Route path="/support/*" element={<ProtectedRoute><SupportApp /></ProtectedRoute>} />

            {/* Redirect old /guide/view/:slug viewer URLs → new public /:slug route */}
            <Route path="/guide/view/:slug" element={<SlugRedirect />} />

            {/* Guide Portal — public viewer */}
            <Route path="/:slug" element={<GuideAuthProvider><GuideViewer /></GuideAuthProvider>} />

            {/* Guide Portal — protected admin */}
            <Route path="/guide/*" element={<GuideAppRouter />} />

            {/* Projects (Contractor Hub) */}
            <Route
              path="/projects/*"
              element={
                <ProtectedRoute>
                  <GuideAuthProvider>
                    <Routes>
                      <Route index element={<Navigate to="/projects/list" replace />} />
                      <Route path="contractors" element={<ContractorsList />} />
                      <Route path="contractors/:id" element={<ContractorProfile />} />
                      <Route path="list" element={<ProjectsList />} />
                      <Route path="list/:id" element={<ProjectView />} />
                      <Route path="settings" element={<HubSettings />} />
                    </Routes>
                  </GuideAuthProvider>
                </ProtectedRoute>
              }
            />

            {/* Tasks — pinned desktop-widget view (chrome-free). Must come
                before /tasks/* so it isn't swallowed by the Tasks layout. */}
            <Route
              path="/tasks/widget"
              element={
                <ProtectedRoute>
                  <TaskWidget />
                </ProtectedRoute>
              }
            />

            {/* Tasks (staff_tasks) — has its own layout, sits outside the
                generic Layout shell like Projects/Support/Guide. */}
            <Route
              path="/tasks/*"
              element={
                <ProtectedRoute>
                  <TasksApp />
                </ProtectedRoute>
              }
            />

            {/* Portal — dashboard + apps */}
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <Layout />
                </ProtectedRoute>
              }
            >
              <Route index element={<Navigate to="/dashboard" replace />} />
              <Route path="dashboard" element={<PortalDashboard />} />
              <Route path="dashboard/settings" element={<TileSettings />} />
              <Route path="settings" element={<Settings />} />
              <Route path="accounts" element={<AccountsLayout />}>
                <Route index element={<FinanceDashboard />} />
                <Route path="cashflow" element={<CashFlow />} />
                <Route path="targets" element={<RevenueTargets />} />
                <Route path="profit" element={<ProfitProcessor />} />
                {/* Old direct link to the dashboard now lives at the index. */}
                <Route path="finance" element={<Navigate to="/accounts" replace />} />
                <Route path="xero" element={<XeroChat />} />
                <Route path="chat-functions" element={<ChatFunctions />} />
              </Route>
              <Route path="logistics" element={<Navigate to="/logistics/invoices" replace />} />
              <Route path="logistics/invoices" element={<InvoiceList />} />
              <Route path="logistics/invoices/:id" element={<InvoiceDetail />} />
              <Route path="logistics/settings" element={<Carriers />} />
              <Route path="logistics/carriers" element={<Navigate to="/logistics/settings" replace />} />
              <Route path="logistics/disputes" element={<Disputes />} />
              <Route path="logistics/manual-label" element={<ManualLabel />} />
              <Route path="logistics/tracking" element={<TrackingLookup />} />
              <Route path="purchase-orders" element={<PurchaseOrders />} />
              <Route path="sales-support/*" element={<SalesSupport />} />
              <Route path="opportunities" element={<OpportunityPressure />} />
              <Route path="marketing/*" element={<Marketing />} />
              <Route path="compliance/*" element={<GuideAuthProvider><ComplianceApp /></GuideAuthProvider>} />
            </Route>

            {/* Catch-all */}
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
          </Suspense>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
