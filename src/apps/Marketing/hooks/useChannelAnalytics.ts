import { useQuery } from "@tanstack/react-query";
import { supabase } from "@portal/lib/supabase";
import type { DateRange } from "./useMarketingDashboard";
import type { BucketKey } from "@portal/lib/channels";

// Deal-side channel aggregates from the `channel-analytics` edge function.
// The lead-side (new leads, funnel, trend, outbound) is read separately on the
// client via the EXISTING usePipelineMetrics hook — see ChannelAnalytics.tsx,
// which calls it once per channel. This hook owns only the HubSpot deal money
// metrics that have no existing client path.

export interface StageStat { stageId: string; label: string; count: number; value: number; order: number }
export interface TopAccount { account: string; amount: number; stage: string; isOpen: boolean }

export interface ChannelDealStats {
  openValue: number;
  openCount: number;
  wonValue: number;
  wonCount: number;
  lostCount: number;
  winRate: number | null;     // null when no deals closed in the period
  activeCustomers: number;    // distinct companies with a won deal
  byStage: StageStat[];
  topAccounts: TopAccount[];
  totalDeals: number;
}

export interface ChannelAnalyticsPayload {
  ok: boolean;
  generatedAt: string;
  range: { startDate: string; endDate: string } | null;
  stages: { stageId: string; label: string; order: number }[];
  buckets: Record<BucketKey, ChannelDealStats>;
  totalDeals: number;
  error?: string;
}

export function useChannelDeals(range?: DateRange, enabled = true) {
  return useQuery<ChannelAnalyticsPayload>({
    queryKey: ["channel_deals", range?.startDate ?? null, range?.endDate ?? null],
    enabled,
    queryFn: async () => {
      const body = { ...(range ?? {}) };
      const { data, error } = await supabase.functions.invoke("channel-analytics", { body });
      if (error) throw new Error(error.message);
      if (!data?.ok) throw new Error(data?.error || "channel-analytics returned an error");
      return data as ChannelAnalyticsPayload;
    },
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    placeholderData: (prev) => prev,
  });
}
