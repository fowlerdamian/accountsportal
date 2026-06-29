import { useQuery } from "@tanstack/react-query";
import { supabase } from "@portal/lib/supabase";

// Shape returned by the `marketing-dashboard` edge function. Each source is
// isolated — `ok:false` with an `error` string means that one integration is
// down/unconfigured while the others still render.
export interface SourceBase {
  configured: boolean;
  ok: boolean;
  error?: string;
}

export interface AnalyticsData extends SourceBase {
  propertyId?: string;
  activeUsers?: number;
  newUsers?: number;
  sessions?: number;
  pageViews?: number;
  keyEvents?: number;
  engagementRate?: number;
  timeseries?: { date: string; sessions: number; users: number }[];
  channels?: { channel: string; sessions: number }[];
}

export interface HubspotData extends SourceBase {
  totalContacts?: number;
  newContacts30d?: number;
  openDeals?: number;
  openDealsValue?: number;
}

export interface ShopifyData extends SourceBase {
  storeDomain?: string;
  orders30d?: number;
  revenue30d?: number;
  aov?: number;
  currency?: string;
  capped?: boolean;
  timeseries?: { date: string; revenue: number }[];
}

export interface BrevoCampaign {
  name: string;
  sentDate: string | null;
  status: string | null;
  sent: number;
  delivered: number;
  opens: number;
  clicks: number;
  openRate: number;
  clickRate: number;
}

export interface BrevoData extends SourceBase {
  totalContacts?: number;
  campaignCount?: number;
  totals?: { sent: number; opens: number; clicks: number; openRate: number; clickRate: number };
  campaigns?: BrevoCampaign[];
}

export interface MarketingDashboard {
  ok: boolean;
  generatedAt: string;
  analytics: AnalyticsData;
  hubspot: HubspotData;
  shopify: ShopifyData;
  brevo: BrevoData;
}

export function useMarketingDashboard() {
  return useQuery<MarketingDashboard>({
    queryKey: ["marketing_dashboard"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("marketing-dashboard", { body: {} });
      if (error) throw new Error(error.message);
      return data as MarketingDashboard;
    },
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
}
