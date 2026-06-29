import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// ── Marketing dashboard aggregator ──────────────────────────────────────────
// Pulls a snapshot from Google Analytics (GA4 Data API), HubSpot, Shopify and
// Brevo and returns a single aggregated payload for the Marketing app.
// Each source is isolated: one failing integration never breaks the others.
//
// Secrets consumed (Supabase function secrets):
//   GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY  (reused from google-drive)
//   GA_PROPERTY_ID            – numeric GA4 property id (e.g. 317545000)
//   HUBSPOT_ACCESS_TOKEN      – private-app token
//   SHOPIFY_ACCESS_TOKEN / SHOPIFY_STORE_DOMAIN
//   BREVO_API_KEY

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

const TIMEOUT = 9000;
const num = (v: unknown) => {
  const n = typeof v === "string" ? parseFloat(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
};
const isoDaysAgo = (days: number) =>
  new Date(Date.now() - days * 86400_000).toISOString();
const round = (n: number, d = 2) => {
  const f = 10 ** d;
  return Math.round(n * f) / f;
};

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

// ── Google Analytics (GA4 Data API) ─────────────────────────────────────────
async function fetchAnalytics(propertyId: string) {
  const email = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  const pk = (Deno.env.get("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY") ?? "").replace(/\\n/g, "\n");
  if (!email || !pk) return { configured: false, ok: false, error: "service account not configured" };
  if (!propertyId) return { configured: false, ok: false, error: "GA_PROPERTY_ID not set" };

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
            { // 0 — totals
              dateRanges: [{ startDate: "28daysAgo", endDate: "today" }],
              metrics: [
                { name: "activeUsers" }, { name: "newUsers" },
                { name: "sessions" }, { name: "screenPageViews" },
                { name: "keyEvents" }, { name: "engagementRate" },
              ],
            },
            { // 1 — daily timeseries
              dateRanges: [{ startDate: "28daysAgo", endDate: "today" }],
              dimensions: [{ name: "date" }],
              metrics: [{ name: "sessions" }, { name: "activeUsers" }],
              orderBys: [{ dimension: { dimensionName: "date" } }],
            },
            { // 2 — channel breakdown
              dateRanges: [{ startDate: "28daysAgo", endDate: "today" }],
              dimensions: [{ name: "sessionDefaultChannelGroup" }],
              metrics: [{ name: "sessions" }],
              orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
              limit: 8,
            },
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

// ── HubSpot ──────────────────────────────────────────────────────────────────
async function fetchHubspot() {
  const token = Deno.env.get("HUBSPOT_ACCESS_TOKEN");
  if (!token) return { configured: false, ok: false, error: "HUBSPOT_ACCESS_TOKEN not set" };
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const search = (objitle: string, body: object) =>
    fetch(`https://api.hubapi.com/crm/v3/objects/${objitle}/search`, {
      method: "POST", headers, signal: AbortSignal.timeout(TIMEOUT), body: JSON.stringify(body),
    });
  try {
    const since30 = Date.now() - 30 * 86400_000;
    const [allContacts, newContacts, openDeals] = await Promise.all([
      search("contacts", { limit: 1, filterGroups: [] }),
      search("contacts", {
        limit: 1,
        filterGroups: [{ filters: [{ propertyName: "createdate", operator: "GTE", value: String(since30) }] }],
      }),
      search("deals", {
        limit: 100, properties: ["amount"],
        filterGroups: [{ filters: [{ propertyName: "hs_is_closed", operator: "EQ", value: "false" }] }],
      }),
    ]);
    if (!allContacts.ok) {
      const body = await allContacts.text();
      return { configured: true, ok: false, error: `HubSpot ${allContacts.status}: ${body.slice(0, 160)}` };
    }
    const ac = await allContacts.json();
    const nc = newContacts.ok ? await newContacts.json() : { total: 0 };
    const od = openDeals.ok ? await openDeals.json() : { total: 0, results: [] };
    const openDealsValue = (od.results ?? []).reduce(
      (s: number, d: any) => s + num(d.properties?.amount), 0);
    return {
      configured: true, ok: true,
      totalContacts: num(ac.total),
      newContacts30d: num(nc.total),
      openDeals: num(od.total),
      openDealsValue: round(openDealsValue),
    };
  } catch (e) {
    return { configured: true, ok: false, error: String(e).slice(0, 200) };
  }
}

// ── Shopify ───────────────────────────────────────────────────────────────────
async function fetchShopify() {
  const token = Deno.env.get("SHOPIFY_ACCESS_TOKEN");
  const store = Deno.env.get("SHOPIFY_STORE_DOMAIN");
  if (!token || !store) return { configured: false, ok: false, error: "Shopify not configured" };
  const headers = { "X-Shopify-Access-Token": token, "Content-Type": "application/json" };
  const base = `https://${store}/admin/api/2024-01`;
  try {
    const since = isoDaysAgo(30);
    // Paginate the 30-day window via the Link header cursor so revenue isn't
    // truncated at one 250-row page. Cap at 8 pages (2000 orders) for latency.
    let url: string | null =
      `${base}/orders.json?status=any&created_at_min=${encodeURIComponent(since)}&limit=250&fields=id,total_price,currency,created_at`;
    const orders: any[] = [];
    let capped = false;
    for (let page = 0; page < 8 && url; page++) {
      const res: Response = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT) });
      if (!res.ok) {
        if (orders.length) break; // partial data is still useful
        const body = await res.text();
        return { configured: true, ok: false, error: `Shopify ${res.status}: ${body.slice(0, 160)}` };
      }
      const data = await res.json();
      orders.push(...(data.orders ?? []));
      const link = res.headers.get("Link") ?? res.headers.get("link") ?? "";
      const next = link.match(/<([^>]+)>;\s*rel="next"/);
      url = next ? next[1] : null;
      if (page === 7 && url) capped = true;
    }
    const revenue = orders.reduce((s, o) => s + num(o.total_price), 0);
    const byDay: Record<string, number> = {};
    for (const o of orders) {
      const d = (o.created_at ?? "").slice(0, 10);
      if (d) byDay[d] = (byDay[d] ?? 0) + num(o.total_price);
    }
    const timeseries = Object.entries(byDay).sort(([a], [b]) => a.localeCompare(b))
      .map(([date, revenue]) => ({ date, revenue: round(revenue) }));
    return {
      configured: true, ok: true,
      storeDomain: store,
      orders30d: orders.length,
      revenue30d: round(revenue),
      aov: orders.length ? round(revenue / orders.length) : 0,
      currency: orders[0]?.currency ?? "AUD",
      capped,
      timeseries,
    };
  } catch (e) {
    return { configured: true, ok: false, error: String(e).slice(0, 200) };
  }
}

// ── Brevo ─────────────────────────────────────────────────────────────────────
async function fetchBrevo() {
  const key = Deno.env.get("BREVO_API_KEY");
  if (!key) return { configured: false, ok: false, error: "BREVO_API_KEY not set" };
  const headers = { "api-key": key, accept: "application/json" };
  const get = (path: string) =>
    fetch(`https://api.brevo.com/v3/${path}`, { headers, signal: AbortSignal.timeout(TIMEOUT) });
  try {
    const [acctRes, contactsRes, campRes] = await Promise.all([
      get("account"),
      get("contacts?limit=1"),
      get("emailCampaigns?statistics=globalStats&limit=10&sort=desc"),
    ]);
    if (!acctRes.ok && !campRes.ok) {
      const body = await acctRes.text();
      return { configured: true, ok: false, error: `Brevo ${acctRes.status}: ${body.slice(0, 160)}` };
    }
    const contacts = contactsRes.ok ? await contactsRes.json() : { count: 0 };
    const camp = campRes.ok ? await campRes.json() : { campaigns: [] };
    const campaigns = (camp.campaigns ?? []).map((c: any) => {
      const g = c.statistics?.globalStats ?? {};
      const sent = num(g.sent);
      return {
        name: c.name ?? "(untitled)",
        sentDate: c.sentDate ?? c.scheduledAt ?? null,
        status: c.status ?? null,
        sent,
        delivered: num(g.delivered),
        opens: num(g.uniqueViews ?? g.viewed),
        clicks: num(g.uniqueClicks ?? g.clickers),
        openRate: sent ? round((num(g.uniqueViews ?? g.viewed) / sent) * 100, 1) : 0,
        clickRate: sent ? round((num(g.uniqueClicks ?? g.clickers) / sent) * 100, 1) : 0,
      };
    });
    const totals = campaigns.reduce(
      (a: any, c: any) => ({
        sent: a.sent + c.sent, opens: a.opens + c.opens, clicks: a.clicks + c.clicks,
      }),
      { sent: 0, opens: 0, clicks: 0 },
    );
    return {
      configured: true, ok: true,
      totalContacts: num(contacts.count),
      campaignCount: campaigns.length,
      totals: {
        sent: totals.sent, opens: totals.opens, clicks: totals.clicks,
        openRate: totals.sent ? round((totals.opens / totals.sent) * 100, 1) : 0,
        clickRate: totals.sent ? round((totals.clicks / totals.sent) * 100, 1) : 0,
      },
      campaigns,
    };
  } catch (e) {
    return { configured: true, ok: false, error: String(e).slice(0, 200) };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  let body: any = {};
  try { body = await req.json(); } catch { /* no body */ }
  const action = body.action ?? "overview";

  // Lightweight diagnostic — reports which secrets are wired up (no business data).
  if (action === "diag") {
    return json({
      ok: true,
      googleServiceAccountEmail: Deno.env.get("GOOGLE_SERVICE_ACCOUNT_EMAIL") ?? null,
      configured: {
        ga: !!Deno.env.get("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY"),
        gaProperty: Deno.env.get("GA_PROPERTY_ID") ?? null,
        hubspot: !!Deno.env.get("HUBSPOT_ACCESS_TOKEN"),
        shopify: !!Deno.env.get("SHOPIFY_ACCESS_TOKEN") && !!Deno.env.get("SHOPIFY_STORE_DOMAIN"),
        brevo: !!Deno.env.get("BREVO_API_KEY"),
      },
    });
  }

  // Resolve the list of GA4 properties to report on. Prefer GA_PROPERTIES
  // (JSON: [{"label":"AGA","id":"496706418"},...]); fall back to the single
  // GA_PROPERTY_ID; allow a per-request override via body.properties.
  const gaProps: { label: string; id: string }[] = (() => {
    if (Array.isArray(body.properties) && body.properties.length) return body.properties;
    const raw = Deno.env.get("GA_PROPERTIES");
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length) return parsed;
      } catch { /* fall through */ }
    }
    const single = Deno.env.get("GA_PROPERTY_ID");
    return single ? [{ label: "Website", id: single }] : [];
  })();

  const [sites, hubspot, shopify, brevo] = await Promise.all([
    Promise.all(gaProps.map((p) =>
      fetchAnalytics(String(p.id)).then((r) => ({ label: p.label, ...r })))),
    fetchHubspot(),
    fetchShopify(),
    fetchBrevo(),
  ]);

  const analytics = {
    configured: gaProps.length > 0 && sites.some((s) => s.configured),
    ok: sites.some((s) => s.ok),
    sites,
  };

  return json({
    ok: true,
    generatedAt: new Date().toISOString(),
    analytics, hubspot, shopify, brevo,
  });
});
