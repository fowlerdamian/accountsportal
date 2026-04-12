import { useState } from "react";
import { useOutletContext, useNavigate } from "react-router-dom";
import { Loader2, Phone, RefreshCw, ChevronRight, Star, Globe, User, RotateCcw } from "lucide-react";
import { cn } from "../../../apps/Guide/lib/utils";
import { useCallList } from "../hooks/useSalesQueries";
import { type Channel } from "../lib/constants";
import { supabase } from "@portal/lib/supabase";
import { useQueryClient } from "@tanstack/react-query";

const CALL_REASON_COLOR = (reason: string) => {
  if (reason.toLowerCase().includes("win-back")) return "text-red-400 bg-red-500/10 border-red-500/20";
  if (reason.toLowerCase().includes("new")) return "text-blue-400 bg-blue-500/10 border-blue-500/20";
  return "text-yellow-400 bg-yellow-500/10 border-yellow-500/20";
};

const OUTCOME_COLOR: Record<string, string> = {
  connected:      "bg-green-500/20 text-green-400",
  voicemail:      "bg-yellow-500/20 text-yellow-400",
  no_answer:      "bg-zinc-500/20 text-zinc-400",
  callback:       "bg-blue-500/20 text-blue-400",
  not_interested: "bg-red-500/20 text-red-400",
};

export default function CallList() {
  const { channel } = useOutletContext<{ channel: Channel }>();
  const navigate    = useNavigate();
  const qc          = useQueryClient();

  const [date, setDate]         = useState(new Date().toISOString().split("T")[0]);
  const [generating, setGen]    = useState(false);

  const { data: calls = [], isLoading, refetch } = useCallList(channel, date);

  async function generateList() {
    setGen(true);
    try {
      await supabase.functions.invoke("sales-calllist-generate", { body: { channel, date } });
      qc.invalidateQueries({ queryKey: ["call_list", channel, date] });
    } finally {
      setGen(false);
    }
  }

  const pending   = calls.filter((c) => !c.is_complete);
  const completed = calls.filter((c) => c.is_complete);

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <h2 className="text-lg font-semibold">Call List</h2>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="px-2.5 py-1.5 bg-muted/40 border border-border rounded-lg text-sm focus:outline-none"
        />
        <div className="ml-auto flex gap-2">
          <button onClick={() => refetch()} className="p-1.5 rounded hover:bg-muted/50 transition-colors">
            <RefreshCw className={cn("w-4 h-4", isLoading && "animate-spin")} />
          </button>
          <button onClick={generateList} disabled={generating}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90 transition-colors disabled:opacity-50">
            {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
            Regenerate
          </button>
        </div>
      </div>

      {/* Progress bar */}
      {calls.length > 0 && (
        <div className="flex items-center gap-3 text-sm">
          <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-500 rounded-full"
              style={{ width: `${calls.length ? (completed.length / calls.length) * 100 : 0}%` }}
            />
          </div>
          <span className="text-muted-foreground text-xs whitespace-nowrap">
            {completed.length} / {calls.length} done
          </span>
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : calls.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center space-y-3">
          <Phone className="w-10 h-10 text-muted-foreground/40" />
          <p className="text-muted-foreground">No calls scheduled for this date.</p>
          <button onClick={generateList} disabled={generating}
            className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded hover:bg-primary/90 transition-colors">
            Generate Call List
          </button>
        </div>
      ) : (
        <>
          {/* Pending calls */}
          {pending.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                To Call ({pending.length})
              </h3>
              <div className="space-y-2">
                {pending.map((call) => {
                  const brief = call.context_brief ?? {};
                  return (
                    <div
                      key={call.id}
                      onClick={() => navigate(`/sales-support/${channel}/calls/${call.id}`)}
                      className="rounded-xl border border-border bg-card/50 p-4 hover:border-foreground/20 transition-all cursor-pointer group"
                    >
                      <div className="flex items-start gap-3">
                        {/* Priority badge */}
                        <div className="flex-shrink-0 w-7 h-7 rounded-full bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground">
                          {call.priority_rank}
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <h4 className="font-semibold text-base leading-tight">{brief.company_name ?? call.context_brief?.company_name ?? "—"}</h4>
                              {brief.phone && (
                                <a
                                  href={`tel:${brief.phone}`}
                                  onClick={(e) => e.stopPropagation()}
                                  className="text-sm text-primary hover:underline flex items-center gap-1 mt-0.5"
                                >
                                  <Phone className="w-3.5 h-3.5" />
                                  {brief.phone}
                                </a>
                              )}
                            </div>
                            <ChevronRight className="w-5 h-5 text-muted-foreground/40 group-hover:text-muted-foreground flex-shrink-0 mt-0.5 transition-colors" />
                          </div>

                          {/* Call reason */}
                          <div className={cn("mt-2 text-xs px-2.5 py-1.5 rounded border inline-block", CALL_REASON_COLOR(call.call_reason))}>
                            {call.call_reason}
                          </div>

                          {/* Quick info row */}
                          <div className="flex flex-wrap gap-3 mt-2 text-xs text-muted-foreground">
                            {brief.recommended_contact && (
                              <span className="flex items-center gap-1">
                                <User className="w-3.5 h-3.5" />
                                {brief.recommended_contact}
                              </span>
                            )}
                            {brief.google_rating && (
                              <span className="flex items-center gap-1 text-yellow-400">
                                <Star className="w-3.5 h-3.5 fill-yellow-400" />
                                {brief.google_rating}
                              </span>
                            )}
                            {brief.website && (
                              <span className="flex items-center gap-1">
                                <Globe className="w-3.5 h-3.5" />
                                {brief.website.replace(/^https?:\/\/(www\.)?/, "").split("/")[0]}
                              </span>
                            )}
                            {call.context_brief?.cin7_data?.is_winback && (
                              <span className="text-red-400 font-medium">Win-back</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Completed calls */}
          {completed.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                Completed ({completed.length})
              </h3>
              <div className="space-y-1.5">
                {completed.map((call) => {
                  const brief = call.context_brief ?? {};
                  return (
                    <div
                      key={call.id}
                      onClick={() => navigate(`/sales-support/${channel}/calls/${call.id}`)}
                      className="flex items-center gap-3 px-4 py-2.5 rounded-lg border border-border/40 bg-muted/20 hover:bg-muted/30 transition-colors cursor-pointer opacity-70"
                    >
                      <span className="text-xs text-muted-foreground w-5 text-right">{call.priority_rank}</span>
                      <span className="flex-1 text-sm font-medium">{brief.company_name}</span>
                      {call.call_outcome && (
                        <span className={cn("text-xs px-2 py-0.5 rounded-full", OUTCOME_COLOR[call.call_outcome] ?? "bg-muted text-muted-foreground")}>
                          {call.call_outcome.replace(/_/g, " ")}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
