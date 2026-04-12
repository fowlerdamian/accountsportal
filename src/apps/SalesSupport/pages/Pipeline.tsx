import { useState } from "react";
import { useOutletContext } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Loader2, ExternalLink, RefreshCw, DollarSign, Clock } from "lucide-react";
import { cn } from "../../../apps/Guide/lib/utils";
import { type Channel } from "../lib/constants";
import { supabase } from "../../../lib/supabase";

interface HSDeal {
  id: string;
  properties: {
    dealname:               string;
    dealstage:              string;
    amount:                 string | null;
    closedate:              string | null;
    createdate:             string;
    hs_lastmodifieddate:    string;
    dealtype:               string | null;
    hubspot_owner_id:       string | null;
  };
}

interface StageGroup {
  stage: string;
  label: string;
  deals: HSDeal[];
}

// HubSpot default deal stage IDs → labels (adjust to match your pipeline)
const STAGE_LABELS: Record<string, string> = {
  appointmentscheduled: "Appointment Scheduled",
  qualifiedtobuy:       "Qualified",
  presentationscheduled:"Presentation",
  decisionmakerboughtin:"Decision Maker",
  contractsent:         "Contract Sent",
  closedwon:            "Closed Won",
  closedlost:           "Closed Lost",
};

function stageName(stageId: string): string {
  return STAGE_LABELS[stageId] ?? stageId.replace(/([A-Z])/g, " $1").trim();
}

function daysSince(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
}

export default function Pipeline() {
  const { channel } = useOutletContext<{ channel: Channel }>();
  const [expandedDeal, setExpanded] = useState<string | null>(null);

  const { data, isLoading, refetch, error } = useQuery({
    queryKey: ["hs_deals", channel],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("sales-hubspot-sync", {
        body: { action: "get_deals", channel },
      });
      if (error) {
        let msg = "Failed to fetch HubSpot deals";
        try { const body = await (error as any).context?.json?.(); if (body?.error) msg = body.error; } catch {}
        throw new Error(msg);
      }
      return data.deals as HSDeal[];
    },
    staleTime: 60_000,
  });

  const deals = data ?? [];

  // Group by stage
  const stageOrder = Object.keys(STAGE_LABELS);
  const stageMap = new Map<string, HSDeal[]>();
  for (const d of deals) {
    const s = d.properties.dealstage ?? "unknown";
    if (!stageMap.has(s)) stageMap.set(s, []);
    stageMap.get(s)!.push(d);
  }

  // Sort stages: known order first, then unknown ones
  const stages: StageGroup[] = [
    ...stageOrder.filter((s) => stageMap.has(s)).map((s) => ({ stage: s, label: stageName(s), deals: stageMap.get(s)! })),
    ...[...stageMap.entries()]
      .filter(([s]) => !stageOrder.includes(s))
      .map(([s, ds]) => ({ stage: s, label: stageName(s), deals: ds })),
  ];

  const totalValue = deals.reduce((s, d) => s + (parseFloat(d.properties.amount ?? "0") || 0), 0);

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <h2 className="text-lg font-semibold">Pipeline</h2>
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <DollarSign className="w-4 h-4" />
          <span className="font-medium text-foreground">${totalValue.toLocaleString()}</span>
          <span>total value</span>
        </div>
        <div className="text-sm text-muted-foreground">{deals.length} deals</div>
        <button onClick={() => refetch()} className="ml-auto p-1.5 rounded hover:bg-muted/50 transition-colors">
          <RefreshCw className={cn("w-4 h-4", isLoading && "animate-spin")} />
        </button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <div className="py-12 text-center space-y-2">
          <p className="text-sm font-medium text-muted-foreground">
            {(error as Error).message === "HUBSPOT_ACCESS_TOKEN not configured"
              ? "HubSpot is not connected yet."
              : "Could not load HubSpot deals."}
          </p>
          <p className="text-xs text-muted-foreground/60">
            {(error as Error).message === "HUBSPOT_ACCESS_TOKEN not configured"
              ? "Add HUBSPOT_ACCESS_TOKEN to your Supabase edge function secrets to enable the pipeline view."
              : (error as Error).message}
          </p>
        </div>
      ) : deals.length === 0 ? (
        <div className="py-12 text-center text-muted-foreground text-sm">
          No deals found in HubSpot for this channel. Push leads to HubSpot to populate the pipeline.
        </div>
      ) : (
        /* Kanban board — horizontal scroll */
        <div className="flex gap-4 overflow-x-auto pb-4" style={{ minHeight: 400 }}>
          {stages.map(({ stage, label, deals: stageDeals }) => (
            <div key={stage} className="flex-shrink-0 w-64">
              {/* Column header */}
              <div className="flex items-center justify-between mb-2 px-1">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
                <span className="text-xs text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded-full">{stageDeals.length}</span>
              </div>

              {/* Cards */}
              <div className="space-y-2">
                {stageDeals.map((deal) => {
                  const amount  = parseFloat(deal.properties.amount ?? "0") || 0;
                  const daysIn  = daysSince(deal.properties.hs_lastmodifieddate ?? deal.properties.createdate);
                  const isOpen  = expandedDeal === deal.id;
                  const stageHeat = daysIn > 30 ? "border-red-500/40" : daysIn > 14 ? "border-yellow-500/40" : "border-border";

                  return (
                    <div
                      key={deal.id}
                      onClick={() => setExpanded(isOpen ? null : deal.id)}
                      className={cn(
                        "rounded-lg border bg-card p-3 cursor-pointer hover:border-foreground/20 transition-all",
                        stageHeat
                      )}
                    >
                      <div className="font-medium text-sm leading-tight">{deal.properties.dealname}</div>

                      <div className="flex items-center justify-between mt-2">
                        {amount > 0 ? (
                          <span className="text-xs font-semibold text-green-400">
                            ${amount.toLocaleString()}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">No value</span>
                        )}
                        <span className={cn(
                          "flex items-center gap-1 text-xs",
                          daysIn > 30 ? "text-red-400" : daysIn > 14 ? "text-yellow-400" : "text-muted-foreground"
                        )}>
                          <Clock className="w-3 h-3" />
                          {daysIn}d
                        </span>
                      </div>

                      {isOpen && (
                        <div className="mt-3 pt-3 border-t border-border space-y-1.5 text-xs text-muted-foreground">
                          <div>Created: {new Date(deal.properties.createdate).toLocaleDateString("en-AU")}</div>
                          {deal.properties.closedate && (
                            <div>Close date: {new Date(deal.properties.closedate).toLocaleDateString("en-AU")}</div>
                          )}
                          <a
                            href={`https://app-ap1.hubspot.com/deals/22572063/${deal.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="flex items-center gap-1 text-orange-400 hover:text-orange-300 transition-colors"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                            Open in HubSpot
                          </a>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
