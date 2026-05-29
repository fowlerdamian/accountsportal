// ─────────────────────────────────────────────────────────────────────────────
// TanStack Query hooks for the staff_tasks app.
// Mirrors the shape of @hub/hooks/use-hub-queries.ts (same module conventions:
// useX / useCreateX / useUpdateX, query keys, invalidation on success).
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@guide/integrations/supabase/client";
import { notifyTaskAssignee } from "../lib/notifyTaskChat";

// ── Types ────────────────────────────────────────────────────────────────────

export type StaffTaskStatus = "not_started" | "in_progress" | "blocked" | "done";

export interface StaffTask {
  id:                 string;
  title:              string;
  description:        string | null;
  status:             StaffTaskStatus;
  created_by:         string;
  assigned_to:        string;
  due_date:           string | null;
  urgency:            number | null;
  importance:         number | null;
  blocked_by_task_id: string | null;
  parent_task_id:     string | null;
  completed_at:       string | null;
  ai_summary:         string | null;
  status_notes:       string | null;
  created_at:         string;
  updated_at:         string;
}

/**
 * Fire-and-forget AI-summary generation. Writes back to staff_tasks.ai_summary;
 * the realtime channel subscription will propagate the result to clients.
 */
function regenerateSummary(taskId: string): void {
  supabase.functions
    .invoke("generate-task-summary", { body: { task_id: taskId } })
    .catch((err) => console.warn("[generate-task-summary]", err));
}

/**
 * When a blocker task is completed, the DB trigger
 * (handle_staff_task_blocker_done) auto-flips any parent it was blocking back
 * to 'not_started'. The trigger can't reach Google Chat, so here we alert each
 * unblocked parent's *creator* — the person who was waiting on this work.
 * Fire-and-forget; never throws.
 */
async function notifyBlockerDone(blockerId: string): Promise<void> {
  try {
    const { data, error } = await supabase
      .from("staff_tasks")
      .select("id, created_by, title")
      .eq("blocked_by_task_id", blockerId);
    if (error || !data || data.length === 0) return;
    // Don't ping the person who just marked the blocker done about their own task.
    const { data: { user } } = await supabase.auth.getUser();
    const actorId = user?.id;
    for (const parent of data as Pick<StaffTask, "id" | "created_by" | "title">[]) {
      if (parent.created_by === actorId) continue;
      notifyTaskAssignee({
        task_id:      parent.id,
        recipient_id: parent.created_by,
        event:        "blocker_done",
        task_title:   parent.title,
      });
    }
  } catch (err) {
    console.warn("[notifyBlockerDone]", err);
  }
}

export interface StaffTaskComment {
  id:         string;
  task_id:    string;
  author_id:  string;
  body:       string;
  mentions:   string[];
  created_at: string;
}

export interface StaffProfile {
  id:                      string;
  full_name:               string | null;
  email:                   string | null;
  google_chat_webhook_url: string | null;
}

// ── Profiles (assignee pool) ─────────────────────────────────────────────────

export function useStaffProfiles() {
  return useQuery({
    queryKey: ["staff_profiles"],
    queryFn:  async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, email, google_chat_webhook_url")
        .order("full_name", { nullsFirst: false });
      if (error) throw error;
      return data as StaffProfile[];
    },
    staleTime: 5 * 60_000, // staff list rarely changes
  });
}

// ── Tasks ────────────────────────────────────────────────────────────────────

interface UseStaffTasksParams {
  assignedTo?:   string;
  createdBy?:    string;
  statuses?:     StaffTaskStatus[];
  /** Include tasks where the user is creator OR assignee. */
  involving?:    string;
}

export function useStaffTasks(params: UseStaffTasksParams = {}) {
  const { assignedTo, createdBy, statuses, involving } = params;
  return useQuery({
    queryKey: ["staff_tasks", { assignedTo, createdBy, statuses, involving }],
    queryFn:  async () => {
      let q = supabase.from("staff_tasks").select("*").order("due_date", { ascending: true, nullsFirst: false });
      if (assignedTo) q = q.eq("assigned_to", assignedTo);
      if (createdBy)  q = q.eq("created_by", createdBy);
      if (involving)  q = q.or(`assigned_to.eq.${involving},created_by.eq.${involving}`);
      if (statuses && statuses.length > 0) q = q.in("status", statuses);
      const { data, error } = await q;
      if (error) throw error;
      return data as StaffTask[];
    },
  });
}

export function useStaffTask(id: string | undefined) {
  return useQuery({
    queryKey: ["staff_task", id],
    enabled:  !!id,
    queryFn:  async () => {
      const { data, error } = await supabase
        .from("staff_tasks")
        .select("*")
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data as StaffTask;
    },
  });
}

type CreateStaffTaskPayload = {
  title:              string;
  description?:       string | null;
  assigned_to:        string;
  created_by:         string;
  due_date?:          string | null;
  urgency?:           number | null;
  importance?:        number | null;
  blocked_by_task_id?: string | null;
  parent_task_id?:    string | null;
  status?:            StaffTaskStatus;
};

export function useCreateStaffTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreateStaffTaskPayload) => {
      const { data, error } = await supabase
        .from("staff_tasks")
        .insert({ status: "not_started", ...payload })
        .select()
        .single();
      if (error) throw error;
      return data as StaffTask;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["staff_tasks"] });
      // Fire-and-forget AI summary so the dock pill has a clean short label.
      regenerateSummary(data.id);
    },
  });
}

export function useUpdateStaffTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<StaffTask> & { id: string }) => {
      const { data, error } = await supabase
        .from("staff_tasks")
        .update(updates)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return { task: data as StaffTask, changed: updates };
    },
    onSuccess: ({ task, changed }) => {
      qc.invalidateQueries({ queryKey: ["staff_tasks"] });
      qc.invalidateQueries({ queryKey: ["staff_task", task.id] });
      // Regenerate the dock-pill summary only when title or description
      // actually changed — avoids burning tokens on status/assignee edits.
      if ("title" in changed || "description" in changed) {
        regenerateSummary(task.id);
      }
      // A completed task may have been blocking others — alert their creators
      // that they're now unblocked (mirrors the server-side auto-unblock trigger).
      if (changed.status === "done") {
        notifyBlockerDone(task.id);
      }
    },
  });
}

export function useDeleteStaffTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("staff_tasks").delete().eq("id", id);
      if (error) throw error;
      return id;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["staff_tasks"] });
    },
  });
}

/**
 * Atomic dependency creation: insert the dependency task, then flip the
 * parent to 'blocked' + point at the new task. Best-effort transaction —
 * Supabase JS doesn't expose true multi-statement transactions from the
 * client, so we run them sequentially and rely on the auto-unblock trigger
 * to keep things consistent if the parent update later races.
 */
export function useAddDependency() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      parent_task_id: string;
      parent_due_date: string | null;
      title:           string;
      description?:    string | null;
      assigned_to:     string;
      created_by:      string;
      due_date:        string | null;
      urgency:         number | null;
      importance:      number | null;
    }) => {
      // 1. Create the dependency task
      const { data: dep, error: depErr } = await supabase
        .from("staff_tasks")
        .insert({
          status:         "not_started",
          parent_task_id: args.parent_task_id,
          title:          args.title,
          description:    args.description ?? null,
          assigned_to:    args.assigned_to,
          created_by:     args.created_by,
          due_date:       args.due_date,
          urgency:        args.urgency,
          importance:     args.importance,
        })
        .select()
        .single();
      if (depErr) throw depErr;

      // 2. Point the parent at it + flip to blocked. If this fails we
      //    roll back the dependency insert so the parent isn't left with
      //    an orphan child that doesn't actually block anything.
      const { error: parErr } = await supabase
        .from("staff_tasks")
        .update({
          blocked_by_task_id: (dep as StaffTask).id,
          status:             "blocked",
        })
        .eq("id", args.parent_task_id);
      if (parErr) {
        await supabase.from("staff_tasks").delete().eq("id", (dep as StaffTask).id);
        throw parErr;
      }

      return dep as StaffTask;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["staff_tasks"] });
    },
  });
}

// ── Comments ─────────────────────────────────────────────────────────────────

export function useTaskComments(taskId: string | undefined) {
  return useQuery({
    queryKey: ["staff_task_comments", taskId],
    enabled:  !!taskId,
    queryFn:  async () => {
      const { data, error } = await supabase
        .from("staff_task_comments")
        .select("*")
        .eq("task_id", taskId!)
        .order("created_at");
      if (error) throw error;
      return data as StaffTaskComment[];
    },
  });
}

/**
 * Comments across a whole dependency "family" (a parent task + all of its
 * dependency children), merged into one chronological thread. This is what
 * lets a comment posted on a dependency surface on the original/parent task —
 * and vice-versa — so everyone working the blocked item sees one conversation.
 * Each row keeps its own `task_id`, so callers can label cross-task comments.
 */
export function useThreadComments(taskIds: string[]) {
  const ids = Array.from(new Set(taskIds.filter(Boolean))).sort();
  return useQuery({
    queryKey: ["staff_task_comments_thread", ids.join(",")],
    enabled:  ids.length > 0,
    queryFn:  async () => {
      const { data, error } = await supabase
        .from("staff_task_comments")
        .select("*")
        .in("task_id", ids)
        .order("created_at");
      if (error) throw error;
      return data as StaffTaskComment[];
    },
  });
}

export function useAddTaskComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { task_id: string; author_id: string; body: string; mentions?: string[] }) => {
      const { data, error } = await supabase
        .from("staff_task_comments")
        .insert({ ...payload, mentions: payload.mentions ?? [] })
        .select()
        .single();
      if (error) throw error;
      return data as StaffTaskComment;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["staff_task_comments", data.task_id] });
      // The new comment may belong to a dependency family thread — refresh those too.
      qc.invalidateQueries({ queryKey: ["staff_task_comments_thread"] });
    },
  });
}

// ── Realtime — keep the staff_tasks list cache fresh ─────────────────────────

/**
 * Subscribe to all staff_tasks row events for the current session and
 * invalidate every staff_tasks query. Mount once at the portal root.
 */
export function useStaffTasksRealtime(): void {
  const qc        = useQueryClient();
  const channelId = useRef(`staff_tasks_rt_${Math.random().toString(36).slice(2)}`);

  useEffect(() => {
    const channel = supabase
      .channel(channelId.current)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "staff_tasks" },
        () => qc.invalidateQueries({ queryKey: ["staff_tasks"] }),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "staff_task_comments" },
        (payload) => {
          const taskId = (payload.new as any)?.task_id ?? (payload.old as any)?.task_id;
          if (taskId) qc.invalidateQueries({ queryKey: ["staff_task_comments", taskId] });
          // Family threads aggregate multiple task_ids — refresh them all.
          qc.invalidateQueries({ queryKey: ["staff_task_comments_thread"] });
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [qc]);
}

/**
 * Sonner toast popup whenever a task is assigned to (or freshly unblocked for)
 * the current user. Returns nothing — just side-effects.
 */
export function useAssignmentNotifications(userId: string | undefined, onToast: (t: StaffTask) => void): void {
  const seenIds = useRef<Set<string>>(new Set());
  const channelId = useRef(`staff_tasks_assign_${Math.random().toString(36).slice(2)}`);

  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(channelId.current)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "staff_tasks", filter: `assigned_to=eq.${userId}` },
        (payload) => {
          const task = payload.new as StaffTask;
          if (!task || seenIds.current.has(task.id)) return;
          // Belt + suspenders — the postgres_changes filter SHOULD already
          // limit us to rows where assigned_to=userId, but if the filter
          // is silently bypassed (transport-level or client-version bug)
          // we'd start toasting on every task in the system. Re-check.
          if (task.assigned_to !== userId) return;
          // Don't toast self-assignment from this session.
          if (task.created_by === userId) return;
          // Hard cap so the set doesn't grow unbounded over long sessions.
          if (seenIds.current.size > 1000) seenIds.current.clear();
          seenIds.current.add(task.id);
          onToast(task);
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [userId, onToast]);
}
