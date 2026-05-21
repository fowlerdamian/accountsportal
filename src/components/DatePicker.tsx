import { useState, useMemo, useEffect } from "react";
import { Calendar as CalendarIcon, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@guide/components/ui/popover";
import { Calendar } from "@guide/ui/calendar";
import { cn } from "@guide/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// Portal-wide date picker. Replaces native <input type="date" /> across the
// app so every date field looks identical and works the same way on every
// browser. Value model: ISO YYYY-MM-DD string (matches Postgres date type).
//
// Display format: "DD Mon YYYY" — same DD-first convention as the Chat
// notifications. Empty / null is shown as the placeholder.
// ─────────────────────────────────────────────────────────────────────────────

const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function toDate(iso: string | null | undefined): Date | undefined {
  if (!iso) return undefined;
  // Parse YYYY-MM-DD as local time (not UTC) — avoids day-shift on TZ < 0.
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return undefined;
  return new Date(y, m - 1, d);
}

function toIso(d: Date | undefined): string | null {
  if (!d) return null;
  const y  = d.getFullYear();
  const m  = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function formatLabel(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = toDate(iso);
  if (!d) return iso;
  return `${String(d.getDate()).padStart(2, "0")} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
}

interface DatePickerProps {
  value:        string | null;             // ISO YYYY-MM-DD, or null
  onChange:     (value: string | null) => void;
  /** Disable dates before this (ISO YYYY-MM-DD inclusive). */
  min?:         string | null;
  /** Disable dates after this  (ISO YYYY-MM-DD inclusive). */
  max?:         string | null;
  placeholder?: string;
  disabled?:    boolean;
  className?:   string;
  /** Allow clearing the date via a small X button. Default true. */
  clearable?:   boolean;
  id?:          string;
  /** When true, button matches Input height (default — for forms). */
  inputLike?:   boolean;
  /** Open the popover on mount — used for inline-edit cells. */
  autoOpen?:    boolean;
}

export function DatePicker({
  value, onChange, min, max,
  placeholder = "Pick a date",
  disabled, className,
  clearable = true,
  id, inputLike = true,
  autoOpen = false,
}: DatePickerProps) {
  const [open, setOpen] = useState(autoOpen);
  useEffect(() => { if (autoOpen) setOpen(true); }, [autoOpen]);
  const selected = useMemo(() => toDate(value), [value]);
  const minDate  = useMemo(() => toDate(min ?? undefined), [min]);
  const maxDate  = useMemo(() => toDate(max ?? undefined), [max]);

  const dayDisabled = (d: Date) => {
    if (minDate && d < minDate) return true;
    if (maxDate && d > maxDate) return true;
    return false;
  };

  return (
    // Wrapper so the clear (×) button can be a sibling of the trigger,
    // not nested inside it (button-inside-button is invalid HTML and
    // breaks keyboard tab order).
    <div className={cn("relative w-full", inputLike ? "h-10" : "h-8")}>
      <Popover open={open} onOpenChange={(o) => !disabled && setOpen(o)}>
        <PopoverTrigger asChild>
          <button
            type="button"
            id={id}
            disabled={disabled}
            aria-haspopup="listbox"
            className={cn(
              // Match @guide/components/ui/input — same border, height, radius, focus ring
              "flex w-full items-center justify-between rounded-md border border-input bg-background text-left",
              inputLike ? "h-10 px-3 py-2 text-sm" : "h-8 px-2.5 py-1 text-xs",
              // Reserve room for the clear button on the right when one will render.
              clearable && value && !disabled && (inputLike ? "pr-9" : "pr-7"),
              "ring-offset-background placeholder:text-muted-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              "disabled:cursor-not-allowed disabled:opacity-50",
              !value && "text-muted-foreground",
              className,
            )}
          >
            <span className="flex items-center gap-2 truncate">
              <CalendarIcon className="h-4 w-4 opacity-60 shrink-0" />
              <span className="truncate">{value ? formatLabel(value) : placeholder}</span>
            </span>
          </button>
        </PopoverTrigger>
        {clearable && value && !disabled && (
          <button
            type="button"
            onClick={() => onChange(null)}
            onMouseDown={(e) => e.stopPropagation()}
            className={cn(
              "absolute top-1/2 -translate-y-1/2 p-0.5 rounded",
              "text-muted-foreground hover:text-foreground hover:bg-muted",
              "transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
              inputLike ? "right-2.5" : "right-1.5",
            )}
            aria-label="Clear date"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={selected}
            onSelect={(d) => { onChange(toIso(d)); setOpen(false); }}
            disabled={dayDisabled}
            initialFocus
            defaultMonth={selected ?? new Date()}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
