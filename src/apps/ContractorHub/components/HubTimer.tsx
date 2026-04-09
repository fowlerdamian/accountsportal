import { useEffect, useRef, useState } from "react";
import { Timer, Square, X } from "lucide-react";
import { cn } from "@guide/lib/utils";
import { toast } from "sonner";
import { useAuth } from "@guide/contexts/AuthContext";
import {
  useProjects,
  useTasks,
  useContractors,
  useLogTime,
  usePostActivity,
  useMyContractorProfile,
} from "@hub/hooks/use-hub-queries";

// ─────────────────────────────────────────────────────────────────────────────
// localStorage persistence
// ─────────────────────────────────────────────────────────────────────────────

const STORAGE_KEY = "hub_timer";

interface TimerState {
  startedAt: number; // Date.now() when started
}

function readTimer(): TimerState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as TimerState) : null;
  } catch {
    return null;
  }
}

function writeTimer(state: TimerState | null): void {
  if (state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function elapsedHours(ms: number): number {
  return Math.round((ms / 3600000) * 4) / 4; // round to nearest 0.25
}

// ─────────────────────────────────────────────────────────────────────────────
// Save modal
// ─────────────────────────────────────────────────────────────────────────────

function TimerSaveModal({
  elapsedMs,
  onSave,
  onDiscard,
}: {
  elapsedMs:  number;
  onSave:     () => void;
  onDiscard:  () => void;
}) {
  const { user }    = useAuth();
  const [projectId, setProjectId]     = useState("");
  const [taskId,    setTaskId]        = useState("");
  const [hours,     setHours]         = useState(() => String(Math.max(0.25, elapsedHours(elapsedMs))));
  const [desc,      setDesc]          = useState("");
  const [contractorId, setContractorId] = useState("");
  const [saving,    setSaving]        = useState(false);

  const { data: projects    = [] } = useProjects();
  const { data: tasks       = [] } = useTasks(projectId || undefined);
  const { data: contractors = [] } = useContractors();
  const { data: myProfile }        = useMyContractorProfile(user?.id);
  const { mutateAsync: logTime }   = useLogTime();
  const { mutateAsync: postActivity } = usePostActivity();

  const activeProjects = projects.filter(p => p.status === "active");
  const parentTasks    = tasks.filter(t => !t.parent_task_id);

  // Auto-set contractor for contractor users
  useEffect(() => {
    if (myProfile) setContractorId(myProfile.id);
  }, [myProfile]);

  const isStaff = !myProfile;

  const authorName = user?.user_metadata?.full_name ?? user?.email?.split("@")[0] ?? "Staff";

  async function handleSave() {
    if (!projectId || !contractorId || !hours) return;
    const h = parseFloat(hours);
    if (isNaN(h) || h <= 0) { toast.error("Enter valid hours"); return; }

    setSaving(true);
    try {
      const entry = await logTime({
        contractor_id: contractorId,
        project_id:    projectId,
        task_id:       taskId || null,
        hours:         h,
        description:   desc || undefined,
        source:        "timer",
      });
      if (user) {
        const project = activeProjects.find(p => p.id === projectId);
        await postActivity({
          project_id:   projectId,
          task_id:      taskId || null,
          type:         "time_log",
          content:      `${authorName} logged ${h} hr${h !== 1 ? "s" : ""} via timer${desc ? ` — ${desc}` : ""}`,
          author_id:    user.id,
          author_name:  authorName,
          metadata:     { hours: h, source: "timer" },
        });
      }
      toast.success(`Logged ${h} hrs`);
      onSave();
    } catch (err) {
      toast.error("Failed to log time");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onDiscard} />
      <div
        className="relative w-full max-w-sm rounded-xl border bg-background shadow-2xl p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-sm">Save time entry</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Timer ran for {formatElapsed(elapsedMs)}
            </p>
          </div>
          <button onClick={onDiscard} className="p-1.5 rounded hover:bg-muted text-muted-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Project */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Project *</label>
          <select
            value={projectId}
            onChange={(e) => { setProjectId(e.target.value); setTaskId(""); }}
            className="w-full rounded-lg border bg-muted/30 px-3 py-2 text-sm outline-none focus:border-primary/50"
          >
            <option value="">Select project…</option>
            {activeProjects.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>

        {/* Task */}
        {projectId && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Task</label>
            <select
              value={taskId}
              onChange={(e) => setTaskId(e.target.value)}
              className="w-full rounded-lg border bg-muted/30 px-3 py-2 text-sm outline-none focus:border-primary/50"
            >
              <option value="">No specific task</option>
              {parentTasks.map(t => (
                <option key={t.id} value={t.id}>{t.title}</option>
              ))}
            </select>
          </div>
        )}

        {/* Contractor — staff only */}
        {isStaff && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Contractor *</label>
            <select
              value={contractorId}
              onChange={(e) => setContractorId(e.target.value)}
              className="w-full rounded-lg border bg-muted/30 px-3 py-2 text-sm outline-none focus:border-primary/50"
            >
              <option value="">Select contractor…</option>
              {contractors.filter(c => c.status === "active").map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* Hours */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Hours *</label>
          <input
            type="number"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            min="0.25"
            max="24"
            step="0.25"
            className="w-full rounded-lg border bg-muted/30 px-3 py-2 text-sm outline-none focus:border-primary/50"
          />
        </div>

        {/* Description */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Description</label>
          <input
            type="text"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="What were you working on?"
            className="w-full rounded-lg border bg-muted/30 px-3 py-2 text-sm outline-none focus:border-primary/50 placeholder:text-muted-foreground/60"
          />
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          <button
            onClick={handleSave}
            disabled={!projectId || !contractorId || saving}
            className={cn(
              "flex-1 py-2 rounded-lg text-sm font-medium transition-colors",
              projectId && contractorId && !saving
                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                : "bg-muted text-muted-foreground cursor-not-allowed",
            )}
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            onClick={onDiscard}
            className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:bg-muted transition-colors"
          >
            Discard
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Timer button (mounted in HubLayout header)
// ─────────────────────────────────────────────────────────────────────────────

export function HubTimerButton() {
  const [timerState, setTimerState] = useState<TimerState | null>(readTimer);
  const [elapsed,    setElapsed]    = useState(0);
  const [showSave,   setShowSave]   = useState(false);
  const intervalRef                 = useRef<ReturnType<typeof setInterval> | null>(null);

  const isRunning = !!timerState;

  // Tick while running
  useEffect(() => {
    if (!timerState) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      setElapsed(0);
      return;
    }
    const tick = () => setElapsed(Date.now() - timerState.startedAt);
    tick();
    intervalRef.current = setInterval(tick, 1000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [timerState]);

  function start() {
    const state: TimerState = { startedAt: Date.now() };
    writeTimer(state);
    setTimerState(state);
  }

  function stop() {
    setShowSave(true);
  }

  function handleSaved() {
    writeTimer(null);
    setTimerState(null);
    setShowSave(false);
  }

  function handleDiscard() {
    writeTimer(null);
    setTimerState(null);
    setShowSave(false);
  }

  return (
    <>
      <button
        onClick={isRunning ? stop : start}
        title={isRunning ? "Stop timer" : "Start timer"}
        style={{
          display: "flex", alignItems: "center", gap: "6px",
          fontSize: "11px", fontFamily: '"JetBrains Mono", monospace',
          color:      isRunning ? "#f3ca0f" : "#555",
          background: "none",
          border:     `1px solid ${isRunning ? "rgba(243,202,15,0.4)" : "#222222"}`,
          borderRadius: "4px", padding: "4px 10px", cursor: "pointer",
          transition: "color 120ms, border-color 120ms",
        }}
      >
        {isRunning ? (
          <>
            <Square size={10} style={{ fill: "#f3ca0f", color: "#f3ca0f" }} />
            <span>{formatElapsed(elapsed)}</span>
          </>
        ) : (
          <>
            <Timer size={12} strokeWidth={1.5} />
            <span className="hidden sm:inline">Timer</span>
          </>
        )}
      </button>

      {showSave && timerState && (
        <TimerSaveModal
          elapsedMs={elapsed}
          onSave={handleSaved}
          onDiscard={handleDiscard}
        />
      )}
    </>
  );
}
