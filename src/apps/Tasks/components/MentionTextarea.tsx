import { useRef, useState, useEffect, useMemo } from "react";
import { Textarea } from "@guide/components/ui/textarea";
import { UserAvatar } from "./UserAvatar";
import { cn } from "@guide/lib/utils";
import type { StaffProfile } from "../hooks/use-task-queries";

// ─────────────────────────────────────────────────────────────────────────────
// Textarea with @-mention autocomplete.
//
// When the user types "@", a small floating list of profiles appears below
// the cursor area. Filter narrows as they type. Enter / click inserts
// "@Full Name " and tracks the profile.id in `mentionIds`. Escape closes
// the popover without inserting. Backspacing into an existing @-name
// removes it from `mentionIds`.
//
// The textarea is stylistically identical to the standard one.
// ─────────────────────────────────────────────────────────────────────────────

interface MentionTextareaProps {
  value:        string;
  onChange:     (next: string) => void;
  mentionIds:   string[];
  onMentionIds: (next: string[]) => void;
  profiles:     StaffProfile[];
  /** Hide this user from the mention list (don't @-yourself). */
  selfId?:      string;
  placeholder?: string;
  rows?:        number;
  disabled?:    boolean;
  className?:   string;
}

interface MentionState {
  startIndex: number;   // index of the "@" in the value
  query:      string;   // characters typed after the "@" so far
}

function nameOf(p: StaffProfile, selfId?: string): string {
  if (p.id === selfId) return "Me";
  return p.full_name ?? p.email ?? p.id.slice(0, 8);
}

export function MentionTextarea({
  value, onChange, mentionIds, onMentionIds,
  profiles, selfId, placeholder, rows = 2, disabled, className,
}: MentionTextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [mention,        setMention]        = useState<MentionState | null>(null);
  const [selectionIndex, setSelectionIndex] = useState(0);

  // Keep mentionIds in sync with whatever is actually in the body — handles
  // pasted "@Name" patterns the user never typed via the picker, and drops
  // ids whose name was deleted. Recognises any profile whose name (or
  // "Me" for self) appears as "@<name>" anywhere in the body.
  useEffect(() => {
    const ids: string[] = [];
    for (const p of profiles) {
      const name = nameOf(p, selfId);
      if (!name) continue;
      if (value.includes(`@${name}`)) ids.push(p.id);
    }
    const next = Array.from(new Set(ids));
    const same = next.length === mentionIds.length &&
                 next.every((id) => mentionIds.includes(id));
    if (!same) onMentionIds(next);
  }, [value, profiles, selfId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Whittle suggestions down based on what's been typed after the "@".
  const suggestions = useMemo(() => {
    const eligible = profiles.filter((p) => p.id !== selfId);
    if (!mention) return eligible;
    const q = mention.query.toLowerCase();
    if (!q) return eligible.slice(0, 8);
    return eligible
      .filter((p) => {
        const name  = (p.full_name ?? "").toLowerCase();
        const email = (p.email ?? "").toLowerCase();
        return name.includes(q) || email.includes(q);
      })
      .slice(0, 8);
  }, [profiles, mention?.query, selfId]);

  // Reset selection when suggestions change.
  useEffect(() => { setSelectionIndex(0); }, [mention?.query]);

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const next     = e.target.value;
    const caret    = e.target.selectionStart ?? next.length;

    onChange(next);

    // Detect an active @-mention by walking backwards from the caret to
    // the most recent "@". If we hit whitespace before that, no mention.
    const before    = next.slice(0, caret);
    const atIndex   = before.lastIndexOf("@");
    if (atIndex === -1) { setMention(null); return; }
    const fragment  = before.slice(atIndex + 1);
    if (/\s/.test(fragment)) { setMention(null); return; }
    if (fragment.length > 30)  { setMention(null); return; } // bail on absurd queries
    setMention({ startIndex: atIndex, query: fragment });
  }

  function insertMention(p: StaffProfile) {
    if (!mention) return;
    const name   = nameOf(p, selfId);
    const before = value.slice(0, mention.startIndex);
    const after  = value.slice(mention.startIndex + 1 + mention.query.length);
    const insert = `@${name} `;
    const next   = before + insert + after;
    onChange(next);
    if (!mentionIds.includes(p.id)) onMentionIds([...mentionIds, p.id]);
    setMention(null);
    // Restore caret just after the inserted name+space.
    requestAnimationFrame(() => {
      const t = ref.current;
      if (!t) return;
      const pos = before.length + insert.length;
      t.focus();
      t.setSelectionRange(pos, pos);
    });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!mention || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectionIndex((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectionIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      insertMention(suggestions[selectionIndex]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setMention(null);
    } else if (e.key === "Tab") {
      e.preventDefault();
      insertMention(suggestions[selectionIndex]);
    }
  }

  return (
    <div className={cn("relative", className)}>
      <Textarea
        ref={ref}
        data-mentions="native"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        rows={rows}
        disabled={disabled}
        className="resize-none text-sm"
      />

      {mention && suggestions.length > 0 && (
        <div
          className={cn(
            "absolute z-50 left-2 right-2 sm:right-auto sm:w-[260px] mt-1",
            "bg-popover border border-border rounded-md shadow-lg p-1",
            "max-h-56 overflow-y-auto",
          )}
          // Position below the textarea — simple but readable; doesn't try to
          // follow the caret precisely.
          style={{ top: "100%" }}
        >
          {suggestions.map((p, i) => (
            <button
              key={p.id}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); insertMention(p); }}
              onMouseEnter={() => setSelectionIndex(i)}
              className={cn(
                "w-full flex items-center gap-2 px-2 py-1.5 rounded text-left transition-colors",
                i === selectionIndex ? "bg-muted" : "hover:bg-muted/50",
              )}
            >
              <UserAvatar name={nameOf(p, selfId)} size="xs" />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium truncate">{nameOf(p, selfId)}</div>
                {p.email && p.id !== selfId && (
                  <div className="text-[10px] text-muted-foreground truncate">{p.email}</div>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Render comment body with @mention spans highlighted in the brand-yellow
// colour. Plain text otherwise. Used in the comments list below the input.
export function CommentBody({ body }: { body: string }) {
  const parts = body.split(/(@[A-Za-z][\w'.-]*(?:\s[A-Z][\w'.-]*){0,3})/g);
  return (
    <p className="text-sm text-foreground/90 whitespace-pre-wrap">
      {parts.map((part, i) =>
        part.startsWith("@") ? (
          <span key={i} className="text-[var(--brand-accent)] font-medium">{part}</span>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </p>
  );
}
