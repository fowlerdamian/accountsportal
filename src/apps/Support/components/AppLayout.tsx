import { useState, useEffect } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { AppSidebar } from './AppSidebar';
import { AppHeader } from './AppHeader';
import { useIsMobile } from '@/hooks/use-mobile';
import { useAuth } from '@/hooks/useAuth';
import { useTileSettings } from '@portal/hooks/useTileSettings';

// Routes a warehouse-only user is allowed to visit inside /support.
const WAREHOUSE_ONLY_ALLOWED = ['/support/warehouse', '/support/warehouse/profile'];

export function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const isMobile = useIsMobile();
  const { user, isLoading } = useAuth();
  const { settings: tileSettings } = useTileSettings(user?.id);
  const warehouseOnly = tileSettings?.['/support/dashboard-only'] === true;

  // Keyboard shortcuts are now handled portal-wide by GlobalShortcuts in App.jsx.

  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    if (!warehouseOnly) return;
    if (!WAREHOUSE_ONLY_ALLOWED.includes(location.pathname)) {
      navigate('/support/warehouse', { replace: true });
    }
  }, [warehouseOnly, location.pathname, navigate]);

  if (isLoading || tileSettings === null) return null;

  return (
    <div style={{ minHeight: 'calc(100dvh - var(--task-dock-h, 0px))', background: '#000000' }}>
      <AppSidebar open={sidebarOpen} onOpenChange={setSidebarOpen} />
      <div className={isMobile ? '' : 'ml-56'} style={{ display: 'flex', flexDirection: 'column', minHeight: 'calc(100dvh - var(--task-dock-h, 0px))' }}>
        <AppHeader onMenuClick={() => setSidebarOpen(true)} />
        <main
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: isMobile ? '24px 16px' : '32px 24px',
            maxWidth: '1200px',
            width: '100%',
            boxSizing: 'border-box',
          }}
        >
          <Outlet />
        </main>
      </div>
    </div>
  );
}
