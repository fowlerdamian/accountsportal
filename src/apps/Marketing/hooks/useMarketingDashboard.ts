import { useQuery } from "@tanstack/react-query";
import { supabase } from "@portal/lib/supabase";

// Shape returned by the `marketing-dashboard` edge function. TrailBait is the
// only brand with ecommerce + marketing email, so this payload is split into
// two mutually-exclusive segments — `consumer` and `b2b`. The split arbiter is
// the Shopify customer TIER## tag (sales) and the Brevo list (email); the two
// segments never overlap.

export interface SourceFlag {
  ok: boolean;
  configured: boolean;
  error?: string;
}

// GA4 traffic for a brand's own web property. Returned for every brand.
export interface WebsiteAnalytics {
  ok: boolean;
  configured: boolean;
  error?: string;
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

export interface ShopSegment {
  ok: boolean;
  revenue: number;
  orders: number;
  aov: number;
  currency: string;
  capped: boolean;
  timeseries: { date: string; revenue: number; orders: number }[];
}

export interface EmailCampaign {
  name: string;
  sentDate: string | null;
  sent: number;
  opens: number;
  clicks: number;
  openRate: number;
  clickRate: number;
}

export interface EmailSegment {
  ok: boolean;
  sent: number;
  opens: number;
  clicks: number;
  openRate: number;
  clickRate: number;
  campaignCount: number;
  campaigns: EmailCampaign[];
}

export interface MarketingSegment {
  shopify: ShopSegment;
  email: EmailSegment;
}

export interface TrailbaitDashboard {
  ok: boolean;
  generatedAt: string;
  range: { startDate: string; endDate: string } | null;
  store: string | null;
  currency: string;
  website: WebsiteAnalytics;
  shopify: SourceFlag;
  email: SourceFlag;
  consumer: MarketingSegment;
  b2b: MarketingSegment;
}

export interface BrandWebsite {
  ok: boolean;
  brand: string;
  generatedAt: string;
  range: { startDate: string; endDate: string } | null;
  website: WebsiteAnalytics;
}

export interface DateRange { startDate: string; endDate: string }

export function useTrailbaitDashboard(range?: DateRange) {
  return useQuery<TrailbaitDashboard>({
    queryKey: ["trailbait_marketing", range?.startDate ?? null, range?.endDate ?? null],
    queryFn: async () => {
      const body = { brand: "trailbait", ...(range ?? {}) };
      const { data, error } = await supabase.functions.invoke("marketing-dashboard", { body });
      if (error) throw new Error(error.message);
      return data as TrailbaitDashboard;
    },
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    placeholderData: (prev) => prev, // keep the previous period visible while the new one loads
  });
}

// Website (GA4) traffic for AGA / FleetCraft — their pipeline numbers come from
// usePipelineMetrics; this adds the brand's own web-property traffic alongside.
export function useBrandWebsite(brand: "aga" | "fleetcraft", range?: DateRange, enabled = true) {
  return useQuery<BrandWebsite>({
    queryKey: ["brand_website", brand, range?.startDate ?? null, range?.endDate ?? null],
    enabled,
    queryFn: async () => {
      const body = { brand, ...(range ?? {}) };
      const { data, error } = await supabase.functions.invoke("marketing-dashboard", { body });
      if (error) throw new Error(error.message);
      return data as BrandWebsite;
    },
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    placeholderData: (prev) => prev,
  });
}
