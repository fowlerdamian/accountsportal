import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@guide/integrations/supabase/client";

// ─────────────────────────────────────────────────────────────
// Local types (schema not yet in auto-generated types.ts)
// ─────────────────────────────────────────────────────────────

export type ContractorStatus = "active" | "paused" | "ended";
export type ContractorSource = "upwork" | "direct";
export type ProjectType      = "other" | "web" | "new_product" | "product" | "website"; // product/website legacy only
export type ProjectStatus    = "planning" | "active" | "on_hold" | "complete";
export type TaskStatus       = "backlog" | "in_progress" | "review" | "done";
export type TaskPriority     = "low" | "medium" | "high" | "urgent";
export type TimeSource       = "manual" | "timer" | "upwork";
export type ActivityType     = "note" | "update" | "status_change" | "file" | "time_log" | "upwork_message";

export interface Contractor {
  id:                 string;
  name:               string;
  email:              string;
  phone:              string | null;
  role:               string;
  hourly_rate:        number | null;
  status:             ContractorStatus;
  source:             ContractorSource;
  upwork_contract_id: string | null;
  upwork_profile_url: string | null;
  avatar_url:         string | null;
  notes:              string | null;
  can_login:          boolean;
  user_id:            string | null;
  created_at:         string;
}

export interface Project {
  id:               string;
  name:             string;
  description:      string | null;
  type:             ProjectType;
  status:           ProjectStatus;
  priority_score:   number | null;
  budget_allocated: number | null;
  start_date:       string | null;
  due_date:         string | null;
  thumbnail_url:    string | null;
  drive_folder_id:  string | null;
  deleted_at:       string | null;
  created_at:       string;
}

export interface Task {
  id:             string;
  project_id:     string;
  parent_task_id: string | null;
  title:          string;
  description:    string | null;
  assigned_to:    string | null;
  status:         TaskStatus;
  priority:       TaskPriority;
  due_date:       string | null;
  position:       number;
  created_at:     string;
  // Joined
  contractors?:   Pick<Contractor, "id" | "name"> | null;
}

export interface TimeEntry {
  id:            string;
  contractor_id: string;
  task_id:       string | null;
  project_id:    string;
  hours:         number;
  description:   string | null;
  date:          string;
  source:        TimeSource;
  created_at:    string;
  // Joined (from time_entries_with_cost view)
  hourly_rate?:  number | null;
  cost?:         number;
  contractors?:  Pick<Contractor, "id" | "name"> | null;
  projects?:     Pick<Project, "id" | "name"> | null;
}

export interface ActivityEntry {
  id:            string;
  contractor_id: string | null;
  project_id:    string | null;
  task_id:       string | null;
  type:          ActivityType;
  content:       string;
  author_id:     string;
  author_name:   string;
  metadata:      Record<string, unknown> | null;
  created_at:    string;
  contractors?:  Pick<Contractor, "id" | "name"> | null;
  projects?:     Pick<Project, "id" | "name"> | null;
}

export interface HubFile {
  id:            string;
  project_id:    string | null;
  task_id:       string | null;
  filename:      string;
  file_url:      string;
  file_size:     number | null;
  mime_type:     string;
  uploaded_by:   string | null;
  source:        "upload" | "upwork" | "drive";
  drive_file_id: string | null;
  thumbnail_url: string | null;
  created_at:    string;
  profiles?:     { full_name: string | null } | null;
}

export interface ProjectBudgetSummary {
  project_id:       string;
  name:             string;
  budget_allocated: number | null;
  budget_spent:     number;
  budget_remaining: number | null;
  total_hours:      number;
}

export interface ProjectStage {
  id:         string;
  project_id: string;
  name:       string;
  position:   number;
  start_date: string | null;
  end_date:   string | null;
  is_active:  boolean;
  metadata:   Record<string, unknown> | null;
  created_at: string;
}

export const NEW_PRODUCT_STAGES = [
  "Idea",
  "Sketch",
  "CAD",
  "Prototype",
  "Complete",
] as const;

export interface AiChatMessage {
  id:         string;
  user_id:    string;
  role:       "user" | "assistant";
  content:    string;
  metadata:   Record<string, unknown> | null;
  created_at: string;
}

// ─────────────────────────────────────────────────────────────
// Contractors
// ─────────────────────────────────────────────────────────────

export function useContractors() {
  return useQuery({
    queryKey: ["hub_contractors"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contractors")
        .select("*")
        .order("name");
      if (error) throw error;
      return data as Contractor[];
    },
  });
}

export function useContractor(id: string | undefined) {
  return useQuery({
    queryKey: ["hub_contractor", id],
    enabled:  !!id,
    queryFn:  async () => {
      const { data, error } = await supabase
        .from("contractors")
        .select("*")
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data as Contractor;
    },
  });
}

export function useCreateContractor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Omit<Contractor, "id" | "created_at">) => {
      const { data, error } = await supabase
        .from("contractors")
        .insert(payload)
        .select()
        .single();
      if (error) throw error;
      return data as Contractor;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hub_contractors"] });
    },
  });
}

export function useUpdateContractor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<Contractor> & { id: string }) => {
      const { data, error } = await supabase
        .from("contractors")
        .update(updates)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data as Contractor;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["hub_contractors"] });
      qc.invalidateQueries({ queryKey: ["hub_contractor", data.id] });
    },
  });
}

// ─────────────────────────────────────────────────────────────
// Projects
// ─────────────────────────────────────────────────────────────

export function useProjects() {
  return useQuery({
    queryKey: ["hub_projects"],
    queryFn:  async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("*")
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Project[];
    },
  });
}

export function useDeletedProjects() {
  return useQuery({
    queryKey: ["hub_projects_deleted"],
    queryFn:  async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("*")
        .not("deleted_at", "is", null)
        .order("deleted_at", { ascending: false });
      if (error) throw error;
      // Client-side filter: only show those deleted within 15 days
      const cutoff = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
      return (data as Project[]).filter(p => p.deleted_at! >= cutoff);
    },
  });
}

export function useProject(id: string | undefined) {
  return useQuery({
    queryKey: ["hub_project", id],
    enabled:  !!id,
    queryFn:  async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("*")
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data as Project;
    },
  });
}

export function useProjectContractors(projectId: string | undefined) {
  return useQuery({
    queryKey: ["hub_project_contractors", projectId],
    enabled:  !!projectId,
    queryFn:  async () => {
      const { data, error } = await supabase
        .from("tasks")
        .select("contractors!inner(id, name, avatar_url, role, source)")
        .eq("project_id", projectId!)
        .not("assigned_to", "is", null);
      if (error) throw error;
      // Deduplicate
      const seen = new Set<string>();
      const unique: Pick<Contractor, "id" | "name" | "avatar_url" | "role" | "source">[] = [];
      for (const row of data ?? []) {
        const c = (row as any).contractors;
        if (c && !seen.has(c.id)) {
          seen.add(c.id);
          unique.push(c);
        }
      }
      return unique;
    },
  });
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Omit<Project, "id" | "created_at" | "drive_folder_id">) => {
      const { data, error } = await supabase
        .from("projects")
        .insert(payload)
        .select()
        .single();
      if (error) throw error;
      const project = data as Project;

      // Fire-and-forget: create matching Google Drive folder
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (!session) return;
        supabase.functions.invoke("google-drive", {
          body: { action: "create_folder", project_id: project.id, project_name: project.name },
        }).catch(() => {});
      });

      return project;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hub_projects"] });
    },
  });
}

export function useUpdateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<Project> & { id: string }) => {
      const { data, error } = await supabase
        .from("projects")
        .update(updates)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data as Project;
    },
    onSuccess: (data, variables) => {
      qc.invalidateQueries({ queryKey: ["hub_projects"] });
      qc.invalidateQueries({ queryKey: ["hub_project", data.id] });
      qc.invalidateQueries({ queryKey: ["hub_budget_summary", data.id] });

      if (variables.name && data.drive_folder_id) {
        supabase.functions.invoke("google-drive", {
          body: { action: "rename_folder", folder_id: data.drive_folder_id, new_name: data.name },
        }).catch(() => {});
      }
    },
  });
}

export function useSoftDeleteProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("projects")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hub_projects"] });
      qc.invalidateQueries({ queryKey: ["hub_projects_deleted"] });
    },
  });
}

export function useRestoreProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("projects")
        .update({ deleted_at: null })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hub_projects"] });
      qc.invalidateQueries({ queryKey: ["hub_projects_deleted"] });
    },
  });
}

export function usePermanentDeleteProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, drive_folder_id }: { id: string; drive_folder_id?: string | null }) => {
      const { error } = await supabase
        .from("projects")
        .delete()
        .eq("id", id);
      if (error) throw error;
      return { drive_folder_id };
    },
    onSuccess: ({ drive_folder_id }) => {
      qc.invalidateQueries({ queryKey: ["hub_projects_deleted"] });
      if (drive_folder_id) {
        supabase.functions.invoke("google-drive", {
          body: { action: "delete_folder", folder_id: drive_folder_id },
        }).catch(() => {});
      }
    },
  });
}

// ─────────────────────────────────────────────────────────────
// Tasks
// ─────────────────────────────────────────────────────────────

export function useTasks(projectId: string | undefined) {
  return useQuery({
    queryKey: ["hub_tasks", projectId],
    enabled:  !!projectId,
    queryFn:  async () => {
      const { data, error } = await supabase
        .from("tasks")
        .select("*, contractors(id, name)")
        .eq("project_id", projectId!)
        .order("position");
      if (error) throw error;
      return data as Task[];
    },
  });
}

export function useTask(id: string | undefined) {
  return useQuery({
    queryKey: ["hub_task", id],
    enabled:  !!id,
    queryFn:  async () => {
      const { data, error } = await supabase
        .from("tasks")
        .select("*, contractors(id, name)")
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data as Task;
    },
  });
}

export function useCreateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      project_id:      string;
      title:           string;
      description?:    string;
      assigned_to?:    string | null;
      status?:         TaskStatus;
      priority?:       TaskPriority;
      due_date?:       string | null;
      parent_task_id?: string | null;
      position?:       number;
    }) => {
      const { data, error } = await supabase
        .from("tasks")
        .insert({ status: "backlog", priority: "medium", ...payload })
        .select("*, contractors(id, name)")
        .single();
      if (error) throw error;
      return data as Task;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["hub_tasks", data.project_id] });
    },
  });
}

export function useUpdateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<Task> & { id: string }) => {
      const { data, error } = await supabase
        .from("tasks")
        .update(updates)
        .eq("id", id)
        .select("*, contractors(id, name)")
        .single();
      if (error) throw error;
      return data as Task;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["hub_tasks", data.project_id] });
      qc.invalidateQueries({ queryKey: ["hub_task", data.id] });
    },
  });
}

export function useDeleteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, project_id }: { id: string; project_id: string }) => {
      const { error } = await supabase.from("tasks").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_data, { project_id }) => {
      qc.invalidateQueries({ queryKey: ["hub_tasks", project_id] });
    },
  });
}

export function useReorderTasks() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (updates: { id: string; position: number }[]) => {
      const promises = updates.map(({ id, position }) =>
        supabase.from("tasks").update({ position }).eq("id", id),
      );
      await Promise.all(promises);
    },
    onSuccess: (_data, variables) => {
      // Invalidate without knowing project_id — use partial key match
      qc.invalidateQueries({ queryKey: ["hub_tasks"] });
    },
  });
}

// ─────────────────────────────────────────────────────────────
// Time entries
// ─────────────────────────────────────────────────────────────

export function useTimeEntries(params: {
  projectId?:    string;
  contractorId?: string;
  taskId?:       string;
} = {}) {
  const { projectId, contractorId, taskId } = params;
  return useQuery({
    queryKey: ["hub_time_entries", projectId, contractorId, taskId],
    queryFn:  async () => {
      let q = supabase
        .from("time_entries_with_cost")
        .select("*, contractors(id, name), projects(id, name)")
        .order("date", { ascending: false });
      if (projectId)    q = q.eq("project_id", projectId);
      if (contractorId) q = q.eq("contractor_id", contractorId);
      if (taskId)       q = q.eq("task_id", taskId);
      const { data, error } = await q;
      if (error) throw error;
      return data as TimeEntry[];
    },
  });
}

export function useLogTime() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      contractor_id: string;
      project_id:    string;
      task_id?:      string | null;
      hours:         number;
      date?:         string;
      description?:  string;
      source?:       TimeSource;
    }) => {
      const { data, error } = await supabase
        .from("time_entries")
        .insert({ source: "manual", date: new Date().toISOString().split("T")[0], ...payload })
        .select()
        .single();
      if (error) throw error;
      return data as TimeEntry;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["hub_time_entries"] });
      qc.invalidateQueries({ queryKey: ["hub_budget_summary", data.project_id] });
      qc.invalidateQueries({ queryKey: ["hub_dashboard_metrics"] });
    },
  });
}

// ─────────────────────────────────────────────────────────────
// Activity log
// ─────────────────────────────────────────────────────────────

export function useActivityLog(params: {
  projectId?:    string;
  contractorId?: string;
  limit?:        number;
} = {}) {
  const { projectId, contractorId, limit = 20 } = params;
  return useQuery({
    queryKey: ["hub_activity", projectId, contractorId],
    queryFn:  async () => {
      let q = supabase
        .from("activity_log")
        .select("*, contractors(id, name), projects(id, name)")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (projectId)    q = q.eq("project_id", projectId);
      if (contractorId) q = q.eq("contractor_id", contractorId);
      const { data, error } = await q;
      if (error) throw error;
      return data as ActivityEntry[];
    },
  });
}

export function usePostActivity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      project_id:     string;
      contractor_id?: string | null;
      task_id?:       string | null;
      type:           ActivityType;
      content:        string;
      author_id:      string;
      author_name:    string;
      metadata?:      Record<string, unknown> | null;
    }) => {
      const { data, error } = await supabase
        .from("activity_log")
        .insert(payload)
        .select()
        .single();
      if (error) throw error;
      return data as ActivityEntry;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["hub_activity", data.project_id] });
      qc.invalidateQueries({ queryKey: ["hub_activity", undefined, data.contractor_id] });
      qc.invalidateQueries({ queryKey: ["hub_dashboard_activity"] });
    },
  });
}

// ─────────────────────────────────────────────────────────────
// Files
// ─────────────────────────────────────────────────────────────

export function useFiles(params: { projectId?: string; taskId?: string } = {}) {
  const { projectId, taskId } = params;
  return useQuery({
    queryKey: ["hub_files", projectId, taskId],
    queryFn:  async () => {
      let q = supabase
        .from("files")
        .select("*")
        .order("created_at", { ascending: false });
      if (projectId) q = q.eq("project_id", projectId);
      if (taskId)    q = q.eq("task_id", taskId);
      const { data, error } = await q;
      if (error) throw error;
      return data as HubFile[];
    },
  });
}

export function useUploadFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      file,
      projectId,
      taskId,
      uploadedBy,
    }: {
      file:       File;
      projectId:  string;
      taskId?:    string;
      uploadedBy: string;
    }) => {
      const path     = `${projectId}/${Date.now()}_${file.name}`;
      const { error: uploadErr } = await supabase.storage
        .from("contractor-hub-files")
        .upload(path, file, { upsert: false });
      if (uploadErr) throw uploadErr;

      const { data: urlData } = supabase.storage
        .from("contractor-hub-files")
        .getPublicUrl(path);

      const { data, error } = await supabase
        .from("files")
        .insert({
          project_id:  projectId,
          task_id:     taskId ?? null,
          filename:    file.name,
          file_url:    urlData.publicUrl,
          file_size:   file.size,
          mime_type:   file.type,
          uploaded_by: uploadedBy,
          source:      "upload",
        })
        .select()
        .single();
      if (error) throw error;
      const hubFile = data as HubFile;

      // Fire-and-forget: sync to Google Drive
      supabase.functions.invoke("google-drive", {
        body: {
          action:     "upload_file",
          file_id:    hubFile.id,
          project_id: projectId,
          file_url:   urlData.publicUrl,
          filename:   file.name,
          mime_type:  file.type || "application/octet-stream",
        },
      }).catch(() => {});

      return hubFile;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["hub_files", data.project_id] });
    },
  });
}

export function useSyncDriveFiles(projectId: string, folderId: string | null | undefined) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!folderId) return;
    supabase.functions.invoke("google-drive", {
      body: { action: "sync_from_drive", project_id: projectId, folder_id: folderId },
    }).then(({ data }) => {
      if (data?.synced > 0) qc.invalidateQueries({ queryKey: ["hub_files", projectId] });
    }).catch(() => {});
  }, [projectId, folderId, qc]);
}

const STEP_EXTS = ["step", "stp"];

export function useGenerateStepThumbnails(files: HubFile[]) {
  const qc       = useQueryClient();
  const firedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const targets = files.filter(f => {
      if (f.thumbnail_url || firedRef.current.has(f.id)) return false;
      const ext = f.filename.split(".").pop()?.toLowerCase() ?? "";
      return STEP_EXTS.includes(ext);
    });
    if (!targets.length) return;
    targets.forEach(f => firedRef.current.add(f.id));

    (async () => {
      const [{ default: occtImport }, THREE] = await Promise.all([
        import("occt-import-js"),
        import("three"),
      ]);
      const occt: any = await occtImport({
        locateFile: (n: string) => n.endsWith(".wasm")
          ? new URL("occt-import-js/dist/occt-import-js.wasm", import.meta.url).href
          : n,
      });

      const projectIds = new Set<string>();
      for (const f of targets) {
        try {
          const resp = await fetch(f.file_url);
          if (!resp.ok) continue;
          const bytes  = new Uint8Array(await resp.arrayBuffer());
          const result = occt.ReadStepFile(bytes, null);
          if (!result?.success || !result.meshes?.length) continue;

          const canvas   = document.createElement("canvas");
          canvas.width   = 512;
          canvas.height  = 512;
          const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
          renderer.setSize(512, 512, false);
          renderer.setClearColor(0x111111, 1);

          const scene = new THREE.Scene();
          scene.add(new THREE.AmbientLight(0xffffff, 0.6));
          const dir = new THREE.DirectionalLight(0xffffff, 1.0);
          dir.position.set(5, 10, 7);
          scene.add(dir);

          const fallbackMat = new THREE.MeshPhongMaterial({
            color: 0xf3ca0f, specular: 0x333333, shininess: 40, side: THREE.DoubleSide,
          });

          const group = new THREE.Group();
          for (const m of result.meshes) {
            const geo = new THREE.BufferGeometry();
            geo.setAttribute("position", new THREE.Float32BufferAttribute(m.attributes.position.array, 3));
            if (m.attributes.normal?.array) {
              geo.setAttribute("normal", new THREE.Float32BufferAttribute(m.attributes.normal.array, 3));
            } else {
              geo.computeVertexNormals();
            }
            if (m.index?.array) geo.setIndex(new THREE.Uint32BufferAttribute(m.index.array, 1));
            const mat = m.color
              ? new THREE.MeshPhongMaterial({
                  color: new THREE.Color(m.color[0], m.color[1], m.color[2]),
                  specular: 0x222222, shininess: 30, side: THREE.DoubleSide,
                })
              : fallbackMat;
            group.add(new THREE.Mesh(geo, mat));
          }
          scene.add(group);

          const box     = new THREE.Box3().setFromObject(group);
          const size    = box.getSize(new THREE.Vector3());
          const center  = box.getCenter(new THREE.Vector3());
          group.position.sub(center);
          const maxDim  = Math.max(size.x, size.y, size.z);
          const camera  = new THREE.PerspectiveCamera(35, 1, 0.01, 10000);
          const dist    = Math.abs(maxDim / (2 * Math.tan((35 * Math.PI / 180) / 2))) * 1.8;
          camera.position.set(dist * 0.6, dist * 0.4, dist);
          camera.lookAt(0, 0, 0);
          renderer.render(scene, camera);

          const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, "image/png"));
          renderer.dispose();
          if (!blob) continue;

          const path = `file-thumbnails/${f.id}.png`;
          const { error: upErr } = await supabase.storage
            .from("contractor-hub-files")
            .upload(path, blob, { contentType: "image/png", upsert: true });
          if (upErr) continue;

          const { data: { publicUrl } } = supabase.storage
            .from("contractor-hub-files")
            .getPublicUrl(path);
          await supabase.from("files").update({ thumbnail_url: publicUrl }).eq("id", f.id);
          if (f.project_id) projectIds.add(f.project_id);
        } catch (err) {
          console.warn("[step-thumb] failed for", f.filename, err);
        }
      }
      projectIds.forEach(pid => qc.invalidateQueries({ queryKey: ["hub_files", pid] }));
    })();
  }, [files, qc]);
}

export function useUploadProjectThumbnail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ file, projectId }: { file: File; projectId: string }) => {
      const path = `thumbnails/${projectId}`;
      await supabase.storage.from("contractor-hub-files").remove([path]);
      const { error: uploadErr } = await supabase.storage
        .from("contractor-hub-files")
        .upload(path, file, { upsert: true, contentType: file.type });
      if (uploadErr) throw uploadErr;
      const { data: urlData } = supabase.storage
        .from("contractor-hub-files")
        .getPublicUrl(path);
      const { error } = await supabase
        .from("projects")
        .update({ thumbnail_url: urlData.publicUrl })
        .eq("id", projectId);
      if (error) throw error;
      return urlData.publicUrl;
    },
    onSuccess: (_url, { projectId }) => {
      qc.invalidateQueries({ queryKey: ["hub_project", projectId] });
      qc.invalidateQueries({ queryKey: ["hub_projects"] });
    },
  });
}

// ─────────────────────────────────────────────────────────────
// Budget summary
// ─────────────────────────────────────────────────────────────

export function useProjectBudgetSummary(projectId: string | undefined) {
  return useQuery({
    queryKey: ["hub_budget_summary", projectId],
    enabled:  !!projectId,
    queryFn:  async () => {
      const { data, error } = await supabase
        .from("project_budget_summary")
        .select("*")
        .eq("project_id", projectId!)
        .single();
      if (error) throw error;
      return data as ProjectBudgetSummary;
    },
  });
}

// ─────────────────────────────────────────────────────────────
// Dashboard metrics
// ─────────────────────────────────────────────────────────────

export function useHubDashboardMetrics() {
  return useQuery({
    queryKey: ["hub_dashboard_metrics"],
    queryFn:  async () => {
      const today = new Date().toISOString().split("T")[0];

      // Monday of current week
      const now  = new Date();
      const day  = now.getDay();
      const diff = day === 0 ? -6 : 1 - day;
      const mon  = new Date(now);
      mon.setDate(now.getDate() + diff);
      const monday = mon.toISOString().split("T")[0];

      const [activeProjects, overdueTasks, weekHours, budgetSummaries] = await Promise.all([
        supabase
          .from("projects")
          .select("id", { count: "exact", head: true })
          .eq("status", "active"),
        supabase
          .from("tasks")
          .select("id", { count: "exact", head: true })
          .lt("due_date", today)
          .neq("status", "done"),
        supabase
          .from("time_entries")
          .select("hours")
          .gte("date", monday),
        supabase
          .from("project_budget_summary")
          .select("budget_allocated, budget_spent"),
      ]);

      const hoursThisWeek = (weekHours.data ?? []).reduce(
        (sum, r) => sum + (r.hours ?? 0),
        0,
      );

      const summaries = budgetSummaries.data ?? [];
      const totalAllocated = summaries.reduce((s, r) => s + (r.budget_allocated ?? 0), 0);
      const totalSpent     = summaries.reduce((s, r) => s + (r.budget_spent ?? 0), 0);
      const burnPct        = totalAllocated > 0 ? (totalSpent / totalAllocated) * 100 : 0;

      return {
        activeProjects: activeProjects.count ?? 0,
        overdueTasks:   overdueTasks.count   ?? 0,
        hoursThisWeek:  Math.round(hoursThisWeek * 10) / 10,
        budgetBurnPct:  Math.round(burnPct),
      };
    },
  });
}

export function useDashboardActivity() {
  return useQuery({
    queryKey: ["hub_dashboard_activity"],
    queryFn:  async () => {
      const { data, error } = await supabase
        .from("activity_log")
        .select("*, contractors(id, name), projects(id, name)")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data as ActivityEntry[];
    },
  });
}

// ─────────────────────────────────────────────────────────────
// Overdue task count — with Realtime subscription
// Used by the sidebar badge
// ─────────────────────────────────────────────────────────────

export function useOverdueTaskCount() {
  const [count, setCount] = useState(0);
  const channelName = useRef(`hub_overdue_tasks_${Math.random().toString(36).slice(2)}`);

  const fetchCount = async () => {
    const today = new Date().toISOString().split("T")[0];
    const { count: c } = await supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .lt("due_date", today)
      .neq("status", "done");
    setCount(c ?? 0);
  };

  useEffect(() => {
    fetchCount();

    const channel = supabase
      .channel(channelName.current)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tasks" },
        () => fetchCount(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return count;
}

// ─────────────────────────────────────────────────────────────
// Project stages (new_product type)
// ─────────────────────────────────────────────────────────────

export function useProjectStages(projectId: string | undefined) {
  return useQuery({
    queryKey: ["hub_project_stages", projectId],
    enabled:  !!projectId,
    queryFn:  async () => {
      const { data, error } = await supabase
        .from("project_stages")
        .select("*")
        .eq("project_id", projectId!)
        .order("position");
      if (error) throw error;
      return data as ProjectStage[];
    },
  });
}

export function useCreateProjectStages() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ projectId, stages }: { projectId: string; stages: Omit<ProjectStage, "id" | "created_at">[] }) => {
      const { data, error } = await supabase
        .from("project_stages")
        .insert(stages)
        .select();
      if (error) throw error;
      return data as ProjectStage[];
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["hub_project_stages", variables.projectId] });
    },
  });
}

export function useUpdateProjectStage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, project_id, ...updates }: Partial<ProjectStage> & { id: string; project_id: string }) => {
      const { data, error } = await supabase
        .from("project_stages")
        .update(updates)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data as ProjectStage;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["hub_project_stages", data.project_id] });
      qc.invalidateQueries({ queryKey: ["hub_active_stages"] });
    },
  });
}

// Fetch the currently-active stage for every project (used by the dashboard stage filter)
export function useActiveStages() {
  return useQuery({
    queryKey: ["hub_active_stages"],
    queryFn:  async () => {
      const { data, error } = await supabase
        .from("project_stages")
        .select("*")
        .eq("is_active", true);
      if (error) throw error;
      return data as ProjectStage[];
    },
  });
}

// ─────────────────────────────────────────────────────────────
// AI chat history
// ─────────────────────────────────────────────────────────────

export function useAiChatMessages(userId: string | undefined) {
  return useQuery({
    queryKey: ["hub_ai_chat", userId],
    enabled:  !!userId,
    queryFn:  async () => {
      const { data, error } = await supabase
        .from("ai_chat_messages")
        .select("*")
        .eq("user_id", userId!)
        .order("created_at", { ascending: true })
        .limit(50);
      if (error) throw error;
      return data as AiChatMessage[];
    },
  });
}

export function useClearAiChat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase
        .from("ai_chat_messages")
        .delete()
        .eq("user_id", userId);
      if (error) throw error;
    },
    onSuccess: (_data, userId) => {
      qc.invalidateQueries({ queryKey: ["hub_ai_chat", userId] });
    },
  });
}

// ─────────────────────────────────────────────────────────────
// Contractor identity check
// Returns the contractors row for the logged-in contractor user
// (null for staff)
// ─────────────────────────────────────────────────────────────

export function useMyContractorProfile(userId: string | undefined) {
  return useQuery({
    queryKey: ["hub_my_contractor", userId],
    enabled:  !!userId,
    queryFn:  async () => {
      const { data, error } = await supabase
        .from("contractors")
        .select("*")
        .eq("user_id", userId!)
        .eq("can_login", true)
        .maybeSingle();
      if (error) throw error;
      return data as Contractor | null;
    },
  });
}

// ─────────────────────────────────────────────────────────────
// Command palette search
// ─────────────────────────────────────────────────────────────

export function useHubSearch(query: string) {
  return useQuery({
    queryKey: ["hub_search", query],
    enabled:  query.length >= 2,
    queryFn:  async () => {
      const q = `%${query}%`;

      const [contractors, projects, tasks] = await Promise.all([
        supabase
          .from("contractors")
          .select("id, name, role")
          .ilike("name", q)
          .limit(5),
        supabase
          .from("projects")
          .select("id, name, status, type")
          .ilike("name", q)
          .limit(5),
        supabase
          .from("tasks")
          .select("id, title, status, project_id, projects(name)")
          .ilike("title", q)
          .limit(5),
      ]);

      return {
        contractors: contractors.data ?? [],
        projects:    projects.data    ?? [],
        tasks:       tasks.data       ?? [],
      };
    },
  });
}
