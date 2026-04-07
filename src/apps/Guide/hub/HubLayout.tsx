import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useMatch } from "react-router-dom";
import { AiAssistantPanel, AiToggleButton } from "./AiAssistantPanel";
import { NewTaskModal } from "./NewTaskModal";

// ── Context ───────────────────────────────────────────────────

interface HubContextValue {
  /** Call to open the new-task form; optionally pre-fills a project. */
  openNewTask:      (projectId?: string) => void;
  /** The project ID that was passed to openNewTask, if any. */
  newTaskProjectId: string | null;
  isNewTaskOpen:    boolean;
  closeNewTask:     () => void;
  /** Current project ID from the URL (if on a project page). */
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

// ── Layout ────────────────────────────────────────────────────

interface HubLayoutProps {
  children: React.ReactNode;
}

export function HubLayout({ children }: HubLayoutProps) {
  const [aiOpen, setAiOpen]               = useState(false);
  const [newTaskOpen, setNewTaskOpen]     = useState(false);
  const [newTaskProjectId, setNewTaskPid] = useState<string | null>(null);
  const aiSearchRef                       = useRef<HTMLTextAreaElement>(null);

  // Detect if we're on a project detail page
  const projectMatch   = useMatch("/hub/projects/:id");
  const currentProjectId = projectMatch?.params?.id ?? null;

  // ── Keyboard shortcuts ──────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't fire when typing in an input / textarea / contenteditable
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.contentEditable === "true"
      ) {
        return;
      }

      if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        openNewTask(currentProjectId ?? undefined);
        return;
      }

      if (e.key === "/") {
        e.preventDefault();
        if (!aiOpen) {
          setAiOpen(true);
          // Focus happens inside AiAssistantPanel after open animation
        } else {
          aiSearchRef.current?.focus();
        }
        return;
      }

      if (e.key === "Escape") {
        setAiOpen(false);
        setNewTaskOpen(false);
        return;
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
    openNewTask,
    newTaskProjectId,
    isNewTaskOpen: newTaskOpen,
    closeNewTask,
    currentProjectId,
  };

  return (
    <HubContext.Provider value={ctx}>
      {children}

      {/* New task modal — shown on non-project pages (project page handles it inline) */}
      {newTaskOpen && !currentProjectId && (
        <NewTaskModal
          open={newTaskOpen}
          onClose={closeNewTask}
          projectId={newTaskProjectId}
        />
      )}

      {/* AI assistant toggle + panel */}
      <AiToggleButton
        open={aiOpen}
        onToggle={() => setAiOpen((v) => !v)}
      />
      <AiAssistantPanel
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        searchInputRef={aiSearchRef}
      />
    </HubContext.Provider>
  );
}
