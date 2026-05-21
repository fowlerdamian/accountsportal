import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { FilterPill } from "@portal/components/FilterPill";
import { useAuth } from "../../../context/AuthContext.jsx";
import { useStaffTasks, useStaffProfiles } from "../hooks/use-task-queries";
import { KanbanBoard } from "../components/KanbanBoard";
import { useTasksUi } from "../components/TasksLayout";

type Scope = "mine" | "involving_me" | "all";

export function TasksKanban() {
  const { user } = useAuth();
  const userId   = user?.id ?? "";
  const { openDrawer } = useTasksUi();

  const [scope, setScope] = useState<Scope>("mine");

  const params = scope === "mine" ? { assignedTo: userId }
              : scope === "involving_me" ? { involving: userId }
              : {};

  const { data: tasks = [], isLoading } = useStaffTasks(params);
  const { data: profiles = [] }         = useStaffProfiles();

  const sorted = useMemo(
    () => [...tasks].sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999")),
    [tasks],
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <FilterPill active={scope === "mine"} onClick={() => setScope("mine")}>Mine</FilterPill>
        <FilterPill active={scope === "involving_me"} onClick={() => setScope("involving_me")}>Involving me</FilterPill>
        <FilterPill active={scope === "all"} onClick={() => setScope("all")}>Everyone</FilterPill>
        <span className="ml-auto text-[11px] text-muted-foreground">Drag cards between columns to change status.</span>
      </div>

      <KanbanBoard
        tasks={sorted}
        profiles={profiles}
        myId={userId}
        onOpenTask={openDrawer}
      />
    </div>
  );
}
