import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// ── Marketing dashboard — TrailBait segmented snapshot ──────────────────────
// TrailBait is the only brand with ecommerce + marketing email, so this
// function powers TrailBait's two segmented views (Consumer / B2B).
//
//   • Shopify sales are split per-order by the order's customer tags. A customer
//     carrying a tag of the form TIER## (e.g. TIER20) is a B2B (distributor)
//     account; every other customer is Consumer. The split is mutually
//     exclusive — each order lands in exactly one segment.
//   • Brevo email is split by the list a campaign was sent to. "End Users" is
//     the consumer list; the "Distributor*" lists are B2B.
//
// AGA & FleetCraft have no ecommerce or email — their dashboards read the
// sales-support pipeline directly from Postgres on the client, not here.
//
// Secrets consumed (Supabase function secrets):
//   SHOPIFY_ACCESS_TOKEN / SHOPIFY_STORE_DOMAIN   – TrailBait store
//   BREVO_API_KEY                                 – TrailBait email

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const TIMEOUT = 12_000;
const num = (v: unknown) => {
  const n = typeof v === "string" ? parseFloat(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
};
const isoDaysAgo = (days: number) => new Date(Date.now() - days * 86400_000).toISOString();
const round = (n: number, d = 2) => {
  const f = 10 ** d;
  return Math.round(n * f) / f;
};

// A customer is B2B iff any of their tags matches TIER##. This single tag is the
// authoritative arbiter of the Consumer/B2B split.
const TIER_RE = /(^|,)\s*TIER\s*\d+\b/i;
const isB2bCustomerTags = (tags: unknown) => TIER_RE.test(String(tags ?? ""));

interface Range { startDate: string; endDate: string }
type Segment = "consumer" | "b2b";

// ── Shopify (TrailBait) — orders split into Consumer / B2B by customer tag ───
interface ShopSeg {
  ok: boolean;
  revenue: number;
  orders: number;
  aov: number;
  currency: string;
  capped: boolean;
  timeseries: { date: string; revenue: number; orders: number }[];
}
const emptyShopSeg = (currency = "AUD"): ShopSeg => ({
  ok: true, revenue: 0, orders: 0, aov: 0, currency, capped: false, timeseries: [],
});

async function fetchShopify(range?: Range): Promise<{
  configured: boolean; ok: boolean; error?: string; storeDomain?: string;
  currency: string; consumer: ShopSeg; b2b: ShopSeg;
}> {
  const token = Deno.env.get("SHOPIFY_ACCESS_TOKEN");
  const store = Deno.env.get("SHOPIFY_STORE_DOMAIN");
  if (!token || !store) {
    return { configured: false, ok: false, error: "Shopify not configured", currency: "AUD", consumer: emptyShopSeg(), b2b: emptyShopSeg() };
  }
  const headers = { "X-Shopify-Access-Token": token, "Content-Type": "application/json" };
  const base = `https://${store}/admin/api/2024-01`;
  try {
    const minIso = range ? `${range.startDate}T00:00:00Z` : isoDaysAgo(30);
    const maxParam = range ? `&created_at_max=${encodeURIComponent(`${range.endDate}T23:59:59Z`)}` : "";
    // Pull the customer object so we can read its tags per order. Cap at 8 pages
    // (2000 orders) for latency; flag `capped` if the window is larger.
    let url: string | null =
      `${base}/orders.json?status=any&created_at_min=${encodeURIComponent(minIso)}${maxParam}&limit=250&fields=id,total_price,currency,created_at,customer`;
    const orders: any[] = [];
    let capped = false;
    for (let page = 0; page < 8 && url; page++) {
      const res: Response = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT) });
      if (!res.ok) {
        if (orders.length) break; // partial data is still useful
        const body = await res.text();
        return { configured: true, ok: false, error: `Shopify ${res.status}: ${body.slice(0, 160)}`, currency: "AUD", consumer: emptyShopSeg(), b2b: emptyShopSeg() };
      }
      const data = await res.json();
      orders.push(...(data.orders ?? []));
      const link = res.headers.get("Link") ?? res.headers.get("link") ?? "";
      const next = link.match(/<([^>]+)>;\s*rel="next"/);
      url = next ? next[1] : null;
      if (page === 7 && url) capped = true;
    }

    const currency = orders[0]?.currency ?? "AUD";
    const seg: Record<Segment, { revenue: number; orders: number; byDay: Record<string, { revenue: number; orders: number }> }> = {
      consumer: { revenue: 0, orders: 0, byDay: {} },
      b2b: { revenue: 0, orders: 0, byDay: {} },
    };
    for (const o of orders) {
      const s: Segment = isB2bCustomerTags(o.customer?.tags) ? "b2b" : "consumer";
      const amt = num(o.total_price);
      seg[s].revenue += amt;
      seg[s].orders += 1;
      const d = (o.created_at ?? "").slice(0, 10);
      if (d) {
        const bucket = (seg[s].byDay[d] ??= { revenue: 0, orders: 0 });
        bucket.revenue += amt;
        bucket.orders += 1;
      }
    }

    const build = (s: Segment): ShopSeg => {
      const { revenue, orders: n, byDay } = seg[s];
      return {
        ok: true,
        revenue: round(revenue),
        orders: n,
        aov: n ? round(revenue / n) : 0,
        currency,
        capped,
        timeseries: Object.entries(byDay)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, v]) => ({ date, revenue: round(v.revenue), orders: v.orders })),
      };
    };

    return { configured: true, ok: true, storeDomain: store, currency, consumer: build("consumer"), b2b: build("b2b") };
  } catch (e) {
    return { configured: true, ok: false, error: String(e).slice(0, 200), currency: "AUD", consumer: emptyShopSeg(), b2b: emptyShopSeg() };
  }
}

// ── Brevo (TrailBait) — campaigns split into Consumer / B2B by target list ───
interface EmailCampaign {
  name: string; sentDate: string | null; sent: number; opens: number; clicks: number;
  openRate: number; clickRate: number;
}
interface EmailSeg {
  ok: boolean; sent: number; opens: number; clicks: number; openRate: number; clickRate: number;
  campaignCount: number; campaigns: EmailCampaign[];
}
const emptyEmailSeg = (): EmailSeg => ({
  ok: true, sent: 0, opens: 0, clicks: 0, openRate: 0, clickRate: 0, campaignCount: 0, campaigns: [],
});

// A list is B2B if its name reads like a distributor/wholesale/trade list;
// otherwise it's a consumer (end-user) list.
const B2B_LIST_RE = /distributor|wholesale|trade|dealer|reseller|b2b/i;

async function fetchBrevo(range?: Range): Promise<{
  configured: boolean; ok: boolean; error?: string;
  consumer: EmailSeg; b2b: EmailSeg;
}> {
  const key = Deno.env.get("BREVO_API_KEY");
  if (!key) return { configured: false, ok: false, error: "BREVO_API_KEY not set", consumer: emptyEmailSeg(), b2b: emptyEmailSeg() };
  const headers = { "api-key": key, accept: "application/json" };
  const get = (path: string) => fetch(`https://api.brevo.com/v3/${path}`, { headers, signal: AbortSignal.timeout(TIMEOUT) });
  try {
    const [listsRes, campRes] = await Promise.all([
      get("contacts/lists?limit=50&sort=desc"),
      get("emailCampaigns?statistics=globalStats&status=sent&limit=100&sort=desc"),
    ]);
    if (!campRes.ok) {
      const body = await campRes.text();
      return { configured: true, ok: false, error: `Brevo ${campRes.status}: ${body.slice(0, 160)}`, consumer: emptyEmailSeg(), b2b: emptyEmailSeg() };
    }
    // Map every list id → its segment by name.
    const lists = listsRes.ok ? ((await listsRes.json()).lists ?? []) : [];
    const listSeg = new Map<number, Segment>();
    for (const l of lists) listSeg.set(Number(l.id), B2B_LIST_RE.test(String(l.name ?? "")) ? "b2b" : "consumer");

    const camp = (await campRes.json()).campaigns ?? [];
    const acc: Record<Segment, EmailCampaign[]> = { consumer: [], b2b: [] };
    for (const c of camp) {
      const sentDate = (c.sentDate ?? "").slice(0, 10);
      if (range && !(sentDate && sentDate >= range.startDate && sentDate <= range.endDate)) continue;
      const targetLists: number[] = (c.recipients?.lists ?? []).map((x: any) => Number(x));
      if (!targetLists.length) continue;
      // A campaign is B2B if it touches any B2B list, else Consumer.
      const segment: Segment = targetLists.some((id) => listSeg.get(id) === "b2b") ? "b2b" : "consumer";
      const g = c.statistics?.globalStats ?? {};
      const sent = num(g.sent);
      if (!sent) continue;
      const opens = num(g.uniqueViews ?? g.viewed);
      const clicks = num(g.uniqueClicks ?? g.clickers);
      acc[segment].push({
        name: c.name ?? "(untitled)",
        sentDate: c.sentDate ?? null,
        sent, opens, clicks,
        openRate: round((opens / sent) * 100, 1),
        clickRate: round((clicks / sent) * 100, 1),
      });
    }

    const build = (s: Segment): EmailSeg => {
      const cs = acc[s].sort((a, b) => (b.sentDate ?? "").localeCompare(a.sentDate ?? ""));
      const t = cs.reduce((a, c) => ({ sent: a.sent + c.sent, opens: a.opens + c.opens, clicks: a.clicks + c.clicks }), { sent: 0, opens: 0, clicks: 0 });
      return {
        ok: true,
        sent: t.sent, opens: t.opens, clicks: t.clicks,
        openRate: t.sent ? round((t.opens / t.sent) * 100, 1) : 0,
        clickRate: t.sent ? round((t.clicks / t.sent) * 100, 1) : 0,
        campaignCount: cs.length,
        campaigns: cs.slice(0, 8),
      };
    };

    return { configured: true, ok: true, consumer: build("consumer"), b2b: build("b2b") };
  } catch (e) {
    return { configured: true, ok: false, error: String(e).slice(0, 200), consumer: emptyEmailSeg(), b2b: emptyEmailSeg() };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  let body: any = {};
  try { body = await req.json(); } catch { /* no body */ }

  if (body.action === "diag") {
    return json({
      ok: true,
      configured: {
        shopify: !!Deno.env.get("SHOPIFY_ACCESS_TOKEN") && !!Deno.env.get("SHOPIFY_STORE_DOMAIN"),
        brevo: !!Deno.env.get("BREVO_API_KEY"),
      },
    });
  }

  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  const range: Range | undefined =
    dateRe.test(body.startDate ?? "") && dateRe.test(body.endDate ?? "")
      ? { startDate: body.startDate, endDate: body.endDate }
      : undefined;

  const [shopify, brevo] = await Promise.all([fetchShopify(range), fetchBrevo(range)]);

  return json({
    ok: true,
    generatedAt: new Date().toISOString(),
    range: range ?? null,
    store: shopify.storeDomain ?? null,
    currency: shopify.currency,
    shopify: { ok: shopify.ok, configured: shopify.configured, error: shopify.error },
    email: { ok: brevo.ok, configured: brevo.configured, error: brevo.error },
    consumer: { shopify: shopify.consumer, email: brevo.consumer },
    b2b: { shopify: shopify.b2b, email: brevo.b2b },
  });
});
