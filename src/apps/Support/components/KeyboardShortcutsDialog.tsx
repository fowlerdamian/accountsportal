import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { shortcuts } from '@/hooks/useKeyboardShortcuts';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function KeyboardShortcutsDialog({ open, onOpenChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-heading text-base">Keyboard Shortcuts</DialogTitle>
        </DialogHeader>
        <div className="space-y-1 mt-2">
          <div className="text-[11px] uppercase tracking-widest text-muted-foreground font-heading mb-2">Navigation</div>
          {shortcuts
            .filter(s => s.global)
            .map(s => (
              <ShortcutRow key={s.key} label={s.label} description={s.description} />
            ))}
          <div className="text-[11px] uppercase tracking-widest text-muted-foreground font-heading mb-2 mt-4 pt-3 border-t border-border">Actions</div>
          {shortcuts
            .filter(s => !s.global)
            .map(s => (
              <ShortcutRow key={s.key} label={s.label} description={s.description} />
            ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ShortcutRow({ label, description }: { label: string; description: string }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-sm text-foreground">{description}</span>
      <div className="flex gap-1">
        {label.split(' then ').map((k, i) => (
          <span key={i}>
            {i > 0 && <span className="text-muted-foreground text-xs mx-1">then</span>}
            <kbd className="inline-flex items-center justify-center min-w-[24px] h-6 px-1.5 text-xs font-mono bg-muted border border-border text-foreground">
              {k}
            </kbd>
          </span>
        ))}
      </div>
    </div>
  );
}
