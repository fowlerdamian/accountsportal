import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// ── Marketing dashboard — per-brand snapshot ────────────────────────────────
// One function, three brands. The caller passes { brand, startDate, endDate }.
//
//   • Every brand returns a `website` block — GA4 traffic for that brand's own
//     web property (TrailBait / AGA / FleetCraft each have their own site).
//   • TrailBait additionally returns segmented ecommerce + email. Shopify sales
//     are split per-order by the customer's tags — a TIER## tag marks a B2B
//     (distributor) account, everything else is Consumer; the split is mutually
//     exclusive. Brevo email is split by the list a campaign targeted
//     ("End Users" = Consumer, "Distributor*" = B2B).
//
// AGA & FleetCraft have no ecommerce/email — their pipeline (lead funnel +
// outbound) is read from Postgres on the client; only `website` comes from here.
//
// Secrets consumed (Supabase function secrets):
//   GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY (google-drive)
//   GA_PROPERTIES (JSON [{label,id}]) — matched to a brand by label keyword;
//     falls back to the hardcoded property ids below.
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

interface Range { startDate: string; endDate: string }
type Segment = "consumer" | "b2b";
type Brand = "trailbait" | "aga" | "fleetcraft";

// ── GA4 property per brand ────────────────────────────────────────────────────
// Each brand's web property. We use the ESTABLISHED properties that hold the
// historical traffic (TrailBait + FleetCraft live under the agency-managed
// "TrailBait.com.au" GA account 228088566; AGA under the AGA Google account).
// The dashboard service account (contractor-hub@…) is a Viewer on all three.
// Newer/empty properties (TrailBait 543687539, FleetCraft 543633778) are
// intentionally NOT used — they were created 2026-06-30 and have no history.
// An optional GA_BRAND_PROPERTIES secret (JSON {"trailbait":"id",…}) overrides.
const GA_PROPERTY: Record<Brand, string> = {
  trailbait: "314268188",   // TrailBait.com.au — full history (953d, ~507k sessions)
  aga: "496706418",         // Automotive Group Australia Website
  fleetcraft: "536375328",  // FleetCraft — historical property
};
function resolveProperty(brand: Brand): string {
  const raw = Deno.env.get("GA_BRAND_PROPERTIES");
  if (raw) {
    try {
      const o = JSON.parse(raw) as Partial<Record<Brand, string | number>>;
      if (o?.[brand]) return String(o[brand]);
    } catch { /* fall through */ }
  }
  return GA_PROPERTY[brand];
}

// ── Google JWT → access token (mirrors supabase/functions/google-drive) ──────
function b64url(obj: object): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}
function pemToBytes(pem: string): Uint8Array {
  const b64 = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const binary = atob(b64);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}
async function getGoogleAccessToken(email: string, privateKeyPem: string, scope: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = { iss: email, scope, aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 };
  const sigInput = `${b64url(header)}.${b64url(claims)}`;
  const key = await crypto.subtle.importKey(
    "pkcs8", pemToBytes(privateKeyPem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"],
  );
  const sigBytes = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(sigInput));
  const sig = btoa(String.fromCharCode(...new Uint8Array(sigBytes)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  const jwt = `${sigInput}.${sig}`;
  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  const data = await resp.json();
  if (!data.access_token) throw new Error(`Google auth failed: ${JSON.stringify(data)}`);
  return data.access_token;
}

// ── Google Analytics (GA4 Data API) — one brand's web property ───────────────
async function fetchAnalytics(propertyId: string, range?: Range) {
  const email = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  const pk = (Deno.env.get("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY") ?? "").replace(/\\n/g, "\n");
  if (!email || !pk) return { configured: false, ok: false, error: "GA service account not configured" };
  if (!propertyId) return { configured: false, ok: false, error: "GA property not set for this brand" };

  const gaRange = range ?? { startDate: "28daysAgo", endDate: "today" };
  try {
    const token = await getGoogleAccessToken(email, pk, "https://www.googleapis.com/auth/analytics.readonly");
    const res = await fetch(
      `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:batchRunReports`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(TIMEOUT),
        body: JSON.stringify({
          requests: [
            { dateRanges: [gaRange], metrics: [
                { name: "activeUsers" }, { name: "newUsers" }, { name: "sessions" },
                { name: "screenPageViews" }, { name: "keyEvents" }, { name: "engagementRate" },
              ] },
            { dateRanges: [gaRange], dimensions: [{ name: "date" }],
              metrics: [{ name: "sessions" }, { name: "activeUsers" }],
              orderBys: [{ dimension: { dimensionName: "date" } }] },
            { dateRanges: [gaRange], dimensions: [{ name: "sessionDefaultChannelGroup" }],
              metrics: [{ name: "sessions" }],
              orderBys: [{ metric: { metricName: "sessions" }, desc: true }], limit: 8 },
          ],
        }),
      },
    );
    if (!res.ok) {
      const body = await res.text();
      return { configured: true, ok: false, error: `GA ${res.status}: ${body.slice(0, 200)}` };
    }
    const data = await res.json();
    const [totals, ts, ch] = data.reports ?? [];
    const tRow = totals?.rows?.[0]?.metricValues ?? [];
    const timeseries = (ts?.rows ?? []).map((r: any) => {
      const d = r.dimensionValues?.[0]?.value ?? "";
      return {
        date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`,
        sessions: num(r.metricValues?.[0]?.value),
        users: num(r.metricValues?.[1]?.value),
      };
    });
    const channels = (ch?.rows ?? []).map((r: any) => ({
      channel: r.dimensionValues?.[0]?.value ?? "(other)",
      sessions: num(r.metricValues?.[0]?.value),
    }));
    return {
      configured: true, ok: true, propertyId,
      activeUsers: num(tRow[0]?.value),
      newUsers: num(tRow[1]?.value),
      sessions: num(tRow[2]?.value),
      pageViews: num(tRow[3]?.value),
      keyEvents: num(tRow[4]?.value),
      engagementRate: round(num(tRow[5]?.value) * 100, 1),
      timeseries, channels,
    };
  } catch (e) {
    return { configured: true, ok: false, error: String(e).slice(0, 200) };
  }
}

// ── Shopify (TrailBait) — orders split into Consumer / B2B by customer tag ───
const TIER_RE = /(^|,)\s*TIER\s*\d+\b/i;
const isB2bCustomerTags = (tags: unknown) => TIER_RE.test(String(tags ?? ""));

interface ShopSeg {
  ok: boolean; revenue: number; orders: number; aov: number; currency: string;
  capped: boolean; timeseries: { date: string; revenue: number; orders: number }[];
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
    let url: string | null =
      `${base}/orders.json?status=any&created_at_min=${encodeURIComponent(minIso)}${maxParam}&limit=250&fields=id,total_price,currency,created_at,customer`;
    const orders: any[] = [];
    let capped = false;
    for (let page = 0; page < 8 && url; page++) {
      const res: Response = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT) });
      if (!res.ok) {
        if (orders.length) break;
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

    const buildSeg = (s: Segment): ShopSeg => {
      const { revenue, orders: n, byDay } = seg[s];
      return {
        ok: true, revenue: round(revenue), orders: n, aov: n ? round(revenue / n) : 0,
        currency, capped,
        timeseries: Object.entries(byDay).sort(([a], [b]) => a.localeCompare(b))
          .map(([date, v]) => ({ date, revenue: round(v.revenue), orders: v.orders })),
      };
    };

    return { configured: true, ok: true, storeDomain: store, currency, consumer: buildSeg("consumer"), b2b: buildSeg("b2b") };
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

const B2B_LIST_RE = /distributor|wholesale|trade|dealer|reseller|b2b/i;

async function fetchBrevo(range?: Range): Promise<{
  configured: boolean; ok: boolean; error?: string; consumer: EmailSeg; b2b: EmailSeg;
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

    const buildSeg = (s: Segment): EmailSeg => {
      const cs = acc[s].sort((a, b) => (b.sentDate ?? "").localeCompare(a.sentDate ?? ""));
      const t = cs.reduce((a, c) => ({ sent: a.sent + c.sent, opens: a.opens + c.opens, clicks: a.clicks + c.clicks }), { sent: 0, opens: 0, clicks: 0 });
      return {
        ok: true, sent: t.sent, opens: t.opens, clicks: t.clicks,
        openRate: t.sent ? round((t.opens / t.sent) * 100, 1) : 0,
        clickRate: t.sent ? round((t.clicks / t.sent) * 100, 1) : 0,
        campaignCount: cs.length, campaigns: cs.slice(0, 8),
      };
    };

    return { configured: true, ok: true, consumer: buildSeg("consumer"), b2b: buildSeg("b2b") };
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
        ga: !!Deno.env.get("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY"),
        gaProperties: Deno.env.get("GA_PROPERTIES") ?? null,
        shopify: !!Deno.env.get("SHOPIFY_ACCESS_TOKEN") && !!Deno.env.get("SHOPIFY_STORE_DOMAIN"),
        brevo: !!Deno.env.get("BREVO_API_KEY"),
      },
    });
  }

  const brand: Brand =
    body.brand === "aga" || body.brand === "fleetcraft" ? body.brand : "trailbait";

  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  const range: Range | undefined =
    dateRe.test(body.startDate ?? "") && dateRe.test(body.endDate ?? "")
      ? { startDate: body.startDate, endDate: body.endDate }
      : undefined;

  const websiteP = fetchAnalytics(resolveProperty(brand), range);

  // AGA / FleetCraft: website only (their pipeline is read on the client).
  if (brand !== "trailbait") {
    const website = await websiteP;
    return json({ ok: true, brand, generatedAt: new Date().toISOString(), range: range ?? null, website });
  }

  // TrailBait: website + segmented ecommerce + email.
  const [website, shopify, brevo] = await Promise.all([websiteP, fetchShopify(range), fetchBrevo(range)]);

  return json({
    ok: true,
    brand,
    generatedAt: new Date().toISOString(),
    range: range ?? null,
    store: shopify.storeDomain ?? null,
    currency: shopify.currency,
    website,
    shopify: { ok: shopify.ok, configured: shopify.configured, error: shopify.error },
    email: { ok: brevo.ok, configured: brevo.configured, error: brevo.error },
    consumer: { shopify: shopify.consumer, email: brevo.consumer },
    b2b: { shopify: shopify.b2b, email: brevo.b2b },
  });
});
