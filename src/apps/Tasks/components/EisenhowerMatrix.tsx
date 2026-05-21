import { cn } from "@guide/lib/utils";
import { quadrantOf, QUADRANT_LABEL, type Quadrant } from "../lib/eisenhower";
import { QUADRANT_BG_CLASS, QUADRANT_DOT_CLASS, dueRingClass, formatDueChip } from "../lib/color";
import type { StaffTask, StaffProfile } from "../hooks/use-task-queries";

// Eisenhower 2×2 grid. Each task is positioned by (urgency, importance) on
// a 1-5 scale; if either axis is unscored it lands in the middle of the
// matrix in the "Do" quadrant (per quadrantOf defaults).
//
// Quadrant layout (matches the canonical diagram):
//
//   Importance ↑
//   5 │  Schedule  │  Do        │
//     │            │            │
//   3 ├────────────┼────────────┤
//     │  Drop      │  Delegate  │
//   1 │            │            │
//     └────────────┴────────────┘
//        1   ←  Urgency  →   5

interface EisenhowerMatrixProps {
  tasks:      StaffTask[];
  profiles:   StaffProfile[];
  myId?:      string;
  onOpenTask: (id: string) => void;
}

const QUADRANT_TINT: Record<Quadrant, string> = {
  do:       "bg-red-950/30    border-red-900/50",
  schedule: "bg-blue-950/30   border-blue-900/50",
  delegate: "bg-amber-950/30  border-amber-900/50",
  drop:     "bg-muted/30      border-border/40",
};

// Map (urgency 1-5, importance 1-5) → percent positions inside its quadrant cell.
// We jitter within the cell to keep dots from stacking.
function dotStyle(t: StaffTask, idx: number): React.CSSProperties {
  const u = t.urgency    ?? 3;
  const i = t.importance ?? 3;
  // 0-100% inside the whole matrix
  const left = ((u - 1) / 4) * 100;
  const bottom = ((i - 1) / 4) * 100;
  // small jitter so dots that share (u,i) don't fully overlap
  const dx = ((idx * 37) % 9) - 4;
  const dy = ((idx * 53) % 9) - 4;
  return {
    left:   `calc(${left}% + ${dx}px)`,
    bottom: `calc(${bottom}% + ${dy}px)`,
  };
}

export function EisenhowerMatrix({ tasks, profiles, myId, onOpenTask }: EisenhowerMatrixProps) {
  const byQuadrant: Record<Quadrant, StaffTask[]> = { do: [], schedule: [], delegate: [], drop: [] };
  for (const t of tasks) byQuadrant[quadrantOf(t.urgency, t.importance)].push(t);

  function nameFor(id: string): string {
    if (id === myId) return "Me";
    const p = profiles.find((x) => x.id === id);
    return p?.full_name ?? p?.email ?? id.slice(0, 8);
  }

  return (
    <div className="space-y-3">
      {/* Axis labels + grid */}
      <div className="grid grid-cols-[24px_1fr] grid-rows-[1fr_24px] gap-2">
        {/* Y axis label */}
        <div className="flex items-center justify-center [writing-mode:vertical-rl] rotate-180 text-[10px] uppercase tracking-wider text-muted-foreground">
          Importance →
        </div>

        {/* Matrix */}
        <div className="relative aspect-[5/4] rounded-lg border bg-background overflow-hidden">
          {/* Quadrant backgrounds */}
          <div className="absolute inset-0 grid grid-cols-2 grid-rows-2">
            {/* TL = Schedule (low urg, high imp) */}
            <div className={cn("border-r border-b", QUADRANT_TINT.schedule, "flex items-start justify-start p-2")}>
              <span className="text-[10px] uppercase tracking-wider text-blue-300/80 font-medium">Schedule</span>
            </div>
            {/* TR = Do */}
            <div className={cn("border-b", QUADRANT_TINT.do, "flex items-start justify-end p-2")}>
              <span className="text-[10px] uppercase tracking-wider text-red-300/80 font-medium">Do</span>
            </div>
            {/* BL = Drop */}
            <div className={cn("border-r", QUADRANT_TINT.drop, "flex items-end justify-start p-2")}>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Drop</span>
            </div>
            {/* BR = Delegate */}
            <div className={cn(QUADRANT_TINT.delegate, "flex items-end justify-end p-2")}>
              <span className="text-[10px] uppercase tracking-wider text-amber-300/80 font-medium">Delegate</span>
            </div>
          </div>

          {/* Task dots */}
          {tasks.map((t, idx) => {
            const quad = quadrantOf(t.urgency, t.importance);
            return (
              <button
                key={t.id}
                onClick={() => onOpenTask(t.id)}
                title={`${t.title}  ·  U${t.urgency ?? "?"} × I${t.importance ?? "?"}  ·  ${nameFor(t.assigned_to)}`}
                className={cn(
                  "absolute -translate-x-1/2 translate-y-1/2",
                  "w-3 h-3 rounded-full ring-2 ring-background hover:ring-foreground",
                  "transition-all hover:scale-150",
                  QUADRANT_DOT_CLASS[quad],
                  dueRingClass(t.due_date),
                )}
                style={dotStyle(t, idx)}
              />
            );
          })}
        </div>

        {/* Empty corner */}
        <div />
        {/* X axis label */}
        <div className="flex items-center justify-center text-[10px] uppercase tracking-wider text-muted-foreground">
          Urgency →
        </div>
      </div>

      {/* Quadrant counts */}
      <div className="grid grid-cols-4 gap-2">
        {(["do", "schedule", "delegate", "drop"] as Quadrant[]).map((q) => (
          <div key={q} className={cn("rounded-md border p-2 text-xs flex items-center justify-between", QUADRANT_BG_CLASS[q])}>
            <span className="font-medium">{QUADRANT_LABEL[q]}</span>
            <span className="font-mono tabular-nums">{byQuadrant[q].length}</span>
          </div>
        ))}
      </div>

      {/* List grouped by quadrant for click-through */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {(["do", "schedule", "delegate", "drop"] as Quadrant[]).map((q) => (
          <div key={q} className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className={cn("w-2 h-2 rounded-full", QUADRANT_DOT_CLASS[q])} />
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {QUADRANT_LABEL[q]} <span className="opacity-60">· {byQuadrant[q].length}</span>
              </span>
            </div>
            {byQuadrant[q].length === 0 ? (
              <p className="text-[11px] text-muted-foreground/50 pl-4">None</p>
            ) : (
              <ul className="space-y-1">
                {byQuadrant[q].map((t) => (
                  <li key={t.id}>
                    <button
                      onClick={() => onOpenTask(t.id)}
                      className="w-full text-left text-xs px-2 py-1 rounded hover:bg-muted transition-colors flex items-center gap-2"
                    >
                      <span className="flex-1 truncate">{t.title}</span>
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        {nameFor(t.assigned_to)}
                      </span>
                      {t.due_date && (
                        <span className="font-mono tabular-nums text-[10px] text-muted-foreground shrink-0">
                          {formatDueChip(t.due_date)}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
