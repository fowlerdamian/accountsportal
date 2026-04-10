import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../../lib/supabase";
import type { Channel } from "../lib/constants";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SalesLead {
  id: string;
  channel: Channel;
  company_name: string;
  website: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  state: string | null;
  postcode: string | null;
  google_rating: number | null;
  google_review_count: number | null;
  google_place_id: string | null;
  social_facebook: string | null;
  social_instagram: string | null;
  social_linkedin: string | null;
  website_summary: string | null;
  key_products_services: string[] | null;
  recommended_contact_name: string | null;
  recommended_contact_position: string | null;
  recommended_contact_source: string | null;
  discovery_source: string;
  discovery_query: string | null;
  discovery_date: string;
  tender_context: string | null;
  hubspot_company_id: string | null;
  hubspot_deal_id: string | null;
  hubspot_synced_at: string | null;
  cin7_customer_id: string | null;
  cin7_customer_tag: string | null;
  is_existing_customer: boolean;
  lead_score: number;
  score_breakdown: Record<string, number> | null;
  status: string;
  disqualification_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface CallEntry {
  id: string;
  lead_id: string;
  channel: Channel;
  priority_rank: number;
  call_reason: string;
  talking_points: string[] | null;
  context_brief: Record<string, any> | null;
  called_at: string | null;
  call_outcome: string | null;
  call_notes: string | null;
  hubspot_note_synced: boolean;
  scheduled_date: string;
  is_complete: boolean;
  created_at: string;
  sales_leads?: SalesLead;
}

export interface OrderHistory {
  id: string;
  cin7_customer_id: string;
  lead_id: string | null;
  last_order_date: string | null;
  order_count_30d: number;
  order_count_90d: number;
  total_revenue_90d: number;
  average_order_value: number;
  top_products: Array<{ sku: string; name: string; qty: number }> | null;
  days_since_last_order: number | null;
  is_winback_candidate: boolean;
  last_synced: string;
}

export interface ResearchJob {
  id: string;
  channel: Channel;
  job_type: string;
  status: string;
  leads_found: number;
  leads_enriched: number;
  error_log: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

// ─── Leads queries ────────────────────────────────────────────────────────────

export function useLeads(channel: Channel, filters?: {
  status?: string;
  minScore?: number;
  maxScore?: number;
  state?: string;
  existingOnly?: boolean;
}) {
  return useQuery({
    queryKey: ["sales_leads", channel, filters],
    queryFn: async () => {
      let q = supabase
        .from("sales_leads")
        .select("*")
        .eq("channel", channel)
        .order("lead_score", { ascending: false });

      if (filters?.status && filters.status !== "all") q = q.eq("status", filters.status);
      if (filters?.minScore != null) q = q.gte("lead_score", filters.minScore);
      if (filters?.maxScore != null) q = q.lte("lead_score", filters.maxScore);
      if (filters?.state) q = q.eq("state", filters.state);
      if (filters?.existingOnly) q = q.eq("is_existing_customer", true);

      const { data, error } = await q.limit(200);
      if (error) throw error;
      return data as SalesLead[];
    },
    staleTime: 30_000,
  });
}

export function useLead(id: string) {
  return useQuery({
    queryKey: ["sales_lead", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales_leads")
        .select("*")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data as SalesLead;
    },
  });
}

export function useOrderHistory(cin7CustomerId: string | null) {
  return useQuery({
    queryKey: ["order_history", cin7CustomerId],
    queryFn: async () => {
      if (!cin7CustomerId) return null;
      const { data, error } = await supabase
        .from("trailbait_order_history")
        .select("*")
        .eq("cin7_customer_id", cin7CustomerId)
        .single();
      if (error) return null;
      return data as OrderHistory;
    },
    enabled: !!cin7CustomerId,
  });
}

// ─── Call list queries ────────────────────────────────────────────────────────

export function useCallList(channel: Channel, date?: string) {
  const targetDate = date ?? new Date().toISOString().split("T")[0];
  return useQuery({
    queryKey: ["call_list", channel, targetDate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("call_list")
        .select("*, sales_leads(*)")
        .eq("channel", channel)
        .eq("scheduled_date", targetDate)
        .order("priority_rank", { ascending: true });
      if (error) throw error;
      return data as CallEntry[];
    },
    staleTime: 15_000,
  });
}

export function useCallEntry(id: string) {
  return useQuery({
    queryKey: ["call_entry", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("call_list")
        .select("*, sales_leads(*)")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data as CallEntry;
    },
  });
}

// ─── Research jobs ────────────────────────────────────────────────────────────

export function useRecentJobs(channel?: Channel) {
  return useQuery({
    queryKey: ["research_jobs", channel],
    queryFn: async () => {
      let q = supabase
        .from("research_jobs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(20);
      if (channel) q = q.eq("channel", channel);
      const { data, error } = await q;
      if (error) throw error;
      return data as ResearchJob[];
    },
    refetchInterval: 15_000,
  });
}

// ─── Dashboard metrics ────────────────────────────────────────────────────────

export function useDashboardMetrics() {
  return useQuery({
    queryKey: ["sales_dashboard_metrics"],
    queryFn: async () => {
      const today   = new Date().toISOString().split("T")[0];
      const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();

      const [leadsRes, callsRes, winbackRes, jobsRes] = await Promise.all([
        supabase.from("sales_leads").select("id, channel, lead_score, status, created_at"),
        supabase.from("call_list").select("id, channel, is_complete, scheduled_date").eq("scheduled_date", today),
        supabase.from("trailbait_order_history").select("id").eq("is_winback_candidate", true),
        supabase.from("research_jobs").select("*").order("created_at", { ascending: false }).limit(6),
      ]);

      const leads    = leadsRes.data ?? [];
      const calls    = callsRes.data ?? [];
      const winbacks = winbackRes.data ?? [];
      const jobs     = jobsRes.data ?? [];

      const byChannel = (ch: Channel) => {
        const chLeads   = leads.filter((l) => l.channel === ch);
        const newThisWeek = chLeads.filter((l) => l.created_at > weekAgo).length;
        const top3      = chLeads.sort((a, b) => b.lead_score - a.lead_score).slice(0, 3);
        const chCalls   = calls.filter((c) => c.channel === ch);
        return {
          totalLeads:   chLeads.length,
          newThisWeek,
          top3Leads:    top3,
          callsToday:   chCalls.length,
          callsDone:    chCalls.filter((c) => c.is_complete).length,
        };
      };

      return {
        trailbait:  { ...byChannel("trailbait"),  winbacks: winbacks.length },
        fleetcraft: byChannel("fleetcraft"),
        aga:        byChannel("aga"),
        recentJobs: jobs,
      };
    },
    staleTime: 30_000,
  });
}

// ─── Mutations ────────────────────────────────────────────────────────────────

export function useUpdateCallOutcome() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      callId: string;
      outcome: string;
      notes: string;
      calledAt: string;
    }) => {
      const { error } = await supabase
        .from("call_list")
        .update({
          call_outcome: params.outcome,
          call_notes:   params.notes,
          called_at:    params.calledAt,
          is_complete:  true,
        })
        .eq("id", params.callId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["call_list"] });
      qc.invalidateQueries({ queryKey: ["call_entry"] });
    },
  });
}

export function useSaveCallNotes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { callId: string; notes: string }) => {
      const { error } = await supabase
        .from("call_list")
        .update({ call_notes: params.notes })
        .eq("id", params.callId);
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["call_entry", vars.callId] });
    },
  });
}

export function useDisqualifyLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { leadId: string; reason: string }) => {
      const { error } = await supabase
        .from("sales_leads")
        .update({ status: "disqualified", disqualification_reason: params.reason })
        .eq("id", params.leadId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sales_leads"] }),
  });
}
