import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
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

// Contractor Hub
import HubDashboard from './apps/Guide/pages/hub/HubDashboard'
import ContractorsList from './apps/Guide/pages/hub/ContractorsList'
import ContractorProfile from './apps/Guide/pages/hub/ContractorProfile'
import ProjectsList from './apps/Guide/pages/hub/ProjectsList'
import ProjectView from './apps/Guide/pages/hub/ProjectView'

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

            {/* Support Hub — public, no login required */}
            <Route path="/support/*" element={<SupportApp />} />

            {/* Guide Portal */}
            <Route
              path="/guide/*"
              element={
                <ProtectedRoute>
                  <GuideAuthProvider>
                    <Routes>
                      <Route element={<AdminLayout />}>
                        <Route index element={<GuideDashboard />} />
                        <Route path="guides" element={<GuidesList />} />
                        <Route path="guides/:id" element={<GuideEditor />} />
                        <Route path="guides/:id/share" element={<GuideShare />} />
                        <Route path="reports" element={<GuideReports />} />
                        <Route path="support" element={<GuideSupport />} />
                        <Route path="feedback" element={<GuideFeedback />} />
                        <Route path="settings" element={<GuideSettings />} />
                        <Route path="categories" element={<GuideCategories />} />
                        <Route path="brands" element={<GuideBrands />} />
                        <Route path="users" element={<GuideUsers />} />
                      </Route>
                      <Route path="view/:id" element={<GuideViewer />} />
                    </Routes>
                  </GuideAuthProvider>
                </ProtectedRoute>
              }
            />

            {/* Contractor Hub */}
            <Route
              path="/hub/*"
              element={
                <ProtectedRoute>
                  <GuideAuthProvider>
                    <Routes>
                      <Route index element={<HubDashboard />} />
                      <Route path="contractors" element={<ContractorsList />} />
                      <Route path="contractors/:id" element={<ContractorProfile />} />
                      <Route path="projects" element={<ProjectsList />} />
                      <Route path="projects/:id" element={<ProjectView />} />
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
              <Route path="apps/profit" element={<ProfitProcessor />} />
              <Route path="apps/logistics" element={<LogisticsDashboard />} />
              <Route path="apps/purchase-orders" element={<PurchaseOrders />} />
              <Route path="apps/logistics/invoices" element={<InvoiceList />} />
              <Route path="apps/logistics/invoices/:id" element={<InvoiceDetail />} />
              <Route path="apps/logistics/rate-cards" element={<RateCards />} />
              <Route path="apps/logistics/disputes" element={<Disputes />} />
            </Route>

            {/* Catch-all */}
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
