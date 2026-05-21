import { useState, useEffect, useCallback, createContext, useContext } from "react";
import { NavLink, Link, useSearchParams } from "react-router-dom";
import { LayoutGrid, LogOut, Menu, Plus } from "lucide-react";
import { cn } from "@guide/lib/utils";
import { useAuth } from "../../../context/AuthContext.jsx";
import { useIsMobile } from "../../../hooks/useIsMobile.js";
import { Sheet, SheetContent, SheetTitle } from "@guide/ui/sheet";
import * as VisuallyHidden from "@radix-ui/react-visually-hidden";
import { TaskDrawer } from "./TaskDrawer";

// Mirrors HubLayout (src/apps/ContractorHub/components/HubLayout.tsx).
// Same 224px black sidebar, gold active accent, 48px sticky header.

interface TasksContextValue {
  openNewTask:    () => void;
  openDrawer:     (taskId: string) => void;
  closeDrawer:    () => void;
  drawerTaskId:   string | null;
}

const TasksContext = createContext<TasksContextValue>({
  openNewTask:  () => {},
  openDrawer:   () => {},
  closeDrawer:  () => {},
  drawerTaskId: null,
});

export function useTasksUi() {
  return useContext(TasksContext);
}

// Kanban + Matrix are view modes inside the Dashboard now — no separate nav
// items. Keeping a single entry preserves the sidebar look-and-feel of the
// other apps (HubLayout has Projects/Contractors/Settings as its three).
const navItems = [
  { label: "Dashboard", icon: LayoutGrid, path: "/tasks", end: true },
];

function SidebarContent({
  onNavClick, onNewTask, onSignOut,
}: { onNavClick?: () => void; onNewTask: () => void; onSignOut: () => void }) {
  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    cn(
      "flex items-center gap-3 px-3 py-2.5 text-xs font-medium transition-colors duration-150 border-l-2",
      "font-mono tracking-wide uppercase",
      isActive
        ? "text-[#f3ca0f] border-[#f3ca0f] bg-[rgba(243,202,15,0.06)]"
        : "text-[#555] border-transparent hover:text-[#ffffff] hover:border-[#333]",
    );

  return (
    <>
      {/* Wordmark / back to dashboard */}
      <Link
        to="/dashboard"
        style={{
          height: "48px", flexShrink: 0, display: "flex", alignItems: "center",
          gap: "8px", padding: "0 20px", borderBottom: "1px solid #222222",
          textDecoration: "none",
        }}
      >
        <div style={{ width: "4px", height: "18px", borderRadius: "2px", background: "#f3ca0f", flexShrink: 0 }} />
        <span style={{ fontSize: "12px", fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: "#ffffff" }}>
          Dashboard
        </span>
      </Link>

      <nav className="flex-1 flex flex-col gap-0.5 px-2 pt-3">
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.end}
            onClick={onNavClick}
            className={navLinkClass}
          >
            <item.icon className="h-3.5 w-3.5 shrink-0" />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="px-3 pb-5 pt-2">
        <button
          onClick={onNewTask}
          style={{
            display: "flex", alignItems: "center", gap: "8px", width: "100%",
            padding: "6px 10px", fontSize: "11px", fontWeight: 500,
            letterSpacing: "0.08em", textTransform: "uppercase",
            color: "#f3ca0f", background: "rgba(243,202,15,0.06)",
            border: "1px solid rgba(243,202,15,0.4)", borderRadius: "4px",
            cursor: "pointer", transition: "background 120ms", fontFamily: "inherit",
            marginBottom: "8px",
          }}
        >
          <Plus size={14} strokeWidth={1.5} />
          <span>New Task</span>
        </button>
        <button
          onClick={onSignOut}
          style={{
            display: "flex", alignItems: "center", gap: "8px", width: "100%",
            padding: "6px 10px", fontSize: "11px", fontWeight: 500,
            letterSpacing: "0.08em", textTransform: "uppercase", color: "#666",
            background: "none", border: "1px solid #222222", borderRadius: "4px",
            cursor: "pointer", transition: "color 120ms, border-color 120ms", fontFamily: "inherit",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "#f3ca0f"; e.currentTarget.style.borderColor = "rgba(243,202,15,0.4)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "#666"; e.currentTarget.style.borderColor = "#222222"; }}
        >
          <LogOut size={14} strokeWidth={1.5} />
          <span>Sign out</span>
        </button>
      </div>
    </>
  );
}

interface TasksLayoutProps {
  children: React.ReactNode;
}

export function TasksLayout({ children }: TasksLayoutProps) {
  const [sidebarOpen,  setSidebarOpen]  = useState(false);
  const [drawerTaskId, setDrawerTaskId] = useState<string | null>(null);
  const isMobile = useIsMobile();
  const { signOut } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  // Deep-link: /tasks?task=<id> opens the drawer for that task. Used by
  // Google Chat notifications so clicking the linked title lands the user
  // straight on the right task.
  const urlTaskId = searchParams.get("task");
  useEffect(() => {
    if (urlTaskId && urlTaskId !== drawerTaskId) setDrawerTaskId(urlTaskId);
  }, [urlTaskId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ESC closes the drawer. The new-task modal is global (mounted by
  // GlobalShortcuts) so its Escape handling lives there.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && drawerTaskId) setDrawerTaskId(null);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [drawerTaskId]);

  // Fire the global event so we don't end up with two NewTaskModal
  // instances mounted (one here, one in GlobalShortcuts) — the audit
  // flagged this as a potential double-stack on /tasks.
  const openNewTask  = useCallback(() => window.dispatchEvent(new CustomEvent("portal:new-task")), []);
  const openDrawer   = useCallback((id: string) => setDrawerTaskId(id), []);
  const closeDrawer  = useCallback(() => {
    setDrawerTaskId(null);
    // Drop the ?task= param so back-button + reload don't reopen the drawer.
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("task");
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const ctx: TasksContextValue = { openNewTask, openDrawer, closeDrawer, drawerTaskId };

  const sidebarProps = {
    onNavClick: isMobile ? () => setSidebarOpen(false) : undefined,
    onNewTask:  () => { openNewTask(); if (isMobile) setSidebarOpen(false); },
    onSignOut:  signOut,
  };

  return (
    <TasksContext.Provider value={ctx}>
      <div style={{ minHeight: "calc(100dvh - var(--task-dock-h, 0px))", background: "#000000" }}>

        {isMobile ? (
          <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
            <SheetContent side="left" className="w-56 p-0 flex flex-col" style={{ background: "#000000", borderRight: "1px solid #222222" }}>
              <VisuallyHidden.Root><SheetTitle>Navigation</SheetTitle></VisuallyHidden.Root>
              <SidebarContent {...sidebarProps} />
            </SheetContent>
          </Sheet>
        ) : (
          <aside
            className="fixed left-0 top-0 w-56 flex flex-col z-30"
            style={{ background: "#000000", borderRight: "1px solid #222222", bottom: "var(--task-dock-h, 0px)" }}
          >
            <SidebarContent {...sidebarProps} />
          </aside>
        )}

        <div className={isMobile ? "" : "ml-56"} style={{ display: "flex", flexDirection: "column", minHeight: "calc(100dvh - var(--task-dock-h, 0px))" }}>
          <header
            className="flex items-center justify-between px-4 md:px-6"
            style={{ position: "sticky", top: 0, zIndex: 20, flexShrink: 0, height: "48px", background: "#0a0a0a", borderBottom: "1px solid #222222" }}
          >
            <div className="flex items-center gap-3">
              {isMobile && (
                <button onClick={() => setSidebarOpen(true)} style={{ color: "#666", background: "none", border: "none", cursor: "pointer", padding: "6px", marginLeft: "-6px" }}>
                  <Menu size={18} strokeWidth={1.5} />
                </button>
              )}
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <div style={{ width: "4px", height: "18px", borderRadius: "2px", background: "#f3ca0f" }} />
                <span style={{ fontSize: "12px", fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: "#ffffff" }}>
                  Tasks
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={openNewTask}
                style={{
                  display: "flex", alignItems: "center", gap: "6px",
                  fontSize: "11px", fontFamily: '"JetBrains Mono", monospace',
                  color: "#f3ca0f", background: "rgba(243,202,15,0.06)",
                  border: "1px solid rgba(243,202,15,0.4)",
                  borderRadius: "4px", padding: "4px 10px", cursor: "pointer",
                }}
                title="New task [N]"
              >
                <Plus style={{ width: "11px", height: "11px" }} />
                <span className="hidden sm:inline">New Task</span>
                <span style={{ fontSize: "9px", opacity: 0.6 }}>N</span>
              </button>
            </div>
          </header>

          <main
            style={{ flex: 1, overflowY: "auto", padding: isMobile ? "24px 16px" : "32px 24px", maxWidth: "1280px", width: "100%", boxSizing: "border-box" }}
          >
            {children}
          </main>
        </div>

        <TaskDrawer taskId={drawerTaskId} open={drawerTaskId !== null} onClose={closeDrawer} />
      </div>
    </TasksContext.Provider>
  );
}
