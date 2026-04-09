import { MessageSquare, RefreshCw, CornerDownRight, Paperclip, Clock, ExternalLink } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@guide/lib/utils";
import { ContractorAvatar } from "./ContractorAvatar";
import type { ActivityEntry, ActivityType } from "@hub/hooks/use-hub-queries";

const TYPE_CONFIG: Record<ActivityType, { icon: typeof MessageSquare; badgeClass: string; badge: string }> = {
  note:           { icon: MessageSquare, badge: "note",    badgeClass: "bg-muted text-muted-foreground" },
  update:         { icon: RefreshCw,     badge: "update",  badgeClass: "bg-blue-900/40 text-blue-300" },
  status_change:  { icon: CornerDownRight, badge: "",      badgeClass: "" },
  file:           { icon: Paperclip,     badge: "file",    badgeClass: "bg-muted text-muted-foreground" },
  time_log:       { icon: Clock,         badge: "time",    badgeClass: "bg-muted text-muted-foreground" },
  upwork_message: { icon: ExternalLink,  badge: "upwork",  badgeClass: "bg-blue-900/40 text-blue-300" },
};

interface ActivityFeedProps {
  entries:   ActivityEntry[];
  isLoading?: boolean;
  emptyText?: string;
}

export function ActivityFeed({ entries, isLoading, emptyText = "No activity yet." }: ActivityFeedProps) {
  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex gap-3 animate-pulse">
            <div className="w-7 h-7 rounded-full bg-muted shrink-0" />
            <div className="flex-1 space-y-1.5 pt-1">
              <div className="h-3 bg-muted rounded w-48" />
              <div className="h-3 bg-muted rounded w-full" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (!entries.length) {
    return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  }

  return (
    <div className="space-y-4">
      {entries.map((entry) => {
        const cfg = TYPE_CONFIG[entry.type];
        const Icon = cfg.icon;

        return (
          <div key={entry.id} className="flex gap-3 animate-fade-in">
            <ContractorAvatar name={entry.author_name} size="sm" className="shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-1.5 flex-wrap">
                <span className="text-sm font-medium">{entry.author_name}</span>
                {cfg.badge && (
                  <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded", cfg.badgeClass)}>
                    {cfg.badge}
                  </span>
                )}
                {entry.projects?.name && (
                  <span className="text-xs text-muted-foreground">
                    on {entry.projects.name}
                  </span>
                )}
                <span className="text-xs text-muted-foreground/60 ml-auto shrink-0">
                  {formatDistanceToNow(new Date(entry.created_at), { addSuffix: true })}
                </span>
              </div>
              <p className="text-sm text-muted-foreground mt-0.5 leading-snug">{entry.content}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
