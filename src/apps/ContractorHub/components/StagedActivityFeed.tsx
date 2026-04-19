import { MessageSquare, RefreshCw, CornerDownRight, Paperclip, Clock, ExternalLink } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@guide/lib/utils";
import { ContractorAvatar } from "./ContractorAvatar";
import { NEW_PRODUCT_STAGES } from "@hub/hooks/use-hub-queries";
import type { ActivityEntry, ActivityType } from "@hub/hooks/use-hub-queries";

const TYPE_CONFIG: Record<ActivityType, { icon: typeof MessageSquare; badgeClass: string; badge: string }> = {
  note:           { icon: MessageSquare,   badge: "note",    badgeClass: "bg-muted text-muted-foreground" },
  update:         { icon: RefreshCw,       badge: "update",  badgeClass: "bg-blue-900/40 text-blue-300" },
  status_change:  { icon: CornerDownRight, badge: "",        badgeClass: "" },
  file:           { icon: Paperclip,       badge: "file",    badgeClass: "bg-muted text-muted-foreground" },
  time_log:       { icon: Clock,           badge: "time",    badgeClass: "bg-muted text-muted-foreground" },
  upwork_message: { icon: ExternalLink,    badge: "upwork",  badgeClass: "bg-blue-900/40 text-blue-300" },
};

const STAGE_DOT: Record<string, string> = {
  Idea:      "bg-violet-400",
  Sketch:    "bg-blue-400",
  CAD:       "bg-cyan-400",
  Prototype: "bg-amber-400",
  Complete:  "bg-green-400",
};

const STAGE_LABEL: Record<string, string> = {
  Idea:      "text-violet-400",
  Sketch:    "text-blue-400",
  CAD:       "text-cyan-400",
  Prototype: "text-amber-400",
  Complete:  "text-green-400",
};

function EntryRow({ entry }: { entry: ActivityEntry }) {
  const cfg  = TYPE_CONFIG[entry.type];
  return (
    <div className="flex gap-3 py-3 animate-fade-in">
      <ContractorAvatar name={entry.author_name} size="sm" className="shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-1.5 flex-wrap">
          <span className="text-sm font-medium">{entry.author_name}</span>
          {cfg.badge && (
            <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded", cfg.badgeClass)}>
              {cfg.badge}
            </span>
          )}
          <span className="text-xs text-muted-foreground/50 ml-auto shrink-0">
            {formatDistanceToNow(new Date(entry.created_at), { addSuffix: true })}
          </span>
        </div>
        <p className="text-sm text-muted-foreground mt-0.5 leading-snug">{entry.content}</p>
      </div>
    </div>
  );
}

interface StagedActivityFeedProps {
  entries:   ActivityEntry[];
  emptyText?: string;
}

export function StagedActivityFeed({ entries, emptyText = "No activity yet." }: StagedActivityFeedProps) {
  if (!entries.length) {
    return <p className="text-sm text-muted-foreground py-2">{emptyText}</p>;
  }

  // Group entries by stage_name from metadata
  const grouped = new Map<string, ActivityEntry[]>();
  const NO_STAGE = "__none";

  for (const entry of entries) {
    const stageName = (entry.metadata as any)?.stage_name as string | undefined;
    const key = stageName ?? NO_STAGE;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(entry);
  }

  // Build display order: known stages in order (most recent stage first), then "general" at bottom
  const stageOrder = [...NEW_PRODUCT_STAGES].reverse();
  const orderedKeys: string[] = [];
  for (const s of stageOrder) {
    if (grouped.has(s)) orderedKeys.push(s);
  }
  // Any unknown stage names not in NEW_PRODUCT_STAGES
  for (const key of grouped.keys()) {
    if (key !== NO_STAGE && !orderedKeys.includes(key)) orderedKeys.push(key);
  }
  if (grouped.has(NO_STAGE)) orderedKeys.push(NO_STAGE);

  return (
    <div className="space-y-1">
      {orderedKeys.map((key) => {
        const group    = grouped.get(key)!;
        const isNone   = key === NO_STAGE;
        const dotClass = isNone ? "bg-zinc-600" : (STAGE_DOT[key] ?? "bg-zinc-600");
        const lblClass = isNone ? "text-muted-foreground/50" : (STAGE_LABEL[key] ?? "text-muted-foreground/50");

        return (
          <div key={key}>
            {/* Stage header */}
            <div className="flex items-center gap-2 py-2 sticky top-0 bg-background z-10">
              <span className={cn("w-2 h-2 rounded-full shrink-0", dotClass)} />
              <span className={cn("text-[11px] font-semibold uppercase tracking-wider", lblClass)}>
                {isNone ? "General" : key}
              </span>
              <div className="flex-1 h-px bg-border/30" />
              <span className="text-[10px] text-muted-foreground/40">{group.length}</span>
            </div>

            {/* Entries */}
            <div className="pl-2 divide-y divide-border/20">
              {group.map(entry => <EntryRow key={entry.id} entry={entry} />)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
