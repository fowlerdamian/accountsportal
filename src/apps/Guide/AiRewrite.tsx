// Subtle "rewrite with AI" affordance for guide text fields.
// Wrap any Input/Textarea: <AiField value={v} onRewrite={setV} kind="step">…</AiField>
// Calls the guide-rewrite edge function (ASD-STE100 Simplified Technical English).
import { useState, type ReactNode } from "react";
import { Sparkles, Loader2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@guide/integrations/supabase/client";
import { cn } from "@guide/lib/utils";

export type RewriteKind = "title" | "subtitle" | "step" | "description" | "notice";

export async function rewriteText(text: string, kind: RewriteKind, context?: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke("guide-rewrite", { body: { text, kind, context } });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  return String(data?.text ?? "");
}

interface Props {
  value: string;
  onRewrite: (text: string) => void;
  kind: RewriteKind;
  /** Guide title etc. — helps keep part names consistent. */
  context?: string;
  className?: string;
  /** Where the button sits inside the field. */
  align?: "bottom" | "middle";
  children: ReactNode;
}

export function AiField({ value, onRewrite, kind, context, className, align = "bottom", children }: Props) {
  const [busy, setBusy] = useState(false);
  const [previous, setPrevious] = useState<string | null>(null);
  const hasText = !!value?.trim();

  const run = async () => {
    if (!hasText || busy) return;
    setBusy(true);
    try {
      const out = await rewriteText(value, kind, context);
      if (!out || out === value.trim()) { toast.message("Already clear — no changes suggested"); return; }
      setPrevious(value);
      onRewrite(out);
    } catch (e: any) {
      toast.error(e?.message ?? "Rewrite failed");
    } finally {
      setBusy(false);
    }
  };
  const undo = () => { if (previous !== null) { onRewrite(previous); setPrevious(null); } };

  return (
    <div className={cn("group relative", className)}>
      {children}
      {(hasText || previous !== null) && (
        <div className={cn(
          "absolute right-1.5 flex items-center gap-0.5",
          align === "middle" ? "top-1/2 -translate-y-1/2" : "bottom-1.5",
        )}>
          {previous !== null && !busy && (
            <button type="button" onClick={undo} title="Undo rewrite"
              className="h-6 w-6 inline-flex items-center justify-center rounded text-muted-foreground/60 hover:text-foreground hover:bg-muted transition-colors">
              <Undo2 className="h-3.5 w-3.5" />
            </button>
          )}
          <button type="button" onClick={run} disabled={busy || !hasText}
            title="Rewrite in Simplified Technical English (ASD-STE100)"
            className={cn(
              "h-6 w-6 inline-flex items-center justify-center rounded transition-all",
              "text-muted-foreground/40 hover:text-[var(--brand-accent)] hover:bg-muted",
              "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 group-focus-within:opacity-100",
              busy && "opacity-100 text-[var(--brand-accent)]",
            )}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          </button>
        </div>
      )}
    </div>
  );
}
