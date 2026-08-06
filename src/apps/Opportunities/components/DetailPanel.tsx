// ─────────────────────────────────────────────────────────────────────────────
// Detail panel. Deliberately spare: value, close date, win chance, then the
// activity register. No multipliers, growth rates, slack countdowns, health
// percentages, or formula explainers — the user learns which deals are hungry
// by living with the tool.
// ─────────────────────────────────────────────────────────────────────────────

import { useMemo, useState } from "react";
import { X, RefreshCw, ExternalLink } from "lucide-react";
import { DatePicker } from "@portal/components/DatePicker";
import { useAuth } from "@portal/context/AuthContext";
import { useStaffProfiles } from "@tasks/hooks/use-task-queries";
import type { StaffTask } from "@tasks/hooks/use-task-queries";
import {
  useLogActivity,
  useCreateOpportunityTask,
  useSetTaskStatus,
  useParkOpportunity,
  useManualSync,
  type Opportunity,
  type OpportunityActivity,
  type ActivityType,
} from "../hooks/useOpportunityQueries";

const fmtCurrency = (v: number | null) =>
  v == null
    ? "—"
    : new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(v);

const fmtDate = (iso: string | null | undefined) =>
  !iso
    ? "—"
    : new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString("en-AU", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });

const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short" }) +
  " " +
  new Date(iso).toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" });

const fmtPercent = (p: number | null) => (p == null ? "—" : `${Math.round(p * 100)}%`);

const TYPE_LABELS: Record<string, string> = {
  note: "Note",
  call: "Call",
  email: "Email",
  meeting: "Meeting",
  task: "Task",
};

interface RegisterEntry {
  key: string;
  type: string;
  note: string;
  owner: string;
  dateIso: string;
}

interface DetailPanelProps {
  opportunity: Opportunity;
  activities: OpportunityActivity[];
  tasks: StaffTask[];
  onClose: () => void;
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "var(--bg-surface)",
  border: "1px solid var(--border-default)",
  borderRadius: "var(--radius-sm)",
  color: "var(--text-primary)",
  fontFamily: "var(--font-sans)",
  fontSize: 13,
  padding: "7px 9px",
  outline: "none",
};

const fieldLabelStyle: React.CSSProperties = {
  fontSize: 11,
  fontFamily: "var(--font-mono)",
  letterSpacing: "0.05em",
  textTransform: "uppercase",
  color: "var(--text-tertiary)",
  marginBottom: 4,
};

export default function DetailPanel({ opportunity, activities, tasks, onClose }: DetailPanelProps) {
  const { user } = useAuth();
  const { data: profiles = [] } = useStaffProfiles();
  const logActivity = useLogActivity();
  const createTask = useCreateOpportunityTask();
  const setTaskStatus = useSetTaskStatus();
  const park = useParkOpportunity();
  const manualSync = useManualSync();

  const [form, setForm] = useState<"none" | "task" | "activity">("none");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDue, setTaskDue] = useState<string | null>(null);
  const [taskAssignee, setTaskAssignee] = useState<string>("");
  const [actType, setActType] = useState<ActivityType>("call");
  const [actNote, setActNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const profileName = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of profiles) m.set(p.id, p.full_name ?? p.email ?? "Staff");
    return (id: string) => m.get(id) ?? "Staff";
  }, [profiles]);

  const openTasks = tasks
    .filter((t) => t.status !== "done")
    .sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"));

  const register: RegisterEntry[] = useMemo(() => {
    const done: RegisterEntry[] = tasks
      .filter((t) => t.status === "done" && t.completed_at)
      .map((t) => ({
        key: `task-${t.id}`,
        type: "task",
        note: t.title,
        owner: profileName(t.assigned_to),
        dateIso: t.completed_at as string,
      }));
    const acts: RegisterEntry[] = activities.map((a) => ({
      key: `act-${a.id}`,
      type: a.type,
      note: a.note ?? "",
      owner: a.owner_name ?? "—",
      dateIso: a.occurred_at,
    }));
    return [...done, ...acts].sort((a, b) => b.dateIso.localeCompare(a.dateIso));
  }, [tasks, activities, profileName]);

  const submitTask = async () => {
    if (!taskTitle.trim() || !user?.id) return;
    setError(null);
    try {
      await createTask.mutateAsync({
        opportunity_id: opportunity.id,
        account_name: opportunity.account_name,
        deal_name: opportunity.deal_name,
        title: taskTitle.trim(),
        due_date: taskDue,
        assigned_to: taskAssignee || user.id,
        created_by: user.id,
      });
      setTaskTitle("");
      setTaskDue(null);
      setForm("none");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Task could not be saved.");
    }
  };

  const submitActivity = async () => {
    if (!actNote.trim() || !user) return;
    setError(null);
    try {
      await logActivity.mutateAsync({
        opportunity_id: opportunity.id,
        type: actType,
        note: actNote.trim(),
        owner_name: (user.user_metadata?.full_name as string) ?? user.email?.split("@")[0] ?? "Staff",
      });
      setActNote("");
      setForm("none");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Activity could not be saved to HubSpot.");
    }
  };

  return (
    <aside
      style={{
        width: 380,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        background: "var(--bg-elevated)",
        borderLeft: "1px solid var(--border-default)",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "16px 18px 12px",
          borderBottom: "1px solid var(--border-subtle)",
          display: "flex",
          alignItems: "flex-start",
          gap: 8,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Company first, opportunity beneath — both always shown here. */}
          <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)" }}>
            {opportunity.account_name || "No linked company"}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
            {opportunity.deal_name}
          </div>
        </div>
        <button
          onClick={() => park.mutate({ id: opportunity.id, parked: !opportunity.is_parked })}
          title={opportunity.is_parked ? "Resume growth tracking" : "Park this opportunity"}
          style={{
            background: "none",
            border: "1px solid var(--border-default)",
            borderRadius: "var(--radius-sm)",
            color: opportunity.is_parked ? "var(--brand-accent)" : "var(--text-tertiary)",
            fontSize: 11,
            fontFamily: "var(--font-mono)",
            padding: "3px 8px",
            cursor: "pointer",
          }}
        >
          {opportunity.is_parked ? "Parked" : "Park"}
        </button>
        <button
          onClick={onClose}
          aria-label="Close panel"
          style={{ background: "none", border: "none", color: "var(--text-tertiary)", cursor: "pointer", padding: 2 }}
        >
          <X size={16} />
        </button>
      </div>

      {/* The three fields — nothing more. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 12,
          padding: "14px 18px",
          borderBottom: "1px solid var(--border-subtle)",
        }}
      >
        <div>
          <div style={fieldLabelStyle}>Value</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)", fontFamily: "var(--font-mono)" }}>
            {fmtCurrency(opportunity.amount)}
          </div>
        </div>
        <div>
          <div style={fieldLabelStyle}>Close</div>
          <div style={{ fontSize: 13, color: "var(--text-primary)", paddingTop: 2 }}>
            {fmtDate(opportunity.expected_close_date)}
          </div>
        </div>
        <div>
          <div style={fieldLabelStyle}>Win chance</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)", fontFamily: "var(--font-mono)" }}>
            {fmtPercent(opportunity.probability)}
          </div>
        </div>
      </div>

      {/* Activity register */}
      <div style={{ flex: 1, overflowY: "auto", padding: "10px 18px" }}>
        {openTasks.map((t) => (
          <label
            key={t.id}
            style={{
              display: "flex",
              gap: 10,
              alignItems: "flex-start",
              padding: "9px 10px",
              marginBottom: 6,
              background: "var(--bg-surface)",
              border: "1px solid var(--border-default)",
              borderRadius: "var(--radius-md)",
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={false}
              disabled={setTaskStatus.isPending}
              onChange={() => setTaskStatus.mutate({ id: t.id, done: true })}
              style={{ marginTop: 2, accentColor: "var(--brand-accent)" }}
            />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, color: "var(--text-primary)" }}>{t.title}</div>
              <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 2 }}>
                {profileName(t.assigned_to)}
                {t.due_date ? ` · due ${fmtDate(t.due_date)}` : ""}
              </div>
            </div>
          </label>
        ))}

        {register.map((e) => (
          <div
            key={e.key}
            style={{ padding: "9px 2px", borderBottom: "1px solid var(--border-subtle)" }}
          >
            <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
              <span
                style={{
                  fontSize: 10,
                  fontFamily: "var(--font-mono)",
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                  color: "var(--text-tertiary)",
                  border: "1px solid var(--border-default)",
                  borderRadius: 3,
                  padding: "1px 5px",
                  flexShrink: 0,
                }}
              >
                {TYPE_LABELS[e.type] ?? e.type}
              </span>
              <span style={{ fontSize: 11, color: "var(--text-tertiary)", marginLeft: "auto", flexShrink: 0 }}>
                {fmtDateTime(e.dateIso)}
              </span>
            </div>
            {e.note && (
              <div style={{ fontSize: 13, color: "var(--text-primary)", marginTop: 4, whiteSpace: "pre-wrap" }}>
                {e.note}
              </div>
            )}
            <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 3 }}>{e.owner}</div>
          </div>
        ))}

        {openTasks.length === 0 && register.length === 0 && (
          <div style={{ fontSize: 13, color: "var(--text-tertiary)", padding: "18px 0", textAlign: "center" }}>
            Nothing logged against this opportunity yet.
          </div>
        )}
      </div>

      {/* Error surface — a failed HubSpot write is never shown as saved. */}
      {error && (
        <div
          style={{
            margin: "0 18px 8px",
            padding: "8px 10px",
            fontSize: 12,
            color: "var(--brand-pink)",
            background: "rgba(var(--brand-pink-rgb), 0.1)",
            border: "1px solid rgba(var(--brand-pink-rgb), 0.3)",
            borderRadius: "var(--radius-sm)",
          }}
        >
          {error}
        </div>
      )}

      {/* Inline forms */}
      {form === "task" && (
        <div style={{ padding: "10px 18px", borderTop: "1px solid var(--border-subtle)", display: "grid", gap: 8 }}>
          <input
            style={inputStyle}
            placeholder="Task title"
            value={taskTitle}
            onChange={(e) => setTaskTitle(e.target.value)}
            autoFocus
          />
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ flex: 1 }}>
              <DatePicker value={taskDue} onChange={setTaskDue} />
            </div>
            <select
              style={{ ...inputStyle, flex: 1, width: "auto" }}
              value={taskAssignee || user?.id || ""}
              onChange={(e) => setTaskAssignee(e.target.value)}
            >
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name ?? p.email}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
      {form === "activity" && (
        <div style={{ padding: "10px 18px", borderTop: "1px solid var(--border-subtle)", display: "grid", gap: 8 }}>
          <select style={inputStyle} value={actType} onChange={(e) => setActType(e.target.value as ActivityType)}>
            <option value="call">Call</option>
            <option value="note">Note</option>
            <option value="email">Email</option>
            <option value="meeting">Meeting</option>
          </select>
          <textarea
            style={{ ...inputStyle, minHeight: 64, resize: "vertical" }}
            placeholder="What happened?"
            value={actNote}
            onChange={(e) => setActNote(e.target.value)}
            autoFocus
          />
        </div>
      )}

      {/* Foot: the two actions */}
      <div style={{ display: "flex", gap: 8, padding: "12px 18px", borderTop: "1px solid var(--border-subtle)" }}>
        {form === "none" ? (
          <>
            <button
              onClick={() => { setError(null); setForm("task"); }}
              style={{
                flex: 1,
                background: "none",
                border: "1px solid var(--border-strong)",
                borderRadius: "var(--radius-sm)",
                color: "var(--text-primary)",
                fontSize: 13,
                fontWeight: 500,
                padding: "8px 0",
                cursor: "pointer",
              }}
            >
              New task
            </button>
            <button
              onClick={() => { setError(null); setForm("activity"); }}
              style={{
                flex: 1,
                background: "var(--brand-accent)",
                border: "1px solid var(--brand-accent)",
                borderRadius: "var(--radius-sm)",
                color: "var(--accent-text)",
                fontSize: 13,
                fontWeight: 600,
                padding: "8px 0",
                cursor: "pointer",
              }}
            >
              Log activity
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => { setForm("none"); setError(null); }}
              style={{
                flex: 1,
                background: "none",
                border: "1px solid var(--border-strong)",
                borderRadius: "var(--radius-sm)",
                color: "var(--text-secondary)",
                fontSize: 13,
                padding: "8px 0",
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
            <button
              onClick={form === "task" ? submitTask : submitActivity}
              disabled={createTask.isPending || logActivity.isPending}
              style={{
                flex: 1,
                background: "var(--brand-accent)",
                border: "1px solid var(--brand-accent)",
                borderRadius: "var(--radius-sm)",
                color: "var(--accent-text)",
                fontSize: 13,
                fontWeight: 600,
                padding: "8px 0",
                cursor: "pointer",
                opacity: createTask.isPending || logActivity.isPending ? 0.6 : 1,
              }}
            >
              {createTask.isPending || logActivity.isPending ? "Saving…" : "Save"}
            </button>
          </>
        )}
      </div>

      {/* Sync line */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "8px 18px 12px",
          fontSize: 11,
          fontFamily: "var(--font-mono)",
          color: "var(--text-tertiary)",
        }}
      >
        <span>
          {opportunity.last_synced_at ? `Synced ${fmtDateTime(opportunity.last_synced_at)}` : "Not yet synced"}
        </span>
        {/* Quiet escape hatch to the deal record in HubSpot — same deep-link
            format the Sales Support pipeline uses. */}
        <a
          href={`https://app-ap1.hubspot.com/deals/22572063/${opportunity.hubspot_deal_id}`}
          target="_blank"
          rel="noreferrer"
          title="Open in HubSpot"
          style={{ color: "var(--text-tertiary)", display: "flex", padding: 2, marginLeft: "auto" }}
        >
          <ExternalLink size={13} />
        </a>
        <button
          onClick={() => manualSync.mutate()}
          disabled={manualSync.isPending}
          title="Sync with HubSpot now"
          style={{
            background: "none",
            border: "none",
            color: "var(--text-tertiary)",
            cursor: "pointer",
            padding: 2,
            display: "flex",
          }}
        >
          <RefreshCw size={13} className={manualSync.isPending ? "animate-spin" : undefined} />
        </button>
      </div>
    </aside>
  );
}
