// ─────────────────────────────────────────────────────────────────────────────
// TanStack Query hooks for the Opportunity Pressure module.
// Mirrors the conventions of @tasks/hooks/use-task-queries.ts.
//
// Tasks are ONE row in staff_tasks, surfaced here via staff_tasks.opportunity_id
// — never copied. All task writes go through the same table the tasks app uses.
// HubSpot is the system of record for activity writes: log/create actions call
// the opportunity-sync edge function, which writes HubSpot FIRST and only then
// reflects locally. A failed HubSpot write surfaces as a mutation error and
// nothing is shown as saved.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@portal/lib/supabase";
import type { StaffTask } from "@tasks/hooks/use-task-queries";

export type Division = "TrailBait" | "FleetCraft" | "OEM";

export interface Opportunity {
  id:                  string;
  hubspot_deal_id:     string;
  account_name:        string;
  deal_name:           string;
  amount:              number | null;
  probability:         number | null;
  expected_close_date: string | null;
  owner_name:          string | null;
  owner_email:         string | null;
  stage:               string | null;
  division:            Division | null;
  is_open:             boolean;
  is_parked:           boolean;
  hubspot_created_at:  string | null;
  last_synced_at:      string | null;
  created_at:          string;
  updated_at:          string;
}

export type ActivityType = "note" | "call" | "email" | "meeting";

export interface OpportunityActivity {
  id:                    string;
  opportunity_id:        string;
  hubspot_engagement_id: string | null;
  type:                  ActivityType;
  note:                  string | null;
  owner_name:            string | null;
  occurred_at:           string;
  created_at:            string;
}

// ── Reads ────────────────────────────────────────────────────────────────────

export function useOpportunities() {
  return useQuery({
    queryKey: ["opportunities"],
    queryFn: async (): Promise<Opportunity[]> => {
      const { data, error } = await supabase
        .from("opportunities")
        .select("*")
        .eq("is_open", true)
        .order("amount", { ascending: false, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as Opportunity[];
    },
  });
}

export function useOpportunityActivities(opportunityIds: string[]) {
  return useQuery({
    queryKey: ["opportunity_activities", [...opportunityIds].sort().join(",")],
    enabled: opportunityIds.length > 0,
    queryFn: async (): Promise<OpportunityActivity[]> => {
      const { data, error } = await supabase
        .from("opportunity_activities")
        .select("*")
        .in("opportunity_id", opportunityIds)
        .order("occurred_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as OpportunityActivity[];
    },
  });
}

/** Tasks linked to any open opportunity — the same rows the tasks app renders. */
export function useOpportunityTasks(opportunityIds: string[]) {
  return useQuery({
    queryKey: ["opportunity_tasks", [...opportunityIds].sort().join(",")],
    enabled: opportunityIds.length > 0,
    // A task ticked in another tab must not linger as open here.
    refetchOnWindowFocus: "always",
    queryFn: async (): Promise<StaffTask[]> => {
      const { data, error } = await supabase
        .from("staff_tasks")
        .select("*")
        .in("opportunity_id", opportunityIds);
      if (error) throw error;
      return (data ?? []) as StaffTask[];
    },
  });
}

/** Realtime: any change to opportunities, activities, or linked tasks refreshes the field. */
export function useOpportunityRealtime(): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    const channel = supabase
      .channel(`opportunity-pressure-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "opportunities" }, () => {
        queryClient.invalidateQueries({ queryKey: ["opportunities"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "opportunity_activities" }, () => {
        queryClient.invalidateQueries({ queryKey: ["opportunity_activities"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "staff_tasks" }, () => {
        queryClient.invalidateQueries({ queryKey: ["opportunity_tasks"] });
        queryClient.invalidateQueries({ queryKey: ["staff_tasks"] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);
}

// ── Edge-function-backed writes (HubSpot first, local reflect second) ────────

async function invokeSync<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("opportunity-sync", { body });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data as T;
}

export interface LogActivityPayload {
  opportunity_id: string;
  type: ActivityType;
  note: string;
  owner_name: string;
}

export function useLogActivity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: LogActivityPayload) =>
      invokeSync<{ activity: OpportunityActivity }>({ action: "log_activity", ...payload }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["opportunity_activities"] });
      queryClient.invalidateQueries({ queryKey: ["opportunities"] });
    },
  });
}

export interface CreateOpportunityTaskPayload {
  opportunity_id: string;
  title: string;
  description?: string | null;
  due_date?: string | null;
  assigned_to: string;
  created_by: string;
}

export function useCreateOpportunityTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateOpportunityTaskPayload) =>
      invokeSync<{ task: StaffTask }>({ action: "create_task", ...payload }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["opportunity_tasks"] });
      queryClient.invalidateQueries({ queryKey: ["staff_tasks"] });
    },
  });
}

/**
 * Complete / reopen a linked task. Writes the SAME staff_tasks row the tasks
 * app owns — the DB trigger stamps or clears completed_at. HubSpot task status
 * is pushed after the fact (and reconciled on every scheduled sync), so a
 * transient push failure never blocks the local completion.
 */
export function useSetTaskStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, done }: { id: string; done: boolean }) => {
      const { data, error } = await supabase
        .from("staff_tasks")
        .update({ status: done ? "done" : "not_started" })
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      invokeSync({ action: "push_task_status", staff_task_id: id }).catch(() => {
        /* reconciled by the next scheduled sync */
      });
      return data as StaffTask;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["opportunity_tasks"] });
      queryClient.invalidateQueries({ queryKey: ["staff_tasks"] });
    },
  });
}

export function useParkOpportunity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, parked }: { id: string; parked: boolean }) => {
      const { error } = await supabase
        .from("opportunities")
        .update({ is_parked: parked })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["opportunities"] }),
  });
}

export function useManualSync() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => invokeSync<{ synced: number }>({ action: "pull" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["opportunities"] });
      queryClient.invalidateQueries({ queryKey: ["opportunity_activities"] });
      queryClient.invalidateQueries({ queryKey: ["opportunity_tasks"] });
    },
  });
}
