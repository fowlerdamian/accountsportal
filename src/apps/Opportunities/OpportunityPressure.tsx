// ─────────────────────────────────────────────────────────────────────────────
// Opportunity Pressure — pipeline hygiene, not forecasting.
// Every open opportunity is a bubble that grows while nothing is logged
// against it. The job is to keep the field flat.
// ─────────────────────────────────────────────────────────────────────────────

import { useMemo, useState } from "react";
import PressureField from "./components/PressureField";
import DetailPanel from "./components/DetailPanel";
import {
  useOpportunities,
  useOpportunityActivities,
  useOpportunityTasks,
  useOpportunityRealtime,
  useManualSync,
  type OpportunityActivity,
} from "./hooks/useOpportunityQueries";
import type { StaffTask } from "@tasks/hooks/use-task-queries";

export default function OpportunityPressure() {
  const { data: opportunities = [], isLoading } = useOpportunities();
  const oppIds = useMemo(() => opportunities.map((o) => o.id), [opportunities]);
  const { data: activities = [] } = useOpportunityActivities(oppIds);
  const { data: tasks = [] } = useOpportunityTasks(oppIds);
  useOpportunityRealtime();
  const manualSync = useManualSync();

  const [selectedId, setSelectedId] = useState<string | null>(null);

  const activitiesByOpp = useMemo(() => {
    const m = new Map<string, OpportunityActivity[]>();
    for (const a of activities) {
      const list = m.get(a.opportunity_id) ?? [];
      list.push(a);
      m.set(a.opportunity_id, list);
    }
    return m;
  }, [activities]);

  const tasksByOpp = useMemo(() => {
    const m = new Map<string, StaffTask[]>();
    for (const t of tasks) {
      const oppId = (t as StaffTask & { opportunity_id: string | null }).opportunity_id;
      if (!oppId) continue;
      const list = m.get(oppId) ?? [];
      list.push(t);
      m.set(oppId, list);
    }
    return m;
  }, [tasks]);

  const selected = opportunities.find((o) => o.id === selectedId) ?? null;

  return (
    <div style={{ display: "flex", height: "calc(100vh - 48px)", background: "var(--bg-primary)" }}>
      <div style={{ flex: 1, position: "relative", minWidth: 0 }}>
        <div
          style={{
            position: "absolute",
            top: 14,
            left: 18,
            zIndex: 1,
            pointerEvents: "none",
          }}
        >
          <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)" }}>
            Opportunities
          </div>
          <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 2 }}>
            Keep the field flat
          </div>
        </div>

        {!isLoading && opportunities.length === 0 ? (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
              color: "var(--text-tertiary)",
              fontSize: 13,
            }}
          >
            <span>No open opportunities yet.</span>
            <button
              onClick={() => manualSync.mutate()}
              disabled={manualSync.isPending}
              style={{
                background: "none",
                border: "1px solid var(--border-strong)",
                borderRadius: "var(--radius-sm)",
                color: "var(--text-primary)",
                fontSize: 13,
                padding: "7px 14px",
                cursor: "pointer",
              }}
            >
              {manualSync.isPending ? "Syncing…" : "Sync from HubSpot"}
            </button>
            {manualSync.isError && (
              <span style={{ color: "var(--brand-pink)", fontSize: 12, maxWidth: 360, textAlign: "center" }}>
                {manualSync.error instanceof Error ? manualSync.error.message : "Sync failed."}
              </span>
            )}
          </div>
        ) : (
          <PressureField
            opportunities={opportunities}
            activitiesByOpp={activitiesByOpp}
            tasksByOpp={tasksByOpp}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        )}
      </div>

      {selected && (
        <DetailPanel
          key={selected.id}
          opportunity={selected}
          activities={activitiesByOpp.get(selected.id) ?? []}
          tasks={tasksByOpp.get(selected.id) ?? []}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}
