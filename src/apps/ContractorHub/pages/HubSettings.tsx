import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, RefreshCw, CheckCircle2, AlertCircle, Loader2, Link2 } from "lucide-react";
import { HubLayout } from "@hub/components/HubLayout";
import { supabase } from "@guide/integrations/supabase/client";
import { useContractors, useUpdateContractor } from "@hub/hooks/use-hub-queries";
import { cn } from "@guide/lib/utils";
import { toast } from "sonner";

// ─────────────────────────────────────────────────────────────────────────────
// Sync log
// ─────────────────────────────────────────────────────────────────────────────

interface SyncLogEntry {
  id:            string;
  direction:     "inbound" | "outbound";
  entity_type:   string;
  entity_id:     string | null;
  status:        "success" | "error";
  error_message: string | null;
  metadata:      Record<string, unknown> | null;
  created_at:    string;
}

function useSyncLog(filters: { status?: string; contractorId?: string }) {
  return useQuery({
    queryKey: ["hub_sync_log", filters.status, filters.contractorId],
    queryFn:  async () => {
      let q = supabase
        .from("upwork_sync_log")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      if (filters.status)       q = q.eq("status", filters.status);
      const { data, error } = await q;
      if (error) throw error;
      return data as SyncLogEntry[];
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Upwork connect section
// ─────────────────────────────────────────────────────────────────────────────

function UpworkConnect() {
  const clientId   = import.meta.env.VITE_UPWORK_CLIENT_ID as string | undefined;
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const callbackUrl = `${supabaseUrl}/functions/v1/upwork-oauth-callback`;

  const authUrl = clientId
    ? `https://www.upwork.com/ab/account-security/oauth2/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(callbackUrl)}`
    : null;

  if (!clientId) {
    return (
      <div className="rounded-lg border border-dashed border-border p-5 space-y-2">
        <p className="text-sm font-medium">Upwork not configured</p>
        <p className="text-xs text-muted-foreground">
          Add <code className="text-primary">VITE_UPWORK_CLIENT_ID</code> to your environment variables,
          then register your app callback URL at{" "}
          <a
            href="https://www.upwork.com/developer/keys/apply"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline inline-flex items-center gap-1"
          >
            upwork.com/developer <ExternalLink className="w-3 h-3" />
          </a>
        </p>
        <p className="text-xs text-muted-foreground">
          Callback URL: <code className="text-xs bg-muted px-1 py-0.5 rounded">{callbackUrl}</code>
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">Upwork OAuth</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Authorise access to sync timesheets and messages.
          </p>
        </div>
        <a
          href={authUrl!}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          <Link2 className="w-4 h-4" />
          Connect Upwork
        </a>
      </div>
      <p className="text-xs text-muted-foreground">
        Callback URL:{" "}
        <code className="text-xs bg-muted px-1 py-0.5 rounded">{callbackUrl}</code>
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Contract mapping section
// ─────────────────────────────────────────────────────────────────────────────

function ContractMapping() {
  const { data: contractors = [] } = useContractors();
  const { mutateAsync: updateContractor } = useUpdateContractor();
  const [editing, setEditing] = useState<Record<string, string>>({});

  const upworkContractors = contractors.filter((c) => c.source === "upwork");

  if (upworkContractors.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No Upwork contractors yet. Add contractors with source set to "Upwork" to map them here.
      </p>
    );
  }

  async function handleSave(contractorId: string) {
    const contractId = editing[contractorId]?.trim();
    if (!contractId) return;
    try {
      await updateContractor({ id: contractorId, upwork_contract_id: contractId } as any);
      setEditing((e) => { const n = { ...e }; delete n[contractorId]; return n; });
      toast.success("Contract ID saved");
    } catch {
      toast.error("Failed to save");
    }
  }

  return (
    <div className="space-y-2">
      {upworkContractors.map((c) => (
        <div key={c.id} className="flex items-center gap-3 py-2.5 border-b border-border/50 last:border-0">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{c.name}</p>
            <p className="text-xs text-muted-foreground">{c.role}</p>
          </div>
          {editing[c.id] !== undefined ? (
            <div className="flex items-center gap-2">
              <input
                value={editing[c.id]}
                onChange={(e) => setEditing((prev) => ({ ...prev, [c.id]: e.target.value }))}
                placeholder="Upwork contract ID"
                autoFocus
                className="rounded border bg-muted/30 px-2 py-1 text-xs outline-none focus:border-primary/50 w-48"
              />
              <button
                onClick={() => handleSave(c.id)}
                className="text-xs px-2 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                Save
              </button>
              <button
                onClick={() => setEditing((e) => { const n = { ...e }; delete n[c.id]; return n; })}
                className="text-xs px-2 py-1 rounded hover:bg-muted transition-colors text-muted-foreground"
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <code className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                {c.upwork_contract_id ?? "—"}
              </code>
              <button
                onClick={() => setEditing((e) => ({ ...e, [c.id]: c.upwork_contract_id ?? "" }))}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Edit
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sync log table
// ─────────────────────────────────────────────────────────────────────────────

function SyncLogTable() {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const { data: entries = [], isLoading, refetch, isFetching } = useSyncLog({
    status: statusFilter === "all" ? undefined : statusFilter,
  });

  return (
    <div className="space-y-3">
      {/* Filters */}
      <div className="flex items-center gap-3">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded border bg-muted/30 px-2 py-1.5 text-xs outline-none focus:border-primary/50"
        >
          <option value="all">All statuses</option>
          <option value="success">Success</option>
          <option value="error">Errors only</option>
        </select>

        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-1.5 px-2 py-1.5 rounded border text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <RefreshCw className={cn("w-3 h-3", isFetching && "animate-spin")} />
          Refresh
        </button>

        <span className="text-xs text-muted-foreground ml-auto">
          {entries.length} entries
        </span>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : entries.length === 0 ? (
        <p className="text-xs text-muted-foreground py-6 text-center">
          No sync log entries yet. They appear here once Upwork sync functions run.
        </p>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b bg-muted/30">
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Time</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Direction</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Type</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Status</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Detail</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                  <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                    {new Date(entry.created_at).toLocaleString([], {
                      month: "short", day: "numeric",
                      hour: "2-digit", minute: "2-digit",
                    })}
                  </td>
                  <td className="px-3 py-2">
                    <span className={cn(
                      "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium",
                      entry.direction === "inbound"
                        ? "bg-blue-900/30 text-blue-300"
                        : "bg-orange-900/30 text-orange-300",
                    )}>
                      {entry.direction}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{entry.entity_type}</td>
                  <td className="px-3 py-2">
                    {entry.status === "success" ? (
                      <span className="flex items-center gap-1 text-green-400">
                        <CheckCircle2 className="w-3 h-3" /> ok
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-red-400">
                        <AlertCircle className="w-3 h-3" /> error
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground max-w-[240px] truncate">
                    {entry.error_message ?? (
                      entry.metadata
                        ? JSON.stringify(entry.metadata).substring(0, 80)
                        : "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export default function HubSettings() {
  return (
    <HubLayout>
      <div className="max-w-2xl space-y-10">
        <h1 className="text-xl font-semibold">Settings</h1>

        {/* Upwork integration */}
        <section className="space-y-4">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Upwork Integration
            </h2>
            <p className="text-xs text-muted-foreground mt-1">
              Connect your Upwork account to sync contractor timesheets and messages automatically.
            </p>
          </div>
          <UpworkConnect />
        </section>

        {/* Contract mapping */}
        <section className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Contract Mapping
          </h2>
          <ContractMapping />
        </section>

        {/* Cron setup */}
        <section className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Cron Jobs
          </h2>
          <div className="rounded-lg border border-dashed border-border p-4 space-y-2 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">Manual setup required</p>
            <p>After enabling pg_cron and pg_net in the Supabase dashboard, run the commented SQL in:</p>
            <code className="block bg-muted px-2 py-1.5 rounded text-[11px]">
              supabase/migrations/20260409000003_upwork_sync_log.sql
            </code>
            <p>This schedules the daily overdue notification (8 AM AEST) and 15-minute Upwork sync.</p>
          </div>
        </section>

        {/* Sync log */}
        <section className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Sync Log
          </h2>
          <SyncLogTable />
        </section>
      </div>
    </HubLayout>
  );
}
