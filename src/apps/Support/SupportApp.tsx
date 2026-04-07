import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Routes, Route } from 'react-router-dom';
import { Toaster as Sonner } from '@/components/ui/sonner';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AuthProvider } from '@/hooks/useAuth';
import { AppLayout } from '@/components/AppLayout';
import Dashboard from '@/pages/Dashboard';
import CaseDetailPage from '@/pages/CaseDetailPage';
import NewCasePage from '@/pages/NewCasePage';
import TeamSettingsPage from '@/pages/TeamSettingsPage';
import AnalyticsPage from '@/pages/AnalyticsPage';
import ActionItemsPage from '@/pages/ActionItemsPage';
import WarehouseDashboard from '@/pages/WarehouseDashboard';
import ProfileSettingsPage from '@/pages/ProfileSettingsPage';
import NotFound from '@/pages/NotFound';

const queryClient = new QueryClient();

// Mounted at /support/* in the accounts portal.
// AuthProvider tracks Supabase session state but no ProtectedRoute — /support is public.
export default function SupportApp() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <AuthProvider>
          <Routes>
            <Route element={<AppLayout />}>
              <Route index element={<Dashboard />} />
              <Route path="cases/new" element={<NewCasePage />} />
              <Route path="cases/:id" element={<CaseDetailPage />} />
              <Route path="actions" element={<ActionItemsPage />} />
              <Route path="analytics" element={<AnalyticsPage />} />
              <Route path="reports" element={<AnalyticsPage />} />
              <Route path="settings/team" element={<TeamSettingsPage />} />
              <Route path="settings/profile" element={<ProfileSettingsPage />} />
              <Route path="warehouse" element={<WarehouseDashboard />} />
              <Route path="warehouse/profile" element={<ProfileSettingsPage />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
