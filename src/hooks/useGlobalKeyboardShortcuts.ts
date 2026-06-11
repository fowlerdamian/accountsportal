import { useEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";

// Press Esc this many times within ESC_WINDOW_MS to jump straight to the
// dashboard instead of stepping back one page at a time.
const ESC_TO_DASHBOARD = 3;
const ESC_WINDOW_MS = 600;

// ─────────────────────────────────────────────────────────────────────────────
// Portal-wide keyboard shortcuts. Mounted once at the App root so they fire
// regardless of which sub-app the user is in.
//
// Scheme borrowed from src/apps/Support/hooks/useKeyboardShortcuts.ts:
//   - "g <letter>" two-key combos for navigation
//   - "n" — context-aware "new" action
//   - "?" / Ctrl+K — open shortcuts help dialog
//
// Inputs / textareas are ignored; Ctrl+K still works inside inputs.
// ─────────────────────────────────────────────────────────────────────────────

export type Shortcut = {
  key:          string;   // raw key signature ("g d", "n", "ctrl+k", "?")
  label:        string;   // display label ("G then D")
  description:  string;   // human-readable action
  group:        "Navigation" | "Actions";
};

// Top-level portal navigation. Sub-app sub-routes deliberately omitted —
// each app can still keep its own internal shortcuts inside its own layout.
export const NAV_SHORTCUTS: Array<{ letter: string; path: string; label: string }> = [
  { letter: "d", path: "/dashboard",       label: "Dashboard" },
  { letter: "t", path: "/tasks",           label: "Tasks" },
  { letter: "p", path: "/projects",        label: "Projects" },
  { letter: "s", path: "/support",         label: "Customer Service" },
  { letter: "l", path: "/logistics",       label: "Logistics" },
  { letter: "o", path: "/purchase-orders", label: "Purchasing" },
  { letter: "c", path: "/compliance",      label: "Compliance" },
  { letter: "g", path: "/guide",           label: "Guide Portal" },
  { letter: "a", path: "/accounts",        label: "Accounts" },
  { letter: "x", path: "/sales-support",   label: "Sales Support" },
  { letter: "e", path: "/settings",        label: "Settings" },
];

export const SHORTCUTS: Shortcut[] = [
  ...NAV_SHORTCUTS.map((n) => ({
    key:         `g ${n.letter}`,
    label:       `G then ${n.letter.toUpperCase()}`,
    description: `Go to ${n.label}`,
    group:       "Navigation" as const,
  })),
  { key: "n",      label: "N",      description: "New task (or new case/project when in those apps)", group: "Actions" },
  { key: "?",      label: "Shift+/", description: "Show keyboard shortcuts",                          group: "Actions" },
  { key: "ctrl+k", label: "Ctrl+K", description: "Show keyboard shortcuts",                            group: "Actions" },
  { key: "esc",    label: "Esc",    description: "Back one page (×3 quickly → Dashboard)",              group: "Actions" },
];

interface Opts {
  onShowShortcuts: () => void;
}

export function useGlobalKeyboardShortcuts({ onShowShortcuts }: Opts): void {
  const navigate = useNavigate();
  const location = useLocation();

  // Rapid-Esc counter. Lives in refs so it survives the listener re-binding
  // on every route change (each Esc navigates, which changes location).
  const escCount = useRef(0);
  const escTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let gPressed   = false;
    let gTimeout: ReturnType<typeof setTimeout>;

    const handler = (e: KeyboardEvent) => {
      const target  = e.target as HTMLElement;
      const inInput =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;

      // An overlay owns the keyboard while visible (Radix dialog/dropdown, cmdk
      // listbox, the mention picker). They close themselves on Esc and handle
      // their own keys — we must not interfere.
      const overlayOpen = !!document.querySelector(
        '[role="dialog"][data-state="open"], [role="menu"][data-state="open"], [role="listbox"], [data-mentions-open="true"]'
      );

      // Ctrl/Cmd+K opens the shortcuts dialog — works even inside inputs
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onShowShortcuts();
        return;
      }

      // Esc navigates back one page; pressing it ESC_TO_DASHBOARD times in
      // quick succession jumps straight to the dashboard. Overlays (which
      // close themselves on Esc) and focused fields (where Esc just drops
      // focus) take priority and reset the rapid-press counter.
      if (e.key === "Escape") {
        if (overlayOpen) { escCount.current = 0; return; }
        if (inInput) { target.blur(); escCount.current = 0; return; }

        escCount.current += 1;
        if (escTimer.current) clearTimeout(escTimer.current);
        escTimer.current = setTimeout(() => { escCount.current = 0; }, ESC_WINDOW_MS);

        if (escCount.current >= ESC_TO_DASHBOARD) {
          escCount.current = 0;
          clearTimeout(escTimer.current);
          navigate("/dashboard");
        } else {
          navigate(-1);
        }
        return;
      }

      if (inInput) return;
      if (overlayOpen) return;
      // Any other modifier — bail (don't hijack browser/system shortcuts)
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      // ── Two-key combos: g + <letter> ────────────────────────────────────
      if (gPressed) {
        gPressed = false;
        clearTimeout(gTimeout);
        const letter = e.key.toLowerCase();
        const target = NAV_SHORTCUTS.find((n) => n.letter === letter);
        if (target) {
          e.preventDefault();
          navigate(target.path);
        }
        return;
      }

      if (e.key === "g") {
        gPressed = true;
        gTimeout = setTimeout(() => { gPressed = false; }, 500);
        return;
      }

      // ── Single-key shortcuts ────────────────────────────────────────────
      switch (e.key) {
        case "?":
          e.preventDefault();
          onShowShortcuts();
          return;

        case "n":
        case "N": {
          // Context-aware new:
          //  - on /support — preserve Support's flow → /cases/new
          //  - on /projects — Hub's HubLayout already binds "n" to new project,
          //    so don't fire ours (would double-trigger)
          //  - on /tasks — TasksLayout already binds the toolbar New Task; we
          //    open it via global event too so it's consistent
          //  - elsewhere — dispatch portal:new-task event (global modal listens)
          const path = location.pathname;
          if (path.startsWith("/projects")) return;     // HubLayout owns 'n'
          if (path.startsWith("/support")) {
            e.preventDefault();
            navigate("/support/cases/new");
            return;
          }
          e.preventDefault();
          window.dispatchEvent(new CustomEvent("portal:new-task"));
          return;
        }
      }
    };

    // Capture phase: fire BEFORE focused widgets (Radix dialogs, dropdowns,
    // comboboxes) that stopPropagation on keydown and would otherwise swallow
    // global shortcuts. The inInput / open-overlay guards above keep us from
    // hijacking keys those widgets legitimately need.
    window.addEventListener("keydown", handler, true);
    return () => {
      window.removeEventListener("keydown", handler, true);
      clearTimeout(gTimeout);
    };
  }, [navigate, location, onShowShortcuts]);
}
