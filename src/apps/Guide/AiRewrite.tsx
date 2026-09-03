// Subtle "rewrite with AI" affordance for guide text fields.
// Wrap any Input/Textarea: <AiField value={v} onRewrite={setV} kind="step">…</AiField>
// Calls the guide-rewrite edge function (ASD-STE100 Simplified Technical English).
import { useRef, useState, type ReactNode } from "react";
import { Sparkles, Loader2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@guide/integrations/supabase/client";
import { cn } from "@guide/lib/utils";
import { Input } from "@guide/components/ui/input";
import { Textarea } from "@guide/components/ui/textarea";

export type RewriteKind = "title" | "subtitle" | "step" | "description" | "notice" | "step_title";

export async function rewriteText(text: string, kind: RewriteKind, context?: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke("guide-rewrite", { body: { text, kind, context } });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  return String(data?.text ?? "");
}

/** Short clause (3–8 words) summarising a step's description — used as the step heading. */
export async function summariseStep(description: string, context?: string): Promise<string> {
  const out = (await rewriteText(description, "step_title", context)).trim();
  return out === description.trim() ? "" : out;
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

// ─────────────────────────────────────────────────────────────────────────────
// Step title + description pair. The title is generated automatically as a
// short clause summarising the description: when the description loses focus
// and the title is blank (or still the last auto-generated one), we ask the
// guide-rewrite function for a heading. A hand-typed title is never replaced.
// ─────────────────────────────────────────────────────────────────────────────
interface StepTextFieldsProps {
  subtitle: string;
  description: string;
  /** Guide title — keeps part names consistent in generated headings. */
  context?: string;
  onSubtitle: (text: string) => void;
  onDescription: (text: string) => void;
  descriptionPlaceholder?: string;
  rows?: number;
  inputClassName?: string;
  textareaClassName?: string;
}

export function StepTextFields({
  subtitle, description, context, onSubtitle, onDescription,
  descriptionPlaceholder = "Describe this step...", rows = 3, inputClassName, textareaClassName,
}: StepTextFieldsProps) {
  const [titleBusy, setTitleBusy] = useState(false);
  const last = useRef<{ description: string; title: string } | null>(null);

  const autoTitle = async () => {
    const desc = description.trim();
    const sub  = subtitle.trim();
    if (!desc || titleBusy) return;
    if (sub && sub !== last.current?.title) return;   // hand-written title — leave it alone
    if (last.current?.description === desc) return;   // description unchanged since last run
    setTitleBusy(true);
    try {
      const t = await summariseStep(desc, context);
      if (t) { last.current = { description: desc, title: t }; onSubtitle(t); }
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't generate step title");
    } finally {
      setTitleBusy(false);
    }
  };

  return (
    <>
      <AiField value={subtitle} onRewrite={onSubtitle} kind="subtitle" align="middle">
        <Input
          value={subtitle}
          onChange={e => onSubtitle(e.target.value)}
          placeholder={titleBusy ? "Generating title…" : "Step title — generated from the description"}
          className={cn("font-medium pr-8", titleBusy && "animate-pulse", inputClassName)}
        />
      </AiField>
      <AiField value={description} onRewrite={onDescription} kind="step">
        <Textarea
          value={description}
          onChange={e => onDescription(e.target.value)}
          onBlur={autoTitle}
          placeholder={descriptionPlaceholder}
          rows={rows}
          className={cn("pr-8", textareaClassName)}
        />
      </AiField>
    </>
  );
}
