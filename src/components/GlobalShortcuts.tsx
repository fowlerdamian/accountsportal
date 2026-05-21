import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../context/AuthContext.jsx";
import { useGlobalKeyboardShortcuts } from "../hooks/useGlobalKeyboardShortcuts";
import { KeyboardShortcutsDialog } from "./KeyboardShortcutsDialog";
import { NewTaskModal } from "../apps/Tasks/components/NewTaskModal";

// Single mount-point for portal-wide UX bits:
//   - keyboard shortcut handler
//   - "?" / Ctrl+K shortcuts help dialog
//   - global "new task" modal opened by `n` from any app
//
// Mount once in App.jsx alongside <GlobalChat /> and <TaskDock />.

export function GlobalShortcuts() {
  const { user } = useAuth();
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [newTaskOpen,   setNewTaskOpen]   = useState(false);

  const openShortcuts = useCallback(() => setShortcutsOpen(true), []);

  // Wire the keyboard handler regardless of auth state — the "?" still works
  // on /login (cheap discoverability). The new-task modal renders only when
  // signed in.
  useGlobalKeyboardShortcuts({ onShowShortcuts: openShortcuts });

  // Listen for `portal:new-task` events dispatched by the global "n" handler
  // so any app can trigger the create-task flow.
  useEffect(() => {
    const onNewTask = () => setNewTaskOpen(true);
    window.addEventListener("portal:new-task", onNewTask);
    return () => window.removeEventListener("portal:new-task", onNewTask);
  }, []);

  return (
    <>
      <KeyboardShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      {user && (
        <NewTaskModal open={newTaskOpen} onClose={() => setNewTaskOpen(false)} />
      )}
    </>
  );
}
