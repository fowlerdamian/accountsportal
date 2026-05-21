import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@guide/components/ui/dialog";
import { SHORTCUTS } from "../hooks/useGlobalKeyboardShortcuts";

interface Props {
  open:         boolean;
  onOpenChange: (open: boolean) => void;
}

// Portal-wide shortcut help dialog. Mirrors the look of
// src/apps/Support/components/KeyboardShortcutsDialog.tsx — same kbd chips,
// grouped sections — but reads from the global shortcut registry.

export function KeyboardShortcutsDialog({ open, onOpenChange }: Props) {
  const nav     = SHORTCUTS.filter((s) => s.group === "Navigation");
  const actions = SHORTCUTS.filter((s) => s.group === "Actions");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-heading text-base">Keyboard Shortcuts</DialogTitle>
        </DialogHeader>

        <div className="space-y-1 mt-2 max-h-[60vh] overflow-y-auto pr-1">
          <SectionHeader>Navigation</SectionHeader>
          {nav.map((s) => <Row key={s.key} label={s.label} description={s.description} />)}

          <SectionHeader className="mt-4 pt-3 border-t border-border">Actions</SectionHeader>
          {actions.map((s) => <Row key={s.key} label={s.label} description={s.description} />)}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SectionHeader({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`text-[11px] uppercase tracking-widest text-muted-foreground font-heading mb-2 ${className}`}>
      {children}
    </div>
  );
}

function Row({ label, description }: { label: string; description: string }) {
  // Split on "then" / "+" so multi-key combos render as separate kbd chips.
  const tokens = label.split(/\s+then\s+|\s*\+\s*/i);
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-sm text-foreground">{description}</span>
      <div className="flex gap-1 items-center">
        {tokens.map((k, i) => (
          <span key={i} className="flex items-center">
            {i > 0 && /then/i.test(label) && (
              <span className="text-muted-foreground text-xs mx-1">then</span>
            )}
            {i > 0 && !/then/i.test(label) && (
              <span className="text-muted-foreground text-xs mx-0.5">+</span>
            )}
            <kbd className="inline-flex items-center justify-center min-w-[24px] h-6 px-1.5 text-xs font-mono bg-muted border border-border text-foreground rounded">
              {k}
            </kbd>
          </span>
        ))}
      </div>
    </div>
  );
}
