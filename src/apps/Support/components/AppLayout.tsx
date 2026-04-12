import { useState, useCallback } from 'react';
import { Outlet, Navigate } from 'react-router-dom';
import { AppSidebar } from './AppSidebar';
import { AppHeader } from './AppHeader';
import { ChatBot } from './ChatBot';
import { KeyboardShortcutsDialog } from './KeyboardShortcutsDialog';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useIsMobile } from '@/hooks/use-mobile';
import { useAuth } from '@/hooks/useAuth';

export function AppLayout() {
  const [chatTrigger, setChatTrigger] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const openChat = useCallback(() => setChatTrigger(prev => !prev), []);
  const showShortcuts = useCallback(() => setShortcutsOpen(true), []);
  useKeyboardShortcuts(openChat, showShortcuts);
  const isMobile = useIsMobile();
  const { session, isLoading } = useAuth();

  if (isLoading) return null;
  if (!session) return <Navigate to="/login" replace />;

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
      <ChatBot externalOpen={chatTrigger} />
      <KeyboardShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </div>
  );
}
