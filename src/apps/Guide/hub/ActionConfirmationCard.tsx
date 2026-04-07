import { CheckCircle2, AlertCircle } from "lucide-react";
import { cn } from "@guide/lib/utils";
import { useNavigate } from "react-router-dom";

export interface ToolResult {
  tool:   string;
  input:  Record<string, unknown>;
  result: Record<string, unknown>;
}

interface ActionConfirmationCardProps {
  toolResult: ToolResult;
  className?: string;
}

function formatTitle(tool: string): string {
  const map: Record<string, string> = {
    create_task:        "Task created",
    update_task:        "Task updated",
    log_time:           "Time logged",
    post_activity:      "Note posted",
    update_project:     "Project updated",
    create_project:     "Project created",
    update_contractor:  "Contractor updated",
  };
  return map[tool] ?? tool.replace(/_/g, " ");
}

function getCardDetails(
  tool: string,
  input: Record<string, unknown>,
  result: Record<string, unknown>,
): { lines: string[]; linkTo?: string } {
  const isError = !!(result as any).error;
  if (isError) return { lines: [(result as any).error as string] };

  switch (tool) {
    case "create_task": {
      const task = (result as any).task ?? {};
      const lines = [task.title ?? (input.title as string) ?? ""];
      if (input.priority) lines.push(`${(input.priority as string)} priority`);
      if (input.due_date) lines.push(`Due ${input.due_date}`);
      return {
        lines,
        linkTo: task.project_id ? `/hub/projects/${task.project_id}` : undefined,
      };
    }
    case "update_task": {
      const task = (result as any).task ?? {};
      const changes = Object.entries(input)
        .filter(([k]) => k !== "task_id")
        .map(([k, v]) => `${k.replace(/_/g, " ")} → ${v}`)
        .slice(0, 3);
      return {
        lines: [task.title ?? "", ...changes],
        linkTo: task.project_id ? `/hub/projects/${task.project_id}` : undefined,
      };
    }
    case "log_time": {
      const hours = input.hours as number;
      const cost  = (result as any).cost;
      const lines = [`${hours} hrs`];
      if (cost != null) lines[0] += ` · $${Number(cost).toFixed(0)}`;
      if (input.date) lines.push(`${input.date}`);
      return {
        lines,
        linkTo: input.project_id ? `/hub/projects/${input.project_id as string}` : undefined,
      };
    }
    case "post_activity":
      return {
        lines: [(input.content as string)?.substring(0, 80) ?? ""],
        linkTo: input.project_id ? `/hub/projects/${input.project_id as string}` : undefined,
      };
    case "create_project": {
      const project = (result as any).project ?? {};
      const lines   = [project.name ?? (input.name as string) ?? ""];
      if (input.type)             lines.push(input.type as string);
      if (input.budget_allocated) lines.push(`$${Number(input.budget_allocated).toLocaleString()}`);
      if (input.start_date)       lines.push(`Starts ${input.start_date}`);
      return {
        lines,
        linkTo: project.id ? `/hub/projects/${project.id}` : undefined,
      };
    }
    case "update_project": {
      const project = (result as any).project ?? {};
      const changes = Object.entries(input)
        .filter(([k]) => k !== "project_id")
        .map(([k, v]) => `${k.replace(/_/g, " ")} → ${v}`)
        .slice(0, 3);
      return {
        lines: [project.name ?? "", ...changes],
        linkTo: project.id ? `/hub/projects/${project.id}` : undefined,
      };
    }
    case "update_contractor": {
      const contractor = (result as any).contractor ?? {};
      const changes    = Object.entries(input)
        .filter(([k]) => k !== "contractor_id")
        .map(([k, v]) => `${k.replace(/_/g, " ")} → ${v}`)
        .slice(0, 3);
      return {
        lines: [contractor.name ?? "", ...changes],
        linkTo: contractor.id ? `/hub/contractors/${contractor.id}` : undefined,
      };
    }
    default:
      return { lines: [] };
  }
}

export function ActionConfirmationCard({
  toolResult,
  className,
}: ActionConfirmationCardProps) {
  const navigate   = useNavigate();
  const isError    = !!(toolResult.result as any).error;
  const title      = formatTitle(toolResult.tool);
  const { lines, linkTo } = getCardDetails(toolResult.tool, toolResult.input, toolResult.result);

  return (
    <button
      onClick={() => linkTo && navigate(linkTo)}
      className={cn(
        "w-full text-left rounded-lg border px-3 py-2.5 text-sm transition-colors",
        isError
          ? "border-red-800/50 bg-red-900/20 text-red-300"
          : "border-border/60 bg-muted/40 hover:bg-muted/60",
        linkTo && "cursor-pointer",
        !linkTo && "cursor-default",
        className,
      )}
    >
      <div className="flex items-center gap-2 mb-1">
        {isError
          ? <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
          : <CheckCircle2 className="w-3.5 h-3.5 text-green-400 shrink-0" />
        }
        <span className={cn("font-medium text-xs", isError ? "text-red-300" : "text-foreground")}>
          {title}
        </span>
      </div>
      {lines.filter(Boolean).map((line, i) => (
        <p key={i} className="text-xs text-muted-foreground leading-snug pl-5">
          {line}
        </p>
      ))}
    </button>
  );
}
