import { Phone, PhoneMissed, PhoneIncoming, Voicemail, Loader2 } from "lucide-react";
import { useCallLogs } from "../hooks/useSalesQueries";
import { cn } from "../../Guide/lib/utils";

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-AU", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

const STATUS_CONFIG = {
  answered:  { icon: Phone,         color: "text-emerald-400", label: "Answered" },
  missed:    { icon: PhoneMissed,   color: "text-red-400",     label: "Missed" },
  voicemail: { icon: Voicemail,     color: "text-amber-400",   label: "Voicemail" },
  busy:      { icon: PhoneMissed,   color: "text-zinc-400",    label: "Busy" },
} as const;

interface Props {
  leadId: string | null | undefined;
}

export default function CallHistory({ leadId }: Props) {
  const { data: logs, isLoading } = useCallLogs(leadId);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Loading call history…
      </div>
    );
  }

  if (!logs?.length) {
    return (
      <p className="text-sm text-muted-foreground/50 italic">No calls logged yet</p>
    );
  }

  return (
    <div className="space-y-2">
      {logs.map((log) => {
        const cfg = STATUS_CONFIG[log.status] ?? STATUS_CONFIG.missed;
        const Icon = cfg.icon;
        const isInbound = log.direction === "inbound";

        return (
          <div key={log.id} className="flex items-center gap-3 text-sm py-1.5 border-b border-border/40 last:border-0">
            <Icon className={cn("w-4 h-4 flex-shrink-0", cfg.color)} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={cn("font-medium text-xs", cfg.color)}>{cfg.label}</span>
                <span className="text-xs text-muted-foreground/60">
                  {isInbound ? "Inbound" : "Outbound"}
                </span>
                {log.duration_seconds > 0 && (
                  <span className="text-xs text-muted-foreground/60">
                    · {formatDuration(log.duration_seconds)}
                  </span>
                )}
              </div>
              <div className="text-xs text-muted-foreground/50 mt-0.5">
                {formatTime(log.started_at ?? log.created_at)}
                {isInbound
                  ? log.from_number && ` · from ${log.from_number}`
                  : log.to_number   && ` · to ${log.to_number}`}
              </div>
            </div>
            {log.recording_url && (
              <a
                href={log.recording_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-shrink-0 text-xs text-primary hover:text-primary/80 transition-colors"
              >
                Recording
              </a>
            )}
            {/* Inbound from this number indicator */}
            {isInbound && (
              <PhoneIncoming className="w-3.5 h-3.5 flex-shrink-0 text-muted-foreground/40" />
            )}
          </div>
        );
      })}
    </div>
  );
}
