import { useState, useCallback, useEffect } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { AppSidebar } from './AppSidebar';
import { AppHeader } from './AppHeader';
import { KeyboardShortcutsDialog } from './KeyboardShortcutsDialog';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useIsMobile } from '@/hooks/use-mobile';
import { useAuth } from '@/hooks/useAuth';
import { useTileSettings } from '@portal/hooks/useTileSettings';

// Routes a warehouse-only user is allowed to visit inside /support.
const WAREHOUSE_ONLY_ALLOWED = ['/support/warehouse', '/support/warehouse/profile'];

export function AppLayout() {
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const showShortcuts = useCallback(() => setShortcutsOpen(true), []);
  const isMobile = useIsMobile();
  const { user, isLoading } = useAuth();
  const { settings: tileSettings } = useTileSettings(user?.id);
  const warehouseOnly = tileSettings?.['/support/dashboard-only'] === true;

  useKeyboardShortcuts(() => {}, showShortcuts, { isWarehouseOnly: warehouseOnly });

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
    <div style={{ minHeight: '100dvh', background: '#000000' }}>
      <AppSidebar open={sidebarOpen} onOpenChange={setSidebarOpen} />
      <div className={isMobile ? '' : 'ml-56'} style={{ display: 'flex', flexDirection: 'column', minHeight: '100dvh' }}>
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
      <KeyboardShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </div>
  );
}
