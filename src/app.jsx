import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext.jsx'
import ProtectedRoute from './components/ProtectedRoute.jsx'
import Layout from './components/Layout.jsx'
import LoginPage from './components/LoginPage.jsx'
import PortalDashboard from './pages/Dashboard.jsx'
import ProfitProcessor from './apps/ProfitProcessor/index.jsx'
import LogisticsDashboard from './apps/Logistics/components/LogisticsDashboard.jsx'
import InvoiceList from './apps/Logistics/components/InvoiceList.jsx'
import InvoiceDetail from './apps/Logistics/components/InvoiceDetail.jsx'
import RateCards from './apps/Logistics/components/RateCards.jsx'
import Disputes from './apps/Logistics/components/Disputes.jsx'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Public */}
          <Route path="/login" element={<LoginPage />} />

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
  )
}
