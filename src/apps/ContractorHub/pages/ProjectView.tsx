import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  Loader2, ChevronRight, Plus, Upload, Paperclip, Clock,
  GripVertical, Trash2,
} from "lucide-react";
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
import { TaskDrawer } from "@hub/components/TaskDrawer";
import { LogTimeForm } from "@hub/components/LogTimeForm";
import { cn } from "@guide/lib/utils";
import {
  useProject, useTasks, useProjectBudgetSummary, useActivityLog,
  useFiles, useContractors, useProjectContractors, useTimeEntries,
  useUpdateProject, useCreateTask, useUpdateTask, useReorderTasks,
  usePostActivity, useUploadFile,
  type Task, type TaskStatus, type TaskPriority, type ProjectStatus,
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

  // ── Mutations ─────────────────────────────────────────────
  const { mutateAsync: updateProject }  = useUpdateProject();
  const { mutateAsync: createTask }     = useCreateTask();
  const { mutateAsync: updateTask }     = useUpdateTask();
  const { mutateAsync: reorderTasks }   = useReorderTasks();
  const { mutateAsync: postActivity }   = usePostActivity();
  const { mutateAsync: uploadFile }     = useUploadFile();

  // ── Local state ───────────────────────────────────────────
  const [selectedTask,    setSelectedTask]    = useState<Task | null>(null);
  const [drawerOpen,      setDrawerOpen]      = useState(false);
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

  const fileInputRef       = useRef<HTMLInputElement>(null);
  const newTaskInputRef    = useRef<HTMLInputElement>(null);
  const activityEndRef     = useRef<HTMLDivElement>(null);
  const prevBudgetPctRef   = useRef<number | null>(null);

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

  async function handleStatusChange(status: ProjectStatus) {
    if (!project || !user) return;
    try {
      await updateProject({ id: project.id, status });
      await postActivity({
        project_id:  project.id,
        type:        "status_change",
        content:     `${authorName} moved project to ${status.replace("_", " ")}`,
        author_id:   user.id,
        author_name: authorName,
        metadata:    { from: project.status, to: status },
      });
      sendNotification({ type: "task_status_changed", task_title: project.name, status, author: authorName, project_name: project.name, project_id: project.id });
    } catch { toast.error("Failed to update status"); }
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
      await postActivity({
        project_id:  id,
        type:        "note",
        content:     activityInput.trim(),
        author_id:   user.id,
        author_name: authorName,
        metadata:    sendToUpwork ? { send_to_upwork: true } : null,
      });
      if (sendToUpwork) {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/upwork-outbound-message`,
          { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}`, apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
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
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}`, apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
        body: JSON.stringify(payload),
      }).catch(() => {});
    });
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
        <Link to="/hub/projects" className="hover:text-foreground transition-colors">Projects</Link>
        <ChevronRight className="w-3.5 h-3.5" />
        <span className="text-foreground">{project.name}</span>
      </nav>

      {/* ── Project Header ── */}
      <div className="rounded-lg border bg-background p-5 space-y-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
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

          <div className="flex items-center gap-2 flex-wrap shrink-0">
            {/* Status dropdown */}
            <Select value={project.status} onValueChange={(v) => handleStatusChange(v as ProjectStatus)}>
              <SelectTrigger className="h-8 w-fit border-0 bg-transparent p-0 focus:ring-0 shadow-none">
                <StatusPill status={project.status} />
              </SelectTrigger>
              <SelectContent>
                {(["planning", "active", "on_hold", "complete"] as ProjectStatus[]).map(s => (
                  <SelectItem key={s} value={s}>{s.replace("_", " ").replace(/\b\w/g, c => c.toUpperCase())}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <span className="text-[11px] font-medium px-2 py-0.5 rounded bg-muted text-muted-foreground">
              {project.type}
            </span>

            <Button size="sm" variant="outline" onClick={() => setLogTimeOpen(v => !v)}>
              <Clock className="w-3.5 h-3.5 mr-1.5" />
              Log Time
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

      {/* ── Tasks ── */}
      <div className="rounded-lg border bg-background overflow-hidden">
        <div className="px-5 py-3 border-b bg-muted/30 flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-sm font-semibold shrink-0">Tasks</h2>
          {/* Filter pills */}
          <div className="flex gap-1.5 flex-wrap">
            {(["all", "backlog", "in_progress", "review", "done"] as const).map(f => (
              <button
                key={f}
                onClick={() => setTaskFilter(f)}
                className={cn(
                  "px-2.5 py-0.5 rounded-full text-xs font-medium transition-colors",
                  taskFilter === f
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:text-foreground",
                )}
              >
                {f === "all" ? "All" : f.replace("_", " ").replace(/\b\w/g, c => c.toUpperCase())}
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
                      "border-b hover:bg-muted/20 cursor-pointer transition-colors",
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
                      {task.due_date ?? "—"}
                    </td>
                  </tr>

                  {/* Subtasks */}
                  {subs.map(sub => {
                    const subOverdue = sub.due_date && sub.due_date < today && sub.status !== "done";
                    return (
                      <tr
                        key={sub.id}
                        onClick={() => { setSelectedTask(sub); setDrawerOpen(true); }}
                        className="border-b bg-muted/5 hover:bg-muted/20 cursor-pointer transition-colors"
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
                          {sub.due_date ?? "—"}
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

      {/* ── Files ── */}
      <div className="rounded-lg border bg-background overflow-hidden">
        <div className="px-5 py-3 border-b bg-muted/30">
          <h2 className="text-sm font-semibold">Files</h2>
        </div>
        <div className="p-5 space-y-3">
          {files.length > 0 && (
            <ul className="space-y-2 mb-4">
              {files.map(file => (
                <li key={file.id} className="flex items-center gap-3 text-sm">
                  <Paperclip className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <a href={file.file_url} target="_blank" rel="noopener noreferrer"
                     className="flex-1 truncate hover:text-primary transition-colors">
                    {file.filename}
                  </a>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {file.file_size > 1048576
                      ? `${(file.file_size / 1048576).toFixed(1)} MB`
                      : `${(file.file_size / 1024).toFixed(0)} KB`}
                  </span>
                  <span className="text-xs text-muted-foreground shrink-0">{file.created_at.split("T")[0]}</span>
                </li>
              ))}
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
      <div className="rounded-lg border bg-background p-5 space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Activity</h2>

        {/* Post form */}
        <div className="space-y-2">
          <Textarea
            value={activityInput}
            onChange={e => setActivityInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handlePostActivity(); }}
            placeholder="Add a note or update..."
            rows={2}
            className="resize-none"
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

        <div className="border-t pt-4">
          <ActivityFeed entries={activity} emptyText="No activity yet. Post a note to get started." />
        </div>
        <div ref={activityEndRef} />
      </div>

      {/* Task drawer */}
      <TaskDrawer
        task={selectedTask}
        open={drawerOpen}
        onClose={() => { setDrawerOpen(false); setSelectedTask(null); }}
      />
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
