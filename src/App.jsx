import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from './context/AuthContext.jsx'
import { AuthProvider as GuideAuthProvider } from './apps/Guide/contexts/AuthContext'
import ProtectedRoute from './components/ProtectedRoute.jsx'
import Layout from './components/Layout.jsx'
import LoginPage from './components/LoginPage.jsx'
import PortalDashboard from './pages/Dashboard.jsx'
import TileSettings from './pages/TileSettings.jsx'
import Settings from './pages/Settings.jsx'
import ProfitProcessor from './apps/ProfitProcessor/index.jsx'
import LogisticsDashboard from './apps/Logistics/components/LogisticsDashboard.jsx'
import PurchaseOrders from './apps/PurchaseOrders/index.jsx'
import InvoiceList from './apps/Logistics/components/InvoiceList.jsx'
import InvoiceDetail from './apps/Logistics/components/InvoiceDetail.jsx'
import RateCards from './apps/Logistics/components/RateCards.jsx'
import Disputes from './apps/Logistics/components/Disputes.jsx'
import SupportApp from './apps/Support/SupportApp'
import SalesSupport from './apps/SalesSupport/index.jsx'
import ComplianceApp from './apps/Compliance/index'

// Contractor Hub
import HubDashboard from './apps/ContractorHub/pages/HubDashboard'
import ContractorsList from './apps/ContractorHub/pages/ContractorsList'
import ContractorProfile from './apps/ContractorHub/pages/ContractorProfile'
import ProjectsList from './apps/ContractorHub/pages/ProjectsList'
import ProjectView from './apps/ContractorHub/pages/ProjectView'
import HubSettings from './apps/ContractorHub/pages/HubSettings'

// Guide Portal
import { AdminLayout } from './apps/Guide/admin/AdminLayout'
import GuideDashboard from './apps/Guide/pages/admin/Dashboard'
import GuidesList from './apps/Guide/pages/admin/GuidesList'
import GuideEditor from './apps/Guide/pages/admin/GuideEditor'
import GuideShare from './apps/Guide/pages/admin/GuideShare'
import GuideReports from './apps/Guide/pages/admin/Reports'
import GuideSupport from './apps/Guide/pages/admin/Support'
import GuideFeedback from './apps/Guide/pages/admin/Feedback'
import GuideSettings from './apps/Guide/pages/admin/Settings'
import GuideCategories from './apps/Guide/pages/admin/Categories'
import GuideBrands from './apps/Guide/pages/admin/Brands'
import GuideUsers from './apps/Guide/pages/admin/Users'
import GuideViewer from './apps/Guide/pages/guide/GuideViewer'

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
            <Route index element={<GuideDashboard />} />
            <Route path="guides" element={<GuidesList />} />
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
          </Route>
        </Routes>
      </GuideAuthProvider>
    </ProtectedRoute>
  )
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000 } },
})

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            {/* Public */}
            <Route path="/login" element={<LoginPage />} />

            {/* Support Hub */}
            <Route path="/support/*" element={<SupportApp />} />

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
                      <Route index element={<HubDashboard />} />
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
              <Route path="accounts" element={<ProfitProcessor />} />
              <Route path="logistics" element={<LogisticsDashboard />} />
              <Route path="logistics/invoices" element={<InvoiceList />} />
              <Route path="logistics/invoices/:id" element={<InvoiceDetail />} />
              <Route path="logistics/rate-cards" element={<RateCards />} />
              <Route path="logistics/disputes" element={<Disputes />} />
              <Route path="purchase-orders" element={<PurchaseOrders />} />
              <Route path="sales-support/*" element={<SalesSupport />} />
              <Route path="compliance/*" element={<ComplianceApp />} />
            </Route>

            {/* Catch-all */}
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
