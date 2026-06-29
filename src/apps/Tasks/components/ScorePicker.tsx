import { cn } from "@guide/lib/utils";
import { quadrantOf, QUADRANT_LABEL } from "../lib/eisenhower";

interface ScorePickerProps {
  urgency:        number | null;
  importance:     number | null;
  onUrgency:      (v: number | null) => void;
  onImportance:   (v: number | null) => void;
  showQuadrant?:  boolean;
}

// Mirrors the 10-pill quick-score row in NewProjectModal (see
// src/apps/ContractorHub/components/NewProjectModal.tsx lines 159-177).
// Two axes of 5 pills each. Same colour rules: <3 red, =3 amber, >3 green.
function pillClass(value: number | null, n: number): string {
  const active = value === n;
  const colour =
    n < 3 ? "bg-[var(--brand-pink)] text-white border-[var(--brand-pink)]" :
    n === 3 ? "bg-[var(--brand-orange)] text-white border-[var(--brand-orange)]" :
              "bg-[var(--brand-aqua)] text-white border-[var(--brand-aqua)]";
  return cn(
    "w-7 h-7 rounded text-xs font-semibold border transition-colors",
    active ? colour : "border-border text-muted-foreground hover:bg-muted",
  );
}

function PillRow({
  label, hint, value, onChange,
}: { label: string; hint: string; value: number | null; onChange: (v: number | null) => void }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="text-xs text-muted-foreground uppercase tracking-wide font-medium">{label}</label>
        <span className="text-[10px] text-muted-foreground/60">{hint}</span>
      </div>
      <div className="flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(value === n ? null : n)}
            className={pillClass(value, n)}
            aria-label={`${label} ${n}`}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ScorePicker({
  urgency, importance, onUrgency, onImportance, showQuadrant = true,
}: ScorePickerProps) {
  const quadrant = quadrantOf(urgency, importance);
  return (
    <div className="space-y-3 rounded-md border bg-muted/20 p-3">
      <PillRow label="Urgency"    hint="how soon"   value={urgency}    onChange={onUrgency} />
      <PillRow label="Importance" hint="how impactful" value={importance} onChange={onImportance} />
      {showQuadrant && (urgency != null || importance != null) && (
        <p className="text-[11px] text-muted-foreground">
          Quadrant: <span className="font-medium text-foreground">{QUADRANT_LABEL[quadrant]}</span>
        </p>
      )}
    </div>
  );
}
