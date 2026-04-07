import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from './context/AuthContext.jsx'
import { AuthProvider as GuideAuthProvider } from './apps/Guide/contexts/AuthContext'
import ProtectedRoute from './components/ProtectedRoute.jsx'
import Layout from './components/Layout.jsx'
import LoginPage from './components/LoginPage.jsx'
import PortalDashboard from './pages/Dashboard.jsx'
import ProfitProcessor from './apps/ProfitProcessor/index.jsx'
import LogisticsDashboard from './apps/Logistics/components/LogisticsDashboard.jsx'
import PurchaseOrders from './apps/PurchaseOrders/index.jsx'
import InvoiceList from './apps/Logistics/components/InvoiceList.jsx'
import InvoiceDetail from './apps/Logistics/components/InvoiceDetail.jsx'
import RateCards from './apps/Logistics/components/RateCards.jsx'
import Disputes from './apps/Logistics/components/Disputes.jsx'
import SupportApp from './apps/Support/SupportApp'
import HubDashboard from './apps/Guide/pages/hub/HubDashboard'
import ContractorsList from './apps/Guide/pages/hub/ContractorsList'
import ContractorProfile from './apps/Guide/pages/hub/ContractorProfile'
import ProjectsList from './apps/Guide/pages/hub/ProjectsList'
import ProjectView from './apps/Guide/pages/hub/ProjectView'

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

            {/* Contractor Hub — uses Guide's AuthProvider for role-aware auth */}
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

            {/* Protected — all share the portal Layout (header + outlet) */}
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
