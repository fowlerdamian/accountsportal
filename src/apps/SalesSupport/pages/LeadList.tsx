import { useState } from "react";
import { useOutletContext } from "react-router-dom";
import { Search, Filter, Loader2, RefreshCw, ExternalLink, ChevronUp, ChevronDown } from "lucide-react";
import { cn } from "../../../apps/Guide/lib/utils";
import { useLeads } from "../hooks/useSalesQueries";
import { LeadScoreBadge } from "../components/LeadScoreBadge";
import { LeadDetailDrawer } from "../components/LeadDetailDrawer";
import { LEAD_STATUS_COLOR, LEAD_STATUS_LABEL, SUPABASE_FN_URL, type Channel } from "../lib/constants";
import type { SalesLead } from "../hooks/useSalesQueries";
import { supabase } from "../../../lib/supabase";
import { useQueryClient } from "@tanstack/react-query";

type SortKey = "lead_score" | "company_name" | "updated_at" | "status";

const STATES = ["NSW", "VIC", "QLD", "SA", "WA", "TAS", "NT", "ACT"];

export default function LeadList() {
  const { channel } = useOutletContext<{ channel: Channel }>();
  const qc = useQueryClient();

  const [search, setSearch]       = useState("");
  const [statusFilter, setStatus] = useState("all");
  const [minScore, setMinScore]   = useState(0);
  const [stateFilter, setState]   = useState("");
  const [existingOnly, setExistingOnly] = useState(false);
  const [sortKey, setSortKey]     = useState<SortKey>("lead_score");
  const [sortAsc, setSortAsc]     = useState(false);
  const [selectedLead, setSelectedLead] = useState<SalesLead | null>(null);
  const [selectedIds, setSelectedIds]   = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction]     = useState<string | null>(null);

  const { data: leads = [], isLoading, refetch } = useLeads(channel, {
    status: statusFilter !== "all" ? statusFilter : undefined,
    minScore,
    state: stateFilter || undefined,
    existingOnly,
  });

  // Client-side search + sort
  const filtered = leads
    .filter((l) =>
      !search || l.company_name.toLowerCase().includes(search.toLowerCase()) ||
      (l.address ?? "").toLowerCase().includes(search.toLowerCase())
    )
    .sort((a, b) => {
      let cmp = 0;
      if      (sortKey === "lead_score")   cmp = a.lead_score - b.lead_score;
      else if (sortKey === "company_name") cmp = a.company_name.localeCompare(b.company_name);
      else if (sortKey === "updated_at")   cmp = a.updated_at.localeCompare(b.updated_at);
      else if (sortKey === "status")       cmp = a.status.localeCompare(b.status);
      return sortAsc ? cmp : -cmp;
    });

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  }

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return null;
    return sortAsc ? <ChevronUp className="w-3.5 h-3.5 inline ml-1" /> : <ChevronDown className="w-3.5 h-3.5 inline ml-1" />;
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedIds.size === filtered.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(filtered.map((l) => l.id)));
  }

  async function executeBulk(action: string) {
    if (!selectedIds.size) return;
    setBulkAction(action);
    const ids = [...selectedIds];
    try {
      if (action === "hubspot") {
        const { data: { session } } = await supabase.auth.getSession();
        for (const id of ids) {
          await fetch(SUPABASE_FN_URL("sales-hubspot-sync"), {
            method:  "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${session?.access_token ?? ""}` },
            body: JSON.stringify({ lead_id: id }),
          });
        }
      } else if (action === "enrich") {
        const { data: { session } } = await supabase.auth.getSession();
        for (const id of ids) {
          await fetch(SUPABASE_FN_URL("sales-lead-enrichment"), {
            method:  "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${session?.access_token ?? ""}` },
            body: JSON.stringify({ lead_id: id }),
          });
        }
      } else if (action === "disqualify") {
        await supabase.from("sales_leads").update({ status: "disqualified" }).in("id", ids);
      }
      setSelectedIds(new Set());
      qc.invalidateQueries({ queryKey: ["sales_leads", channel] });
    } finally {
      setBulkAction(null);
    }
  }

  const TH = ({ col, children }: { col?: SortKey; children: React.ReactNode }) => (
    <th
      onClick={col ? () => toggleSort(col) : undefined}
      className={cn("text-left text-xs text-muted-foreground font-medium px-3 py-2.5 whitespace-nowrap", col && "cursor-pointer hover:text-foreground select-none")}
    >
      {children}{col && <SortIcon col={col} />}
    </th>
  );

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Search */}
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search companies, locations..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 bg-muted/40 border border-border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
        </div>

        {/* Filters */}
        <select value={statusFilter} onChange={(e) => setStatus(e.target.value)}
          className="px-2.5 py-1.5 bg-muted/40 border border-border rounded-lg text-sm focus:outline-none cursor-pointer">
          <option value="all">All statuses</option>
          {["new","researched","enriched","queued","contacted","converted","disqualified"].map((s) => (
            <option key={s} value={s}>{LEAD_STATUS_LABEL[s]}</option>
          ))}
        </select>

        <select value={stateFilter} onChange={(e) => setState(e.target.value)}
          className="px-2.5 py-1.5 bg-muted/40 border border-border rounded-lg text-sm focus:outline-none cursor-pointer">
          <option value="">All states</option>
          {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>

        <label className="flex items-center gap-1.5 text-sm cursor-pointer">
          <input type="checkbox" checked={existingOnly} onChange={(e) => setExistingOnly(e.target.checked)}
            className="rounded border-border" />
          Existing customers
        </label>

        <div className="flex items-center gap-2 text-sm">
          <Filter className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-muted-foreground text-xs">Min score:</span>
          <input type="number" min={0} max={100} value={minScore} onChange={(e) => setMinScore(Number(e.target.value))}
            className="w-16 px-2 py-1 bg-muted/40 border border-border rounded text-xs focus:outline-none text-center" />
        </div>

        <button onClick={() => refetch()} className="p-1.5 rounded hover:bg-muted/50 transition-colors">
          <RefreshCw className={cn("w-4 h-4", isLoading && "animate-spin")} />
        </button>
      </div>

      {/* Bulk actions */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-primary/10 border border-primary/30 text-sm">
          <span className="text-primary font-medium">{selectedIds.size} selected</span>
          <div className="flex gap-2 ml-auto">
            {[
              { key: "hubspot", label: "Push to HubSpot" },
              { key: "enrich",  label: "Re-enrich" },
              { key: "disqualify", label: "Disqualify" },
            ].map(({ key, label }) => (
              <button key={key} onClick={() => executeBulk(key)} disabled={!!bulkAction}
                className="px-3 py-1 text-xs rounded bg-muted hover:bg-muted/70 transition-colors disabled:opacity-50 flex items-center gap-1.5">
                {bulkAction === key && <Loader2 className="w-3 h-3 animate-spin" />}
                {label}
              </button>
            ))}
            <button onClick={() => setSelectedIds(new Set())}
              className="px-3 py-1 text-xs rounded hover:bg-muted/50 transition-colors text-muted-foreground">
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Count */}
      <div className="text-xs text-muted-foreground">
        {filtered.length} lead{filtered.length !== 1 ? "s" : ""}
        {search && ` matching "${search}"`}
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border bg-card/50 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="px-3 py-2.5 w-10">
                  <input type="checkbox"
                    checked={selectedIds.size === filtered.length && filtered.length > 0}
                    onChange={toggleSelectAll}
                    className="rounded border-border" />
                </th>
                <TH col="company_name">Company</TH>
                <TH col="lead_score">Score</TH>
                <TH col="status">Status</TH>
                <TH>Location</TH>
                <TH>Rating</TH>
                <TH>Contact</TH>
                <TH>Existing</TH>
                <TH>Source</TH>
                <TH col="updated_at">Updated</TH>
                <th className="px-3 py-2.5 w-10" />
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={11} className="py-12 text-center">
                    <Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" />
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={11} className="py-12 text-center text-muted-foreground">
                    No leads found. Run discovery to populate this list.
                  </td>
                </tr>
              ) : filtered.map((lead) => (
                <tr
                  key={lead.id}
                  onClick={() => setSelectedLead(lead)}
                  className={cn(
                    "border-b border-border/50 last:border-0 hover:bg-muted/20 transition-colors cursor-pointer",
                    selectedIds.has(lead.id) && "bg-primary/5"
                  )}
                >
                  <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={selectedIds.has(lead.id)} onChange={() => toggleSelect(lead.id)}
                      className="rounded border-border" />
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="font-medium">{lead.company_name}</div>
                    {lead.website && (
                      <div className="text-xs text-muted-foreground truncate max-w-[180px]">
                        {lead.website.replace(/^https?:\/\/(www\.)?/, "")}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <LeadScoreBadge score={lead.lead_score} size="sm" />
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={cn("text-xs px-2 py-0.5 rounded-full whitespace-nowrap", LEAD_STATUS_COLOR[lead.status])}>
                      {LEAD_STATUS_LABEL[lead.status]}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-sm text-muted-foreground whitespace-nowrap">
                    {[lead.state, lead.postcode].filter(Boolean).join(" ") || "—"}
                  </td>
                  <td className="px-3 py-2.5 text-sm">
                    {lead.google_rating != null ? (
                      <span className="text-yellow-400">★ {lead.google_rating}</span>
                    ) : "—"}
                    {lead.google_review_count != null && (
                      <span className="text-xs text-muted-foreground ml-1">({lead.google_review_count})</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-sm text-muted-foreground max-w-[140px] truncate">
                    {lead.recommended_contact_name ?? "—"}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    {lead.is_existing_customer ? (
                      <span className="text-xs text-green-400 font-medium">Yes</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">No</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                    {lead.discovery_source.replace(/_/g, " ")}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                    {new Date(lead.updated_at).toLocaleDateString("en-AU")}
                  </td>
                  <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                    {lead.hubspot_company_id && (
                      <a href={`https://app.hubspot.com/contacts/${lead.hubspot_company_id}`} target="_blank" rel="noopener noreferrer"
                        className="p-1 rounded hover:bg-muted/50 transition-colors text-muted-foreground hover:text-orange-400 inline-block">
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Lead detail drawer */}
      <LeadDetailDrawer
        lead={selectedLead}
        onClose={() => setSelectedLead(null)}
        onLeadUpdated={() => {
          qc.invalidateQueries({ queryKey: ["sales_leads", channel] });
          setSelectedLead(null);
        }}
      />
    </div>
  );
}
