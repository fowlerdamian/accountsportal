import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  Loader2, ChevronRight, Plus, Upload, Paperclip, Clock,
  GripVertical, Camera, Trash2, ExternalLink, Box, X,
} from "lucide-react";
import CadViewer, { canPreview3D } from "@hub/components/CadViewer";
import { PriorityScorecardModal } from "@hub/components/PriorityScorecardModal";
import { Button } from "@guide/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@guide/components/ui/select";
import { Textarea } from "@guide/components/ui/textarea";
import { toast } from "sonner";
import { supabase } from "@guide/integrations/supabase/client";
import { useAuth } from "@guide/contexts/AuthContext";
import { HubLayout, useHub } from "@hub/components/HubLayout";
import { StatsCard } from "@guide/components/admin/StatsCard";
import { StatusPill, TASK_STATUS_ORDER, nextTaskStatus } from "@hub/components/StatusPill";
import { PriorityPill } from "@hub/components/PriorityPill";
import { ContractorAvatar } from "@hub/components/ContractorAvatar";
import { ActivityFeed } from "@hub/components/ActivityFeed";
import { StagedActivityFeed } from "@hub/components/StagedActivityFeed";
import { TaskDrawer } from "@hub/components/TaskDrawer";
import { LogTimeForm } from "@hub/components/LogTimeForm";
import { ProductStagesView } from "@hub/components/ProductStagesView";
import { cn } from "@guide/lib/utils";
import {
  useProject, useTasks, useProjectBudgetSummary, useActivityLog,
  useFiles, useContractors, useProjectContractors, useTimeEntries,
  useUpdateProject, useCreateTask, useUpdateTask, useDeleteTask, useReorderTasks,
  usePostActivity, useUploadFile, useProjectStages, useCreateProjectStages,
  useUploadProjectThumbnail, useSoftDeleteProject, useSyncDriveFiles,
  useGenerateStepThumbnails,
  NEW_PRODUCT_STAGES,
  type Task, type TaskStatus, type TaskPriority,
} from "@hub/hooks/use-hub-queries";
import { notifyBudgetThreshold } from "@hub/lib/notifyHubChat";

// ── Inner content (needs HubContext) ─────────────────────────

function ProjectViewContent() {
  const { id }     = useParams<{ id: string }>();
  const navigate   = useNavigate();
  const qc         = useQueryClient();
  const { user }   = useAuth();
  const { isNewTaskOpen, closeNewTask } = useHub();

  const authorName = user?.user_metadata?.full_name ?? user?.email?.split("@")[0] ?? "Staff";

  // ── Data ──────────────────────────────────────────────────
  const { data: project,    isLoading: projLoading } = useProject(id);
  const { data: tasks = [],  isLoading: tasksLoading } = useTasks(id);
  const { data: budget }                              = useProjectBudgetSummary(id);
  const { data: activity = [] }                       = useActivityLog({ projectId: id });
  const { data: files = [] }                          = useFiles({ projectId: id });
  const { data: contractors = [] }                    = useContractors();
  const { data: projContractors = [] }                = useProjectContractors(id);
  const { data: timeEntries = [] }                    = useTimeEntries({ projectId: id });

  useSyncDriveFiles(id, project?.drive_folder_id);
  useGenerateStepThumbnails(files);

  // ── Mutations ─────────────────────────────────────────────
  const { mutateAsync: updateProject }         = useUpdateProject();
  const { mutateAsync: createProjectStages }   = useCreateProjectStages();
  const { data: existingStages = [] }          = useProjectStages(id);
  const { mutateAsync: uploadThumbnail }       = useUploadProjectThumbnail();
  const { mutateAsync: softDelete }            = useSoftDeleteProject();
  const { mutateAsync: createTask }            = useCreateTask();
  const { mutateAsync: updateTask }     = useUpdateTask();
  const { mutateAsync: deleteTask }     = useDeleteTask();
  const { mutateAsync: reorderTasks }   = useReorderTasks();
  const { mutateAsync: postActivity }   = usePostActivity();
  const { mutateAsync: uploadFile }     = useUploadFile();

  // ── Local state ───────────────────────────────────────────
  const [selectedTask,      setSelectedTask]      = useState<Task | null>(null);
  const [drawerOpen,        setDrawerOpen]        = useState(false);
  const [scorecardOpen,     setScorecardOpen]     = useState(false);
  const [taskFilter,      setTaskFilter]      = useState<TaskStatus | "all">("all");
  const [editingName,     setEditingName]     = useState(false);
  const [nameValue,       setNameValue]       = useState("");
  const [addingTask,      setAddingTask]      = useState(false);
  const [newTaskTitle,    setNewTaskTitle]    = useState("");
  const [newTaskAssignee, setNewTaskAssignee] = useState("");
  const [newTaskPriority, setNewTaskPriority] = useState<TaskPriority>("medium");
  const [newTaskDue,      setNewTaskDue]      = useState("");
  const [activityInput,   setActivityInput]   = useState("");
  const [sendToUpwork,    setSendToUpwork]    = useState(false);
  const [postingSaving,   setPostingSaving]   = useState(false);
  const [fileDragOver,    setFileDragOver]    = useState(false);
  const [draggedId,       setDraggedId]       = useState<string | null>(null);
  const [dragOverId,      setDragOverId]      = useState<string | null>(null);
  const [logTimeOpen,     setLogTimeOpen]     = useState(false);
  const [confirmDeleteTaskId, setConfirmDeleteTaskId] = useState<string | null>(null);
  const [cadPreview,      setCadPreview]      = useState<{ url: string; filename: string; displayName: string } | null>(null);
  const [imgPreview,      setImgPreview]      = useState<{ url: string; filename: string } | null>(null);
  const [drivePreview,    setDrivePreview]    = useState<{ id: string; filename: string } | null>(null);

  const fileInputRef        = useRef<HTMLInputElement>(null);
  const thumbInputRef       = useRef<HTMLInputElement>(null);
  const newTaskInputRef     = useRef<HTMLInputElement>(null);
  const activityEndRef      = useRef<HTMLDivElement>(null);
  const prevBudgetPctRef    = useRef<number | null>(null);

  // ── Budget threshold notifications ────────────────────────
  useEffect(() => {
    if (!budget?.budget_allocated || !project) return;
    const pct = Math.round((Number(budget.budget_spent) / Number(budget.budget_allocated)) * 100);
    const prev = prevBudgetPctRef.current;
    if (prev !== null) {
      if (prev < 100 && pct >= 100) {
        notifyBudgetThreshold({ project_name: project.name, project_id: project.id, pct: 100 });
      } else if (prev < 80 && pct >= 80) {
        notifyBudgetThreshold({ project_name: project.name, project_id: project.id, pct: 80 });
      }
    }
    prevBudgetPctRef.current = pct;
  }, [budget?.budget_spent]);

  // Hours this week
  const monday = (() => {
    const now = new Date(), day = now.getDay();
    const d = new Date(now);
    d.setDate(now.getDate() + (day === 0 ? -6 : 1 - day));
    return d.toISOString().split("T")[0];
  })();
  const hoursThisWeek = timeEntries.filter(e => e.date >= monday).reduce((s, e) => s + (e.hours ?? 0), 0);

  const hasUpwork = projContractors.some(c => (c as any).source === "upwork");

  // ── Realtime subscriptions ────────────────────────────────
  useEffect(() => {
    if (!id) return;
    const channel = supabase
      .channel(`hub_pv_${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks",        filter: `project_id=eq.${id}` },
          () => qc.invalidateQueries({ queryKey: ["hub_tasks", id] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "activity_log", filter: `project_id=eq.${id}` },
          () => qc.invalidateQueries({ queryKey: ["hub_activity", id] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "time_entries", filter: `project_id=eq.${id}` },
          () => {
            qc.invalidateQueries({ queryKey: ["hub_time_entries", id] });
            qc.invalidateQueries({ queryKey: ["hub_budget_summary", id] });
          })
      .on("postgres_changes", { event: "*", schema: "public", table: "files",        filter: `project_id=eq.${id}` },
          () => qc.invalidateQueries({ queryKey: ["hub_files", id] }))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [id]);

  // ── Respond to N shortcut from HubLayout ─────────────────
  useEffect(() => {
    if (isNewTaskOpen) {
      setAddingTask(true);
      closeNewTask();
      setTimeout(() => newTaskInputRef.current?.focus(), 50);
    }
  }, [isNewTaskOpen]);

  // ── Handlers ──────────────────────────────────────────────

  async function handleSaveName() {
    if (!project || !nameValue.trim() || nameValue === project.name) {
      setEditingName(false);
      return;
    }
    try {
      await updateProject({ id: project.id, name: nameValue.trim() });
      setEditingName(false);
    } catch { toast.error("Failed to save name"); }
  }

  async function handleTypeChange(newType: string) {
    if (!project) return;
    try {
      await updateProject({ id: project.id, type: newType as any });
      if (newType === "new_product" && existingStages.length === 0) {
        const today = new Date().toISOString().split("T")[0];
        await createProjectStages({
          projectId: project.id,
          stages: NEW_PRODUCT_STAGES.map((stageName, i) => ({
            project_id: project.id,
            name:       stageName,
            position:   i,
            start_date: i === 0 ? today : null,
            end_date:   null,
            is_active:  i === 0,
          })),
        });
      }
      toast.success("Project type updated");
    } catch { toast.error("Failed to update type"); }
  }

  async function handleStatusCycle(task: Task, e: React.MouseEvent) {
    e.stopPropagation();
    if (!user) return;
    const next = nextTaskStatus(task.status);
    try {
      await updateTask({ id: task.id, status: next });
      await postActivity({
        project_id:  task.project_id,
        task_id:     task.id,
        type:        "status_change",
        content:     `${authorName} moved "${task.title}" to ${next.replace("_", " ")}`,
        author_id:   user.id,
        author_name: authorName,
        metadata:    { from: task.status, to: next },
      });
      sendNotification({ type: "task_status_changed", task_title: task.title, status: next, author: authorName, project_name: project?.name ?? "", project_id: id ?? "" });
    } catch { toast.error("Failed to update status"); }
  }

  async function handleAddTask() {
    if (!newTaskTitle.trim()) { toast.error("Task title is required"); return; }
    if (!id) return;
    const parentTasks = tasks.filter(t => !t.parent_task_id);
    try {
      await createTask({
        project_id:  id,
        title:       newTaskTitle.trim(),
        assigned_to: newTaskAssignee || null,
        priority:    newTaskPriority,
        due_date:    newTaskDue || null,
        position:    parentTasks.length,
      });
      setNewTaskTitle(""); setNewTaskAssignee(""); setNewTaskPriority("medium"); setNewTaskDue("");
      setAddingTask(false);
      toast.success("Task added");
    } catch { toast.error("Failed to add task"); }
  }

  async function handlePostActivity() {
    if (!activityInput.trim() || !user || !id) return;
    setPostingSaving(true);
    try {
      const stageMeta = project?.type === "new_product" && activeStage
        ? { stage_name: activeStage.name }
        : {};
      await postActivity({
        project_id:  id,
        type:        "note",
        content:     activityInput.trim(),
        author_id:   user.id,
        author_name: authorName,
        metadata:    { ...stageMeta, ...(sendToUpwork ? { send_to_upwork: true } : {}) } || null,
      });
      if (sendToUpwork) {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/upwork-outbound-message`,
          { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}`, apikey: (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY) },
            body: JSON.stringify({ project_id: id, content: activityInput.trim() }) }
        ).catch(() => {});
      }
      sendNotification({ type: "activity_posted", author: authorName, project_name: project?.name ?? "", project_id: id ?? "", content: activityInput });
      setActivityInput(""); setSendToUpwork(false);
    } catch { toast.error("Failed to post note"); }
    finally { setPostingSaving(false); }
  }

  // ── Drag to reorder ───────────────────────────────────────

  function handleDragStart(e: React.DragEvent, taskId: string) {
    setDraggedId(taskId);
    e.dataTransfer.effectAllowed = "move";
  }

  function handleDragOver(e: React.DragEvent, taskId: string) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (taskId !== dragOverId) setDragOverId(taskId);
  }

  function handleDrop(e: React.DragEvent, targetId: string) {
    e.preventDefault();
    setDragOverId(null);
    if (!draggedId || draggedId === targetId) { setDraggedId(null); return; }
    const sorted = [...tasks.filter(t => !t.parent_task_id)].sort((a, b) => a.position - b.position);
    const from = sorted.findIndex(t => t.id === draggedId);
    const to   = sorted.findIndex(t => t.id === targetId);
    if (from === -1 || to === -1) { setDraggedId(null); return; }
    const reordered = [...sorted];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved);
    reorderTasks(reordered.map((t, i) => ({ id: t.id, position: i })));
    setDraggedId(null);
    toast.success("Tasks reordered");
  }

  // ── File upload ───────────────────────────────────────────

  async function uploadFiles(fileList: FileList | null) {
    if (!fileList || !user || !id) return;
    for (const file of Array.from(fileList)) {
      try {
        await uploadFile({ file, projectId: id, uploadedBy: user.id });
        await postActivity({
          project_id:  id,
          type:        "file",
          content:     `${authorName} uploaded ${file.name}`,
          author_id:   user.id,
          author_name: authorName,
          metadata:    { filename: file.name, size: file.size },
        });
        toast.success(`Uploaded ${file.name}`);
      } catch { toast.error(`Failed to upload ${file.name}`); }
    }
  }

  function handleFileDrop(e: React.DragEvent) {
    e.preventDefault();
    setFileDragOver(false);
    uploadFiles(e.dataTransfer.files);
  }

  function sendNotification(payload: Record<string, unknown>) {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) return;
      fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/contractor-hub-notifications`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}`, apikey: (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY) },
        body: JSON.stringify(payload),
      }).catch(() => {});
    });
  }

  // ── Active stage (for activity tagging) ──────────────────
  const activeStage = existingStages.find(s => s.is_active);

  async function handleThumbnailUpload(file: File | null) {
    if (!file || !id) return;
    try {
      await uploadThumbnail({ file, projectId: id });
      toast.success("Thumbnail updated");
    } catch { toast.error("Failed to upload thumbnail"); }
  }

  async function handleDelete() {
    if (!project) return;
    if (!window.confirm(`Move "${project.name}" to the recycle bin? It will be permanently deleted after 15 days.`)) return;
    try {
      await softDelete(project.id);
      toast.success("Project moved to recycle bin");
      navigate("/projects/list");
    } catch { toast.error("Failed to delete project"); }
  }

  // ── Task table rendering ──────────────────────────────────

  const today       = new Date().toISOString().split("T")[0];
  const parentTasks = [...tasks.filter(t => !t.parent_task_id)].sort((a, b) => a.position - b.position);
  const visibleParents = taskFilter === "all"
    ? parentTasks
    : parentTasks.filter(t => t.status === taskFilter);

  function subtasksOf(parentId: string) {
    return tasks.filter(t => t.parent_task_id === parentId).sort((a, b) => a.position - b.position);
  }

  const doneTasks  = tasks.filter(t => t.status === "done").length;
  const totalTasks = tasks.length;

  if (projLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!project) {
    return <div className="p-6 text-muted-foreground">Project not found.</div>;
  }

  return (
    <div className="space-y-6 animate-fade-in max-w-5xl pb-24">

      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Link to="/projects/list" className="hover:text-foreground transition-colors">Projects</Link>
        <ChevronRight className="w-3.5 h-3.5" />
        <span className="text-foreground">{project.name}</span>
      </nav>

      {/* ── Project Header ── */}
      <div className="rounded-lg border bg-background p-5 space-y-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            {/* Thumbnail mini-icon */}
            <div className="relative shrink-0 group">
              <button
                onClick={() => thumbInputRef.current?.click()}
                className="w-10 h-10 rounded-lg overflow-hidden border border-border/40 bg-muted flex items-center justify-center hover:border-primary/40 transition-colors"
                title="Upload project thumbnail"
              >
                {project.thumbnail_url ? (
                  <img
                    src={project.thumbnail_url}
                    alt="Project thumbnail"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <Camera className="w-4 h-4 text-muted-foreground/40" />
                )}
              </button>
              <div className="absolute inset-0 rounded-lg bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                <Camera className="w-3.5 h-3.5 text-white" />
              </div>
              <input
                ref={thumbInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={e => handleThumbnailUpload(e.target.files?.[0] ?? null)}
              />
            </div>

            <div className="flex-1 min-w-0">
              {editingName ? (
                <input
                  value={nameValue}
                  onChange={e => setNameValue(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") handleSaveName(); if (e.key === "Escape") setEditingName(false); }}
                  onBlur={handleSaveName}
                  className="text-2xl font-bold bg-transparent outline-none border-b border-primary/50 w-full"
                  autoFocus
                />
              ) : (
                <h1
                  className="text-2xl font-bold cursor-text hover:text-foreground/80 transition-colors"
                  onClick={() => { setNameValue(project.name); setEditingName(true); }}
                  title="Click to edit"
                >
                  {project.name}
                </h1>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap shrink-0">
            <Select value={project.type} onValueChange={handleTypeChange}>
              <SelectTrigger className="h-8 w-fit border-0 bg-transparent p-0 focus:ring-0 shadow-none">
                <span className="text-[11px] font-medium px-2 py-0.5 rounded bg-muted text-muted-foreground">
                  {{ web: "Web", new_product: "New Product", product: "Product", website: "Website", other: "Other" }[project.type] ?? project.type}
                </span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="new_product">New Product</SelectItem>
                <SelectItem value="web">Web</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>

            {/* Priority score */}
            <button
              onClick={() => setScorecardOpen(true)}
              title="Score project priority"
              className={cn(
                "text-[11px] font-bold px-2 py-1 rounded border transition-colors",
                project.priority_score != null
                  ? project.priority_score >= 8
                    ? "border-green-500/40 text-green-400 bg-green-500/10 hover:bg-green-500/20"
                    : project.priority_score >= 5
                    ? "border-amber-500/40 text-amber-400 bg-amber-500/10 hover:bg-amber-500/20"
                    : "border-red-500/40 text-red-400 bg-red-500/10 hover:bg-red-500/20"
                  : "border-border text-muted-foreground hover:bg-muted",
              )}
            >
              {project.priority_score != null ? `${project.priority_score}/10` : "Priority"}
            </button>
            <PriorityScorecardModal
              open={scorecardOpen}
              onClose={() => setScorecardOpen(false)}
              onComplete={async (score) => {
                setScorecardOpen(false);
                await updateProject({ id: project.id, priority_score: score });
              }}
            />

            {project.drive_folder_id && (
              <button
                title="Open project folder in Google Drive"
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
                onClick={async (e) => {
                  e.currentTarget.disabled = true;
                  try {
                    const { data } = await supabase.functions.invoke("google-drive", {
                      body: { action: "ensure_folder", project_id: project.id, project_name: project.name, folder_id: project.drive_folder_id },
                    });
                    const folderId = data?.folder_id ?? project.drive_folder_id;
                    if (data?.recreated) qc.invalidateQueries({ queryKey: ["hub_project", project.id] });
                    window.open(`https://drive.google.com/drive/folders/${folderId}`, "_blank");
                  } catch {
                    window.open(`https://drive.google.com/drive/folders/${project.drive_folder_id}`, "_blank");
                  } finally {
                    e.currentTarget.disabled = false;
                  }
                }}
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 87.3 78" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M6.6 66.85l3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8H0a15.92 15.92 0 003.3 6.65z" fill="#0066DA"/>
                  <path d="M43.65 25L29.9 1.2c-1.35.8-2.5 1.9-3.3 3.3L.95 50.2A15.86 15.86 0 000 56.9h27.5z" fill="#00AC47"/>
                  <path d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.6H59.8l5.85 11.05z" fill="#EA4335"/>
                  <path d="M43.65 25L57.4 1.2C56.05.4 54.5 0 52.9 0H34.4c-1.6 0-3.15.45-4.5 1.2z" fill="#00832D"/>
                  <path d="M59.8 56.9h27.5a16 16 0 00-1.2-6.7L62.05 7.55c-.8-1.4-1.95-2.5-3.3-3.3L45 25z" fill="#2684FC"/>
                  <path d="M27.5 56.9H0l13.75 23.8c1.35.8 2.9 1.2 4.5 1.2H69.05c1.6 0 3.15-.45 4.5-1.2L59.8 56.9z" fill="#FFBA00"/>
                </svg>
                Drive
              </button>
            )}

            <Button size="sm" variant="outline" onClick={() => setLogTimeOpen(v => !v)}>
              <Clock className="w-3.5 h-3.5 mr-1.5" />
              Log Time
            </Button>

            <Button size="sm" variant="ghost" onClick={handleDelete} className="text-muted-foreground hover:text-red-400 hover:bg-red-400/10">
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
          {project.start_date && <span>Start: {project.start_date}</span>}
          {project.due_date && (
            <span className={cn(project.due_date < today && project.status !== "complete" && "text-red-400")}>
              Due: {project.due_date}
            </span>
          )}
          {project.description && <p className="text-sm text-muted-foreground w-full">{project.description}</p>}
        </div>

        {logTimeOpen && (
          <LogTimeForm projectId={project.id} onClose={() => setLogTimeOpen(false)} />
        )}
      </div>

      {/* ── Budget summary ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatsCard
          title="Budget Remaining"
          value={
            budget?.budget_allocated != null
              ? `$${Number(budget.budget_remaining ?? 0).toLocaleString()}`
              : "No budget set"
          }
          subtitle={budget?.budget_allocated != null ? `of $${Number(budget.budget_allocated).toLocaleString()}` : undefined}
          className={cn(budget?.budget_remaining != null && budget.budget_remaining < 0 && "[&_p.text-2xl]:text-red-400")}
        />
        <StatsCard
          title="Hours Logged"
          value={Number(budget?.total_hours ?? 0).toFixed(1)}
          subtitle={`${hoursThisWeek.toFixed(1)} hrs this week`}
          icon={<Clock className="w-5 h-5" />}
        />
        <StatsCard
          title="Tasks"
          value={`${doneTasks} / ${totalTasks}`}
          subtitle={tasksLoading ? "Loading…" : `${totalTasks - doneTasks} remaining`}
        />
      </div>

      {/* ── Stages (new_product) or Tasks (web / other) ── */}
      {project.type === "new_product" ? (
        <ProductStagesView projectId={project.id} />
      ) : null}

      {project.type !== "new_product" && (
      <div className="rounded-lg border bg-background overflow-hidden">
        <div className="px-5 py-3 border-b bg-muted/30 flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-sm font-semibold shrink-0">Tasks</h2>
          {/* Filter pills */}
          <div className="flex gap-1.5 flex-wrap">
            {([
              { key: "all",         label: "All" },
              { key: "backlog",     label: "To Do" },
              { key: "in_progress", label: "In Progress" },
              { key: "review",      label: "Stuck" },
              { key: "done",        label: "Complete" },
            ] as const).map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setTaskFilter(key)}
                className={cn(
                  "px-2.5 py-0.5 rounded-full text-xs font-medium transition-colors",
                  taskFilter === key
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            onClick={() => { setAddingTask(true); setTimeout(() => newTaskInputRef.current?.focus(), 50); }}
            className="text-xs text-primary hover:underline flex items-center gap-1 ml-auto"
          >
            <Plus className="w-3.5 h-3.5" />New task <kbd className="opacity-50 font-mono">[N]</kbd>
          </button>
        </div>

        <table className="w-full">
          <thead>
            <tr className="border-b">
              <th className="text-left p-3 text-xs font-semibold text-muted-foreground uppercase w-6"></th>
              <th className="text-left p-3 text-xs font-semibold text-muted-foreground uppercase">Title</th>
              <th className="text-left p-3 text-xs font-semibold text-muted-foreground uppercase hidden sm:table-cell">Status</th>
              <th className="text-left p-3 text-xs font-semibold text-muted-foreground uppercase hidden md:table-cell">Priority</th>
              <th className="text-left p-3 text-xs font-semibold text-muted-foreground uppercase hidden md:table-cell">Assignee</th>
              <th className="text-right p-3 text-xs font-semibold text-muted-foreground uppercase hidden sm:table-cell">Due</th>
            </tr>
          </thead>
          <tbody>
            {visibleParents.map(task => {
              const subs     = subtasksOf(task.id);
              const isOverdue = task.due_date && task.due_date < today && task.status !== "done";
              const isDragOver = dragOverId === task.id && draggedId !== task.id;

              return (
                <>
                  <tr
                    key={task.id}
                    draggable
                    onDragStart={e => handleDragStart(e, task.id)}
                    onDragOver={e => handleDragOver(e, task.id)}
                    onDragLeave={() => setDragOverId(null)}
                    onDrop={e => handleDrop(e, task.id)}
                    onDragEnd={() => { setDraggedId(null); setDragOverId(null); }}
                    onClick={() => { setSelectedTask(task); setDrawerOpen(true); }}
                    className={cn(
                      "group border-b hover:bg-muted/20 cursor-pointer transition-colors",
                      draggedId === task.id && "opacity-40",
                      isDragOver && "border-t-2 border-t-primary",
                    )}
                  >
                    <td className="p-3 text-muted-foreground/30 hover:text-muted-foreground cursor-grab active:cursor-grabbing" onClick={e => e.stopPropagation()}>
                      <GripVertical className="w-3.5 h-3.5" />
                    </td>
                    <td className="p-3">
                      <span className="text-sm">{task.title}</span>
                      {subs.length > 0 && (
                        <span className="ml-2 text-[10px] text-muted-foreground">({subs.length} subtask{subs.length !== 1 ? "s" : ""})</span>
                      )}
                    </td>
                    <td className="p-3 hidden sm:table-cell" onClick={e => { e.stopPropagation(); handleStatusCycle(task, e); }}>
                      <StatusPill status={task.status} size="sm" className="cursor-pointer hover:opacity-80" />
                    </td>
                    <td className="p-3 hidden md:table-cell"><PriorityPill priority={task.priority} size="sm" /></td>
                    <td className="p-3 hidden md:table-cell">
                      {task.contractors && (
                        <div className="flex items-center gap-1.5">
                          <ContractorAvatar name={task.contractors.name} size="xs" />
                          <span className="text-xs text-muted-foreground">{task.contractors.name}</span>
                        </div>
                      )}
                    </td>
                    <td className={cn("p-3 text-right text-xs hidden sm:table-cell", isOverdue ? "text-red-400" : "text-muted-foreground")}>
                      <div className="flex items-center justify-end gap-2">
                        <span>{task.due_date ?? "—"}</span>
                        {confirmDeleteTaskId === task.id ? (
                          <span className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                            <button
                              className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30"
                              onClick={async (e) => {
                                e.stopPropagation();
                                try {
                                  await deleteTask({ id: task.id, project_id: task.project_id });
                                  toast.success("Task deleted");
                                } catch { toast.error("Failed to delete"); }
                                setConfirmDeleteTaskId(null);
                              }}
                            >Delete</button>
                            <button
                              className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground hover:bg-muted/70"
                              onClick={e => { e.stopPropagation(); setConfirmDeleteTaskId(null); }}
                            >Cancel</button>
                          </span>
                        ) : (
                          <button
                            title="Delete task"
                            className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-400 transition-opacity"
                            onClick={e => { e.stopPropagation(); setConfirmDeleteTaskId(task.id); }}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>

                  {/* Subtasks */}
                  {subs.map(sub => {
                    const subOverdue = sub.due_date && sub.due_date < today && sub.status !== "done";
                    return (
                      <tr
                        key={sub.id}
                        onClick={() => { setSelectedTask(sub); setDrawerOpen(true); }}
                        className="group border-b bg-muted/5 hover:bg-muted/20 cursor-pointer transition-colors"
                      >
                        <td className="p-3"></td>
                        <td className="p-3 pl-6">
                          <span className="text-muted-foreground mr-1 text-xs">↳</span>
                          <span className="text-xs text-muted-foreground">{sub.title}</span>
                        </td>
                        <td className="p-3 hidden sm:table-cell" onClick={e => { e.stopPropagation(); handleStatusCycle(sub, e); }}>
                          <StatusPill status={sub.status} size="sm" className="cursor-pointer hover:opacity-80" />
                        </td>
                        <td className="p-3 hidden md:table-cell"><PriorityPill priority={sub.priority} size="sm" /></td>
                        <td className="p-3 hidden md:table-cell">
                          {sub.contractors && (
                            <div className="flex items-center gap-1.5">
                              <ContractorAvatar name={sub.contractors.name} size="xs" />
                            </div>
                          )}
                        </td>
                        <td className={cn("p-3 text-right text-xs hidden sm:table-cell", subOverdue ? "text-red-400" : "text-muted-foreground")}>
                          <div className="flex items-center justify-end gap-2">
                            <span>{sub.due_date ?? "—"}</span>
                            {confirmDeleteTaskId === sub.id ? (
                              <span className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                                <button
                                  className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30"
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    try {
                                      await deleteTask({ id: sub.id, project_id: sub.project_id });
                                      toast.success("Task deleted");
                                    } catch { toast.error("Failed to delete"); }
                                    setConfirmDeleteTaskId(null);
                                  }}
                                >Delete</button>
                                <button
                                  className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground hover:bg-muted/70"
                                  onClick={e => { e.stopPropagation(); setConfirmDeleteTaskId(null); }}
                                >Cancel</button>
                              </span>
                            ) : (
                              <button
                                title="Delete task"
                                className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-400 transition-opacity"
                                onClick={e => { e.stopPropagation(); setConfirmDeleteTaskId(sub.id); }}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </>
              );
            })}

            {/* Inline add task row */}
            {addingTask && (
              <tr className="border-b bg-muted/20">
                <td className="p-3"></td>
                <td className="p-3">
                  <input
                    ref={newTaskInputRef}
                    value={newTaskTitle}
                    onChange={e => setNewTaskTitle(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") handleAddTask(); if (e.key === "Escape") { setAddingTask(false); setNewTaskTitle(""); } }}
                    placeholder="Task title..."
                    className="w-full bg-transparent outline-none text-sm placeholder:text-muted-foreground/50"
                  />
                </td>
                <td className="p-3">
                  <Select value={newTaskPriority} onValueChange={v => setNewTaskPriority(v as TaskPriority)}>
                    <SelectTrigger className="h-7 text-xs w-28"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="urgent">Urgent</SelectItem>
                    </SelectContent>
                  </Select>
                </td>
                <td className="p-3">
                  <Select value={newTaskAssignee} onValueChange={setNewTaskAssignee}>
                    <SelectTrigger className="h-7 text-xs w-36"><SelectValue placeholder="Assign..." /></SelectTrigger>
                    <SelectContent>
                      {contractors.filter(c => c.status === "active").map(c => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </td>
                <td className="p-3">
                  <input
                    type="date"
                    value={newTaskDue}
                    onChange={e => setNewTaskDue(e.target.value)}
                    className="bg-transparent text-xs outline-none text-muted-foreground"
                  />
                </td>
                <td className="p-3 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button size="sm" onClick={handleAddTask} disabled={!newTaskTitle.trim()} className="h-7 text-xs">Add</Button>
                    <Button size="sm" variant="ghost" onClick={() => { setAddingTask(false); setNewTaskTitle(""); }} className="h-7 text-xs">Cancel</Button>
                  </div>
                </td>
              </tr>
            )}

            {!addingTask && visibleParents.length === 0 && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-muted-foreground text-sm">
                  {taskFilter === "all"
                    ? <span>No tasks yet. <button className="text-primary hover:underline" onClick={() => setAddingTask(true)}>Add the first task</button></span>
                    : "No tasks match this filter."
                  }
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {!addingTask && (
          <div className="px-5 py-2 border-t">
            <button
              onClick={() => { setAddingTask(true); setTimeout(() => newTaskInputRef.current?.focus(), 50); }}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
            >
              <Plus className="w-3 h-3" /> Add task
            </button>
          </div>
        )}
      </div>
      )}

      {/* ── Files ── */}
      <div className="rounded-lg border bg-background overflow-hidden">
        <div className="px-5 py-3 border-b bg-muted/30">
          <h2 className="text-sm font-semibold">Files</h2>
        </div>
        <div className="p-5 space-y-3">
          {files.length > 0 && (
            <ul className="space-y-2 mb-4">
              {files.map(file => {
                const ext      = file.filename.split(".").pop()?.toLowerCase() ?? "";
                const is3D     = canPreview3D(file.filename);
                const isImage  = ["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"].includes(ext);
                const previewable = is3D || isImage || !!file.thumbnail_url;

                function handleClick(e: React.MouseEvent) {
                  e.preventDefault();
                  if (is3D) {
                    setCadPreview({ url: file.file_url, filename: file.filename, displayName: file.filename });
                  } else if (isImage) {
                    setImgPreview({ url: file.file_url, filename: file.filename });
                  } else if (file.drive_file_id) {
                    setDrivePreview({ id: file.drive_file_id, filename: file.filename });
                  } else if (file.thumbnail_url) {
                    setImgPreview({ url: file.thumbnail_url, filename: file.filename });
                  } else {
                    window.open(file.file_url, "_blank");
                  }
                }

                const onThumbClick = () => {
                  if (is3D) {
                    setCadPreview({ url: file.file_url, filename: file.filename, displayName: file.filename });
                  } else if (file.thumbnail_url) {
                    setImgPreview({ url: file.thumbnail_url, filename: file.filename });
                  }
                };

                return (
                  <li key={file.id} className="flex items-center gap-3 text-sm">
                    {file.thumbnail_url ? (
                      <button
                        onClick={onThumbClick}
                        className="shrink-0 w-9 h-9 rounded overflow-hidden border border-border/40 bg-muted hover:border-primary/40 transition-colors"
                        title={is3D ? "Open 3D preview" : "Preview thumbnail"}
                      >
                        <img src={file.thumbnail_url} alt="" className="w-full h-full object-cover" />
                      </button>
                    ) : file.source === "drive" ? (
                      <ExternalLink className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                    ) : (
                      <Paperclip className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    )}
                    <a
                      href={file.file_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={handleClick}
                      className="flex-1 truncate hover:text-primary transition-colors"
                    >
                      {file.filename}
                    </a>
                    {is3D && (
                      <button
                        onClick={() => setCadPreview({ url: file.file_url, filename: file.filename, displayName: file.filename })}
                        title="3D preview"
                        className="shrink-0 text-muted-foreground hover:text-primary transition-colors"
                      >
                        <Box className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {file.file_size != null && (
                      <span className="text-xs text-muted-foreground shrink-0">
                        {file.file_size > 1048576
                          ? `${(file.file_size / 1048576).toFixed(1)} MB`
                          : `${(file.file_size / 1024).toFixed(0)} KB`}
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground shrink-0">{file.created_at.split("T")[0]}</span>
                    {file.drive_file_id && (
                      <a
                        href={`https://drive.google.com/file/d/${file.drive_file_id}/view`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Open in Google Drive"
                        className="shrink-0 text-muted-foreground hover:text-primary transition-colors"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {/* Drop zone */}
          <div
            onDragOver={e => { e.preventDefault(); setFileDragOver(true); }}
            onDragLeave={() => setFileDragOver(false)}
            onDrop={handleFileDrop}
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              "border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors",
              fileDragOver ? "border-primary bg-primary/5" : "border-border/40 hover:border-border",
            )}
          >
            <Upload className="w-5 h-5 mx-auto mb-2 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Drop files here or click to upload</p>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={e => uploadFiles(e.target.files)}
            />
          </div>
        </div>
      </div>

      {/* ── Activity feed ── */}
      <div className="rounded-lg border bg-background overflow-hidden">
        <div className="px-5 py-3 border-b bg-muted/20 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Activity</h2>
          {project.type === "new_product" && activeStage && (
            <span className="text-[11px] text-muted-foreground/60">
              Notes tagged to current stage: <span className="font-semibold text-foreground/60">{activeStage.name}</span>
            </span>
          )}
        </div>

        {/* Feed */}
        <div className="px-5 py-2 max-h-[480px] overflow-y-auto">
          {project.type === "new_product" ? (
            <StagedActivityFeed
              entries={activity}
              emptyText="No activity yet. Post a note below to get started."
            />
          ) : (
            <ActivityFeed entries={activity} emptyText="No activity yet. Post a note below to get started." />
          )}
          <div ref={activityEndRef} />
        </div>

        {/* Post form — below the feed */}
        <div className="border-t px-5 py-4 space-y-2 bg-muted/10">
          <Textarea
            value={activityInput}
            onChange={e => setActivityInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handlePostActivity(); }}
            placeholder="Add a note or update… (Ctrl+Enter to post)"
            rows={2}
            className="resize-none bg-background"
          />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              {hasUpwork && (
                <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={sendToUpwork}
                    onChange={e => setSendToUpwork(e.target.checked)}
                    className="rounded"
                  />
                  Send to Upwork
                </label>
              )}
            </div>
            <Button size="sm" onClick={handlePostActivity} disabled={!activityInput.trim() || postingSaving}>
              {postingSaving && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
              Post
            </Button>
          </div>
        </div>
      </div>

      {/* Task drawer */}
      <TaskDrawer
        task={selectedTask}
        open={drawerOpen}
        onClose={() => { setDrawerOpen(false); setSelectedTask(null); }}
      />

      {/* 3D CAD preview */}
      {cadPreview && (
        <CadViewer
          fileUrl={cadPreview.url}
          filename={cadPreview.filename}
          displayName={cadPreview.displayName}
          onClose={() => setCadPreview(null)}
        />
      )}

      {/* Google Drive embedded preview (works for SLDPRT, PDF, images, etc.) */}
      {drivePreview && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }}
          onClick={() => setDrivePreview(null)}
        >
          <div
            style={{ background: "#0a0a0a", border: "1px solid #222", borderRadius: 12, width: "100%", maxWidth: 960, height: "85vh", overflow: "hidden", display: "flex", flexDirection: "column" }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: "1px solid #1e1e1e" }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: "#fff", fontFamily: '"JetBrains Mono", monospace', overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {drivePreview.filename}
              </span>
              <div style={{ display: "flex", gap: 8 }}>
                <a
                  href={`https://drive.google.com/file/d/${drivePreview.id}/view`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ background: "none", border: "1px solid #333", borderRadius: 6, color: "#888", padding: "5px 10px", fontSize: 12, textDecoration: "none" }}
                >
                  Open in Drive
                </a>
                <button onClick={() => setDrivePreview(null)} style={{ background: "none", border: "none", color: "#666", cursor: "pointer", padding: 4 }}>
                  <X size={18} />
                </button>
              </div>
            </div>
            <iframe
              src={`https://drive.google.com/file/d/${drivePreview.id}/preview`}
              style={{ flex: 1, width: "100%", border: "none", background: "#111" }}
              allow="autoplay"
            />
          </div>
        </div>
      )}

      {/* Image / thumbnail lightbox */}
      {imgPreview && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }}
          onClick={() => setImgPreview(null)}
        >
          <button
            onClick={() => setImgPreview(null)}
            style={{ position: "absolute", top: 16, right: 16, background: "none", border: "none", color: "#fff", cursor: "pointer", padding: 6 }}
          >
            <X size={22} />
          </button>
          <img
            src={imgPreview.url}
            alt={imgPreview.filename}
            onClick={e => e.stopPropagation()}
            style={{ maxWidth: "92vw", maxHeight: "88vh", objectFit: "contain", borderRadius: 8, boxShadow: "0 4px 32px rgba(0,0,0,0.6)" }}
          />
        </div>
      )}

    </div>
  );
}

// ── Page wrapper ──────────────────────────────────────────────

export default function ProjectView() {
  return (
    <HubLayout>
      <ProjectViewContent />
    </HubLayout>
  );
}
