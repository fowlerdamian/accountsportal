import { useQuery } from "@tanstack/react-query";
import { supabase } from "@portal/lib/supabase";
import type { DateRange } from "./useMarketingDashboard";

// AGA & FleetCraft are B2B-by-nature: they have no ecommerce or marketing email.
// Their marketing performance IS the health of their sales pipeline — the
// channel-tagged lead generation and outbound activity that the sales-support
// module already collects. We read that straight from Postgres (RLS-guarded,
// same as the SalesSupport app) rather than through an integration function.
//
// The two halves answer different questions, so they scope differently:
//   • Generation + outbound are PERIOD-bound (what happened in the selected
//     window) — new leads discovered, calls queued.
//   • Pipeline composition is a CURRENT snapshot (the live funnel state) — what
//     the channel is sitting on right now, regardless of when it landed.

export type PipelineChannel = "aga" | "fleetcraft";

export interface StatusBucket { status: string; count: number }

export interface PipelineMetrics {
  // current snapshot
  totalLeads: number;        // all leads ever discovered for the channel
  activeLeads: number;       // not disqualified
  qualified: number;         // active & score >= 70 (hot)
  warm: number;              // active & 45 <= score < 70
  avgScore: number;          // mean score of active leads
  syncedToCrm: number;       // handed to HubSpot (hubspot_synced_at set)
  statusFunnel: StatusBucket[];
  // period-bound
  newLeads: number;          // discovered within the selected period
  generationSeries: { date: string; leads: number }[];
  callsQueued: number;       // call_list rows scheduled within the period
  callsCompleted: number;    // of those, marked complete
}

const STATUS_ORDER = ["new", "enriched", "scored", "qualified", "contacted", "converted", "disqualified"];

export function usePipelineMetrics(channel: PipelineChannel, range?: DateRange, enabled = true) {
  return useQuery<PipelineMetrics>({
    queryKey: ["pipeline_metrics", channel, range?.startDate ?? null, range?.endDate ?? null],
    enabled,
    queryFn: async () => {
      const [leadsRes, callsRes] = await Promise.all([
        supabase
          .from("sales_leads")
          .select("id, status, lead_score, discovery_date, hubspot_synced_at")
          .eq("channel", channel)
          .limit(2000),
        range
          ? supabase
              .from("call_list")
              .select("id, is_complete, scheduled_date")
              .eq("channel", channel)
              .gte("scheduled_date", range.startDate)
              .lte("scheduled_date", range.endDate)
          : supabase.from("call_list").select("id, is_complete, scheduled_date").eq("channel", channel),
      ]);
      if (leadsRes.error) throw leadsRes.error;
      if (callsRes.error) throw callsRes.error;

      const allLeads = leadsRes.data ?? [];
      const calls = callsRes.data ?? [];

      // Everything is scoped to the selected period by when the lead was
      // discovered, so the whole view responds to the month / CY / FY filter.
      // (totalDiscovered keeps the all-time count for context.)
      const inRange = (iso?: string | null) => {
        if (!range) return true;        // no range → all-time
        if (!iso) return false;
        const d = String(iso).slice(0, 10);
        return d >= range.startDate && d <= range.endDate;
      };
      const leads = allLeads.filter((l) => inRange(l.discovery_date));

      const active = leads.filter((l) => l.status !== "disqualified");
      const scores = active.map((l) => Number(l.lead_score) || 0);
      const avgScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;

      // status distribution, ordered by the canonical funnel then by count
      const byStatus = new Map<string, number>();
      for (const l of leads) byStatus.set(l.status, (byStatus.get(l.status) ?? 0) + 1);
      const statusFunnel = [...byStatus.entries()]
        .map(([status, count]) => ({ status, count }))
        .sort((a, b) => {
          const ai = STATUS_ORDER.indexOf(a.status);
          const bi = STATUS_ORDER.indexOf(b.status);
          return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
        });

      const byDay = new Map<string, number>();
      for (const l of leads) {
        const d = String(l.discovery_date ?? "").slice(0, 10);
        if (d) byDay.set(d, (byDay.get(d) ?? 0) + 1);
      }
      const generationSeries = [...byDay.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, leads]) => ({ date, leads }));

      return {
        totalLeads: allLeads.length,
        activeLeads: active.length,
        qualified: active.filter((l) => (Number(l.lead_score) || 0) >= 70).length,
        warm: active.filter((l) => {
          const s = Number(l.lead_score) || 0;
          return s >= 45 && s < 70;
        }).length,
        avgScore,
        syncedToCrm: leads.filter((l) => !!l.hubspot_synced_at).length,
        statusFunnel,
        newLeads: leads.length,
        generationSeries,
        callsQueued: calls.length,
        callsCompleted: calls.filter((c) => c.is_complete).length,
      };
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    placeholderData: (prev) => prev,
  });
}
