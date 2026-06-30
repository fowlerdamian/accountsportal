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
  shopify: SourceFlag;
  email: SourceFlag;
  consumer: MarketingSegment;
  b2b: MarketingSegment;
}

export interface DateRange { startDate: string; endDate: string }

export function useTrailbaitDashboard(range?: DateRange) {
  return useQuery<TrailbaitDashboard>({
    queryKey: ["trailbait_marketing", range?.startDate ?? null, range?.endDate ?? null],
    queryFn: async () => {
      const body = range ? { startDate: range.startDate, endDate: range.endDate } : {};
      const { data, error } = await supabase.functions.invoke("marketing-dashboard", { body });
      if (error) throw new Error(error.message);
      return data as TrailbaitDashboard;
    },
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    placeholderData: (prev) => prev, // keep the previous period visible while the new one loads
  });
}
