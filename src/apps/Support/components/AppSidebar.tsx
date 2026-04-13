import { LayoutDashboard, PlusCircle, Settings, LogOut, BarChart3, ClipboardList, Package } from 'lucide-react';
import { NavLink, Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';
import { useActionItemsCount } from '@/hooks/useActionItemsCount';
import { useWarehouseTasksCount } from '@/hooks/useWarehouseTasksCount';
import { useIsMobile } from '@/hooks/use-mobile';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import * as VisuallyHidden from '@radix-ui/react-visually-hidden';
import { useTileSettings } from '@portal/hooks/useTileSettings';

const navItems = [
  { label: 'Dashboard', icon: LayoutDashboard, path: '/support' },
  { label: 'Action Items', icon: ClipboardList, path: '/support/actions' },
  { label: 'New Case', icon: PlusCircle, path: '/support/cases/new' },
  { label: 'Warehouse', icon: Package, path: '/support/warehouse' },
  { label: 'Analytics', icon: BarChart3, path: '/support/analytics' },
];

interface AppSidebarProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function AppSidebar({ open, onOpenChange }: AppSidebarProps) {
  const { user, isAdmin, signOut } = useAuth();
  const { settings: tileSettings } = useTileSettings(user?.id);
  const dashboardOnly = tileSettings?.['/support/dashboard-only'] === true;
  const actionCount = useActionItemsCount();
  const warehouseCount = useWarehouseTasksCount();
  const isMobile = useIsMobile();

  // Shared nav link style — matches portal's active/hover patterns with amber accent
  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    cn(
      'flex items-center gap-3 px-3 py-2.5 text-xs font-medium transition-colors duration-150 border-l-2',
      'font-mono tracking-wide uppercase',
      isActive
        ? 'text-[#f3ca0f] border-[#f3ca0f] bg-[rgba(243,202,15,0.06)]'
        : 'text-[#555] border-transparent hover:text-[#ffffff] hover:border-[#333]'
    );

  const sidebarContent = (
    <>
      {/* Wordmark — back to dashboard */}
      <Link
        to="/dashboard"
        style={{
          height: '48px',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '0 20px',
          borderBottom: '1px solid #222222',
          textDecoration: 'none',
        }}
      >
        <div style={{ width: '4px', height: '18px', borderRadius: '2px', background: '#f3ca0f', flexShrink: 0 }} />
        <span style={{ fontSize: '12px', fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#ffffff' }}>
          Dashboard
        </span>
      </Link>

      <nav className="flex-1 flex flex-col gap-0.5 px-2 pt-3">
        {(dashboardOnly ? navItems.filter(i => i.path === '/support') : navItems).map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === '/support'}
            onClick={() => isMobile && onOpenChange?.(false)}
            className={navLinkClass}
          >
            <item.icon className="h-3.5 w-3.5 shrink-0" />
            <span>{item.label}</span>
            {item.path === '/support/actions' && actionCount > 0 && (
              <span
                className="ml-auto h-4 min-w-[16px] px-1 flex items-center justify-center text-[10px] font-medium rounded-sm"
                style={{ background: 'rgba(239,68,68,0.2)', color: '#ff1744' }}
              >
                {actionCount}
              </span>
            )}
            {item.path === '/support/warehouse' && warehouseCount > 0 && (
              <span
                className="ml-auto h-4 min-w-[16px] px-1 flex items-center justify-center text-[10px] font-medium rounded-sm"
                style={{ background: 'rgba(59,158,255,0.2)', color: '#3B9EFF' }}
              >
                {warehouseCount}
              </span>
            )}
            {!isMobile && item.path === '/support/cases/new' && (
              <span
                className="ml-auto text-[9px] border px-1"
                style={{ color: '#444', borderColor: '#222222', fontFamily: '"JetBrains Mono", monospace' }}
              >
                N
              </span>
            )}
          </NavLink>
        ))}

        {isAdmin && !dashboardOnly && (
          <>
            <div className="mt-5 mb-1.5 px-3">
              <span
                style={{
                  fontSize: '9px',
                  fontFamily: '"JetBrains Mono", monospace',
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  color: '#444',
                }}
              >
                Admin
              </span>
            </div>
            <NavLink
              to="/support/settings/team"
              onClick={() => isMobile && onOpenChange?.(false)}
              className={navLinkClass}
            >
              <Settings className="h-3.5 w-3.5 shrink-0" />
              <span>Team Settings</span>
            </NavLink>
          </>
        )}
      </nav>

      {/* Sign out — styled like portal sign-out button */}
      <div className="px-3 pb-5 pt-2">
        <button
          onClick={signOut}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            width: '100%',
            padding: '6px 10px',
            fontSize: '11px',
            fontWeight: 500,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: '#666',
            background: 'none',
            border: '1px solid #222222',
            borderRadius: '4px',
            cursor: 'pointer',
            transition: 'color 120ms, border-color 120ms',
            fontFamily: 'inherit',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = '#f3ca0f';
            e.currentTarget.style.borderColor = 'rgba(243,202,15,0.4)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = '#666';
            e.currentTarget.style.borderColor = '#222222';
          }}
        >
          <LogOut size={14} strokeWidth={1.5} />
          <span>Sign out</span>
        </button>
      </div>
    </>
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="left" className="w-56 p-0 flex flex-col" style={{ background: '#000000', borderRight: '1px solid #222222' }}>
          <VisuallyHidden.Root>
            <SheetTitle>Navigation</SheetTitle>
          </VisuallyHidden.Root>
          {sidebarContent}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <aside
      className="fixed left-0 top-0 bottom-0 w-56 flex flex-col z-30"
      style={{ background: '#000000', borderRight: '1px solid #222222' }}
    >
      {sidebarContent}
    </aside>
  );
}
