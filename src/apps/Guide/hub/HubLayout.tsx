import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { NavLink, useMatch } from "react-router-dom";
import { LayoutDashboard, FolderOpen, Users, LogOut, Menu, Plus } from "lucide-react";
import { cn } from "@guide/lib/utils";
import { useAuth } from "@guide/contexts/AuthContext";
import { useIsMobile } from "@guide/hooks/use-mobile";
import { useOverdueTaskCount } from "@guide/hooks/use-hub-queries";
import { Sheet, SheetContent, SheetTitle } from "@guide/ui/sheet";
import * as VisuallyHidden from "@radix-ui/react-visually-hidden";
import { AiAssistantPanel, AiToggleButton } from "./AiAssistantPanel";
import { NewTaskModal } from "./NewTaskModal";

// ── Context ───────────────────────────────────────────────────

interface HubContextValue {
  openNewTask:      (projectId?: string) => void;
  newTaskProjectId: string | null;
  isNewTaskOpen:    boolean;
  closeNewTask:     () => void;
  currentProjectId: string | null;
}

const HubContext = createContext<HubContextValue>({
  openNewTask:      () => {},
  newTaskProjectId: null,
  isNewTaskOpen:    false,
  closeNewTask:     () => {},
  currentProjectId: null,
});

export function useHub() {
  return useContext(HubContext);
}

// ── Sidebar ───────────────────────────────────────────────────

const navItems = [
  { label: "Dashboard",   icon: LayoutDashboard, path: "/hub",              end: true },
  { label: "Projects",    icon: FolderOpen,       path: "/hub/projects",     end: false },
  { label: "Contractors", icon: Users,            path: "/hub/contractors",  end: false },
];

function SidebarContent({
  overdueCount,
  onNavClick,
  onNewTask,
  onSignOut,
}: {
  overdueCount: number;
  onNavClick?: () => void;
  onNewTask: () => void;
  onSignOut: () => void;
}) {
  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    cn(
      "flex items-center gap-3 px-3 py-2.5 text-xs font-medium transition-colors duration-150 border-l-2",
      "font-mono tracking-wide uppercase",
      isActive
        ? "text-[#E8A838] border-[#E8A838] bg-[rgba(232,168,56,0.06)]"
        : "text-[#555] border-transparent hover:text-[#E5E5E5] hover:border-[#333]"
    );

  return (
    <>
      {/* Wordmark */}
      <div style={{
        height: "48px", flexShrink: 0, display: "flex", alignItems: "center",
        gap: "8px", padding: "0 20px", borderBottom: "1px solid #1e1e22",
      }}>
        <div style={{ width: "4px", height: "18px", borderRadius: "2px", background: "#E8A838", flexShrink: 0 }} />
        <span style={{ fontSize: "12px", fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: "#E5E5E5" }}>
          Contractor Hub
        </span>
      </div>

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
            {item.path === "/hub" && overdueCount > 0 && (
              <span
                className="ml-auto h-4 min-w-[16px] px-1 flex items-center justify-center text-[10px] font-medium rounded-sm"
                style={{ background: "rgba(239,68,68,0.2)", color: "#EF4444" }}
              >
                {overdueCount}
              </span>
            )}
          </NavLink>
        ))}

        {/* New task shortcut */}
        <button
          onClick={onNewTask}
          className="flex items-center gap-3 px-3 py-2.5 text-xs font-medium transition-colors duration-150 border-l-2 border-transparent text-[#555] hover:text-[#E5E5E5] hover:border-[#333] font-mono tracking-wide uppercase w-full text-left mt-1"
        >
          <Plus className="h-3.5 w-3.5 shrink-0" />
          <span>New Task</span>
          <span
            className="ml-auto text-[9px] border px-1"
            style={{ color: "#444", borderColor: "#2a2a2a", fontFamily: '"JetBrains Mono", monospace' }}
          >
            N
          </span>
        </button>
      </nav>

      {/* Sign out */}
      <div className="px-3 pb-5 pt-2">
        <button
          onClick={onSignOut}
          style={{
            display: "flex", alignItems: "center", gap: "8px", width: "100%",
            padding: "6px 10px", fontSize: "11px", fontWeight: 500,
            letterSpacing: "0.08em", textTransform: "uppercase", color: "#666",
            background: "none", border: "1px solid #282828", borderRadius: "4px",
            cursor: "pointer", transition: "color 120ms, border-color 120ms", fontFamily: "inherit",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "#E8A838"; e.currentTarget.style.borderColor = "rgba(232,168,56,0.4)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "#666"; e.currentTarget.style.borderColor = "#282828"; }}
        >
          <LogOut size={12} />
          <span>Sign out</span>
        </button>
      </div>
    </>
  );
}

// ── Layout ────────────────────────────────────────────────────

interface HubLayoutProps {
  children: React.ReactNode;
}

export function HubLayout({ children }: HubLayoutProps) {
  const [aiOpen, setAiOpen]           = useState(false);
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [newTaskPid, setNewTaskPid]   = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const aiSearchRef                   = useRef<HTMLTextAreaElement>(null);
  const isMobile                      = useIsMobile();
  const { signOut }                   = useAuth();
  const overdueCount                  = useOverdueTaskCount();

  const projectMatch    = useMatch("/hub/projects/:id");
  const currentProjectId = projectMatch?.params?.id ?? null;

  // ── Keyboard shortcuts ──────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.contentEditable === "true") return;

      if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        openNewTask(currentProjectId ?? undefined);
        return;
      }
      if (e.key === "/") {
        e.preventDefault();
        aiOpen ? aiSearchRef.current?.focus() : setAiOpen(true);
        return;
      }
      if (e.key === "Escape") {
        setAiOpen(false);
        setNewTaskOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [aiOpen, currentProjectId]);

  const openNewTask = useCallback((projectId?: string) => {
    setNewTaskPid(projectId ?? null);
    setNewTaskOpen(true);
  }, []);

  const closeNewTask = useCallback(() => {
    setNewTaskOpen(false);
    setNewTaskPid(null);
  }, []);

  const ctx: HubContextValue = {
    openNewTask, newTaskProjectId: newTaskPid,
    isNewTaskOpen: newTaskOpen, closeNewTask, currentProjectId,
  };

  const sidebarProps = {
    overdueCount,
    onNavClick: isMobile ? () => setSidebarOpen(false) : undefined,
    onNewTask:  () => { openNewTask(currentProjectId ?? undefined); if (isMobile) setSidebarOpen(false); },
    onSignOut:  signOut,
  };

  return (
    <HubContext.Provider value={ctx}>
      <div style={{ minHeight: "100dvh", background: "#080808" }}>

        {/* Sidebar — sheet on mobile, fixed on desktop */}
        {isMobile ? (
          <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
            <SheetContent side="left" className="w-56 p-0 flex flex-col" style={{ background: "#080808", borderRight: "1px solid #1e1e22" }}>
              <VisuallyHidden.Root><SheetTitle>Navigation</SheetTitle></VisuallyHidden.Root>
              <SidebarContent {...sidebarProps} />
            </SheetContent>
          </Sheet>
        ) : (
          <aside className="fixed left-0 top-0 bottom-0 w-56 flex flex-col z-30" style={{ background: "#080808", borderRight: "1px solid #1e1e22" }}>
            <SidebarContent {...sidebarProps} />
          </aside>
        )}

        {/* Main area */}
        <div className={isMobile ? "" : "ml-56"} style={{ display: "flex", flexDirection: "column", minHeight: "100dvh" }}>

          {/* Header */}
          <header
            className="flex items-center justify-between px-4 md:px-6"
            style={{ flexShrink: 0, height: "48px", background: "#0c0c0e", borderBottom: "1px solid #1e1e22" }}
          >
            <div className="flex items-center gap-3">
              {isMobile ? (
                <>
                  <button onClick={() => setSidebarOpen(true)} style={{ color: "#666", background: "none", border: "none", cursor: "pointer", padding: "6px", marginLeft: "-6px" }}>
                    <Menu size={18} />
                  </button>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <div style={{ width: "4px", height: "18px", borderRadius: "2px", background: "#E8A838" }} />
                    <span style={{ fontSize: "12px", fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: "#E5E5E5" }}>
                      Contractor Hub
                    </span>
                  </div>
                </>
              ) : (
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <div style={{ width: "4px", height: "18px", borderRadius: "2px", background: "#E8A838" }} />
                  <span style={{ fontSize: "12px", fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: "#E5E5E5" }}>
                    Contractor Hub
                  </span>
                </div>
              )}
            </div>

            {/* AI shortcut hint */}
            <button
              onClick={() => setAiOpen(v => !v)}
              style={{
                display: "flex", alignItems: "center", gap: "6px",
                fontSize: "11px", fontFamily: '"JetBrains Mono", monospace',
                color: aiOpen ? "#E8A838" : "#555", background: "none",
                border: `1px solid ${aiOpen ? "rgba(232,168,56,0.4)" : "#282828"}`,
                borderRadius: "4px", padding: "4px 10px", cursor: "pointer",
                transition: "color 120ms, border-color 120ms",
              }}
            >
              Ask AI
              <span style={{ fontSize: "9px", opacity: 0.6 }}>/</span>
            </button>
          </header>

          {/* Page content */}
          <main
            style={{
              flex: 1, overflowY: "auto",
              padding: isMobile ? "24px 16px" : "32px 24px",
              maxWidth: "1200px", width: "100%", boxSizing: "border-box",
            }}
          >
            {children}
          </main>
        </div>

        {/* New task modal — non-project pages */}
        {newTaskOpen && !currentProjectId && (
          <NewTaskModal open={newTaskOpen} onClose={closeNewTask} projectId={newTaskPid} />
        )}

        {/* AI panel (no toggle button — header handles it) */}
        <AiAssistantPanel open={aiOpen} onClose={() => setAiOpen(false)} searchInputRef={aiSearchRef} />
      </div>
    </HubContext.Provider>
  );
}
