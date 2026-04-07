import { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

export type Shortcut = {
  key: string;
  label: string;
  description: string;
  global?: boolean;
};

export const shortcuts: Shortcut[] = [
  { key: 'g d', label: 'G then D', description: 'Go to Dashboard', global: true },
  { key: 'g a', label: 'G then A', description: 'Go to Action Items', global: true },
  { key: 'g w', label: 'G then W', description: 'Go to Warehouse', global: true },
  { key: 'g s', label: 'G then S', description: 'Go to Analytics', global: true },
  { key: 'n', label: 'N', description: 'New Case' },
  { key: '/', label: '/', description: 'Focus search (Dashboard)' },
  { key: '?', label: 'Shift + /', description: 'Open AI assistant' },
  { key: 'ctrl+k', label: 'Ctrl+K', description: 'Show all shortcuts' },
  { key: 'Escape', label: 'Esc', description: 'Go back / Dashboard' },
];

export function useKeyboardShortcuts(onShowHelp: () => void, onShowShortcuts?: () => void, options?: { isWarehouseOnly?: boolean }) {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    let gPressed = false;
    let gTimeout: ReturnType<typeof setTimeout>;
    let lastEscTime = 0;

    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const inInput =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable;

      // Escape works everywhere — double-tap goes straight to dashboard
      if (e.key === 'Escape') {
        // Warehouse-only users stay on /warehouse
        if (options?.isWarehouseOnly && location.pathname === '/warehouse') return;
        e.preventDefault();
        const now = Date.now();
        const doubleTap = now - lastEscTime < 400;
        lastEscTime = now;

        if (doubleTap || location.pathname === '/') {
          navigate('/');
          return;
        }
        // Single tap: go back one level
        const depth = location.pathname.split('/').filter(Boolean).length;
        if (depth > 1) {
          navigate(-1);
        } else {
          navigate('/');
        }
        return;
      }

      if (inInput && !(e.key === 'k' && (e.metaKey || e.ctrlKey))) return;

      // Ctrl/Cmd+K for shortcuts dialog (works even in inputs)
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onShowShortcuts?.();
        return;
      }

      if (e.metaKey || e.ctrlKey || e.altKey) return;

      // Two-key combos: g + <key>
      if (gPressed) {
        gPressed = false;
        clearTimeout(gTimeout);
        e.preventDefault();
        switch (e.key.toLowerCase()) {
          case 'd': navigate('/'); break;
          case 'a': navigate('/actions'); break;
          case 'w': navigate('/warehouse'); break;
          case 's': navigate('/analytics'); break;
        }
        return;
      }

      if (e.key === 'g') {
        gPressed = true;
        gTimeout = setTimeout(() => { gPressed = false; }, 500);
        return;
      }

      // Single-key shortcuts
      switch (e.key) {
        case '?':
          e.preventDefault();
          onShowHelp();
          break;
        case 'n':
          e.preventDefault();
          navigate('/cases/new');
          break;
      }
    };

    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('keydown', handler);
      clearTimeout(gTimeout);
    };
  }, [navigate, location, onShowHelp]);
}
