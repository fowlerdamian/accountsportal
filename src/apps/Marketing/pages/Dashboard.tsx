import { useState } from "react";
import { palette } from "@portal/lib/palette";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from "recharts";
import {
  RefreshCw, Loader2, AlertCircle, Users, ShoppingCart, Mail, BarChart3,
  TrendingUp, MousePointerClick, Eye, DollarSign, Contact, Handshake,
} from "lucide-react";
import {
  useMarketingDashboard,
  type SourceBase, type AnalyticsData, type AnalyticsSite, type HubspotData,
  type ShopifyData, type BrevoData,
} from "../hooks/useMarketingDashboard";

// ── formatters ────────────────────────────────────────────────────────────
const nf = new Intl.NumberFormat("en-AU");
const fmtNum = (n?: number) => (n == null ? "—" : nf.format(n));
const fmtMoney = (n?: number, ccy = "AUD") =>
  n == null ? "—" : new Intl.NumberFormat("en-AU", { style: "currency", currency: ccy, maximumFractionDigits: 0 }).format(n);
const fmtPct = (n?: number) => (n == null ? "—" : `${n}%`);
const fmtDate = (s?: string | null) =>
  !s ? "—" : new Date(s).toLocaleDateString("en-AU", { day: "numeric", month: "short" });

const TOOLTIP_STYLE = {
  contentStyle: { background: "#1a1a1a", border: "1px solid #333", borderRadius: 8, fontSize: 12 },
  labelStyle: { color: "#aaa" },
};

// ── primitives ──────────────────────────────────────────────────────────────
function StatCard({ icon: Icon, label, value, sub, accent }: {
  icon: any; label: string; value: string; sub?: string; accent?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card/50 p-4 flex flex-col gap-1">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="w-3.5 h-3.5" style={{ color: accent ?? palette.accent }} />
        <span className="uppercase tracking-wider font-semibold">{label}</span>
      </div>
      <div className="text-2xl font-bold tabular-nums">{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

function SourceCard({ title, badge, accent, source, children }: {
  title: string; badge?: string; accent: string; source: SourceBase; children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card/50 p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: accent }} />
          <h3 className="text-sm font-semibold">{title}</h3>
          {badge && <span className="text-xs text-muted-foreground">· {badge}</span>}
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full ${
          source.ok ? "bg-[rgba(51,92,103,0.18)] text-[var(--brand-aqua)]"
                    : "bg-[rgba(158,42,43,0.15)] text-[var(--brand-pink)]"
        }`}>
          {source.ok ? "Connected" : source.configured ? "Action needed" : "Not connected"}
        </span>
      </div>
      {source.ok ? children : <NotConnected source={source} />}
    </div>
  );
}

function NotConnected({ source }: { source: SourceBase }) {
  return (
    <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/20 rounded-lg p-3">
      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-[var(--brand-pink)]" />
      <span className="leading-relaxed break-words">
        {source.error || "This integration is not configured yet."}
      </span>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-muted/30 rounded-lg p-3">
      <div className="text-lg font-bold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

// ── source panels ─────────────────────────────────────────────────────────
function SiteAnalytics({ s }: { s: AnalyticsSite }) {
  if (!s.ok) return <NotConnected source={s} />;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Mini label="Active users" value={fmtNum(s.activeUsers)} />
        <Mini label="Sessions" value={fmtNum(s.sessions)} />
        <Mini label="Page views" value={fmtNum(s.pageViews)} />
        <Mini label="Key events" value={fmtNum(s.keyEvents)} />
      </div>
      {!!s.timeseries?.length ? (
        <ResponsiveContainer width="100%" height={140}>
          <AreaChart data={s.timeseries} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
            <defs>
              <linearGradient id="ga" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={palette.aqua} stopOpacity={0.5} />
                <stop offset="100%" stopColor={palette.aqua} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#222" vertical={false} />
            <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#777" }} tickFormatter={fmtDate} minTickGap={24} />
            <YAxis tick={{ fontSize: 10, fill: "#777" }} width={36} />
            <Tooltip {...TOOLTIP_STYLE} labelFormatter={fmtDate} />
            <Area type="monotone" dataKey="sessions" stroke={palette.aqua} fill="url(#ga)" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      ) : (
        <div className="text-xs text-muted-foreground bg-muted/20 rounded-lg p-3">
          No traffic in the last 28 days yet — data appears within ~24–48h of the tag going live.
        </div>
      )}
      {!!s.channels?.length && (
        <div className="space-y-1.5">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Top channels</div>
          {s.channels.slice(0, 5).map((c) => (
            <div key={c.channel} className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">{c.channel}</span>
              <span className="tabular-nums font-medium">{fmtNum(c.sessions)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AnalyticsPanel({ d }: { d: AnalyticsData }) {
  const sites = d.sites ?? [];
  const [active, setActive] = useState(0);
  if (!sites.length) return <NotConnected source={d} />;
  const sel = sites[Math.min(active, sites.length - 1)];
  return (
    <div className="space-y-4">
      {sites.length > 1 && (
        <div className="inline-flex rounded-lg bg-muted/30 p-0.5 text-xs">
          {sites.map((s, i) => (
            <button
              key={s.label + i}
              onClick={() => setActive(i)}
              className={`px-3 py-1 rounded-md transition-colors ${
                i === active ? "bg-[var(--brand-purple)] text-white" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}
      <SiteAnalytics s={sel} />
    </div>
  );
}

function ShopifyPanel({ d }: { d: ShopifyData }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        <Mini label="Revenue (30d)" value={fmtMoney(d.revenue30d, d.currency)} />
        <Mini label={`Orders (30d)${d.capped ? "+" : ""}`} value={fmtNum(d.orders30d)} />
        <Mini label="Avg order" value={fmtMoney(d.aov, d.currency)} />
      </div>
      {!!d.timeseries?.length && (
        <ResponsiveContainer width="100%" height={140}>
          <BarChart data={d.timeseries} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#222" vertical={false} />
            <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#777" }} tickFormatter={fmtDate} minTickGap={24} />
            <YAxis tick={{ fontSize: 10, fill: "#777" }} width={44}
              tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : v)} />
            <Tooltip {...TOOLTIP_STYLE} labelFormatter={fmtDate}
              formatter={(v: any) => [fmtMoney(Number(v), d.currency), "Revenue"]} />
            <Bar dataKey="revenue" fill={palette.accent} radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
      <div className="text-xs text-muted-foreground">{d.storeDomain}</div>
    </div>
  );
}

function HubspotPanel({ d }: { d: HubspotData }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <Mini label="Total contacts" value={fmtNum(d.totalContacts)} />
        <Mini label="New (30d)" value={fmtNum(d.newContacts30d)} />
        <Mini label="Open deals" value={fmtNum(d.openDeals)} />
        <Mini label="Open pipeline" value={fmtMoney(d.openDealsValue)} />
      </div>
      <div className="text-xs text-muted-foreground">
        {fmtNum(d.newContacts30d)} contacts added in the last 30 days.
      </div>
    </div>
  );
}

function BrevoPanel({ d }: { d: BrevoData }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Mini label="Contacts" value={fmtNum(d.totalContacts)} />
        <Mini label="Emails sent" value={fmtNum(d.totals?.sent)} />
        <Mini label="Open rate" value={fmtPct(d.totals?.openRate)} />
        <Mini label="Click rate" value={fmtPct(d.totals?.clickRate)} />
      </div>
      {!!d.campaigns?.length && (
        <div className="space-y-1">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Recent campaigns</div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted-foreground text-left">
                  <th className="font-medium pb-1.5 pr-2">Campaign</th>
                  <th className="font-medium pb-1.5 px-2 text-right">Sent</th>
                  <th className="font-medium pb-1.5 px-2 text-right">Open</th>
                  <th className="font-medium pb-1.5 pl-2 text-right">Click</th>
                </tr>
              </thead>
              <tbody>
                {d.campaigns.filter((c) => c.sent > 0).slice(0, 6).map((c, i) => (
                  <tr key={i} className="border-t border-border/50">
                    <td className="py-1.5 pr-2 truncate max-w-[180px]" title={c.name}>{c.name}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums">{fmtNum(c.sent)}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums">{fmtPct(c.openRate)}</td>
                    <td className="py-1.5 pl-2 text-right tabular-nums">{fmtPct(c.clickRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── page ────────────────────────────────────────────────────────────────────
export default function MarketingDashboard() {
  const { data, isLoading, isError, error, refetch, isFetching } = useMarketingDashboard();

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <TrendingUp className="w-5 h-5" style={{ color: palette.accent }} />
            Marketing
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Analytics, HubSpot, Shopify &amp; Brevo — last 28–30 days
            {data?.generatedAt && ` · updated ${new Date(data.generatedAt).toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" })}`}
          </p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-2 text-xs bg-primary text-primary-foreground rounded-lg px-3 py-2 hover:bg-primary/90 disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-24 text-muted-foreground">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      )}

      {isError && (
        <div className="flex items-start gap-2 text-sm text-[var(--brand-pink)] bg-[rgba(158,42,43,0.12)] rounded-lg p-4">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span>Couldn't load dashboard: {(error as Error)?.message}</span>
        </div>
      )}

      {data && (
        <div className="space-y-6">
          {/* Hero KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard icon={ShoppingCart} accent={palette.accent} label="Shopify revenue"
              value={data.shopify.ok ? fmtMoney(data.shopify.revenue30d, data.shopify.currency) : "—"}
              sub={data.shopify.ok ? `${fmtNum(data.shopify.orders30d)} orders · 30d` : "Not connected"} />
            <StatCard icon={Contact} accent={palette.aqua} label="HubSpot contacts"
              value={data.hubspot.ok ? fmtNum(data.hubspot.totalContacts) : "—"}
              sub={data.hubspot.ok ? `+${fmtNum(data.hubspot.newContacts30d)} this month` : "Not connected"} />
            <StatCard icon={Mail} accent={palette.pink} label="Brevo open rate"
              value={data.brevo.ok ? fmtPct(data.brevo.totals?.openRate) : "—"}
              sub={data.brevo.ok ? `${fmtNum(data.brevo.totals?.sent)} sent` : "Not connected"} />
            <StatCard icon={BarChart3} accent={palette.purple} label="GA active users"
              value={data.analytics.ok ? fmtNum((data.analytics.sites ?? []).reduce((a, s) => a + (s.activeUsers ?? 0), 0)) : "—"}
              sub={data.analytics.ok ? `${(data.analytics.sites ?? []).filter((s) => s.ok).length} sites · 28d` : "Action needed"} />
          </div>

          {/* Source panels */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <SourceCard title="Shopify" badge="Store" accent={palette.accent} source={data.shopify}>
              <ShopifyPanel d={data.shopify} />
            </SourceCard>
            <SourceCard title="Google Analytics" badge="GA4" accent={palette.purple} source={data.analytics}>
              <AnalyticsPanel d={data.analytics} />
            </SourceCard>
            <SourceCard title="HubSpot" badge="CRM" accent={palette.aqua} source={data.hubspot}>
              <HubspotPanel d={data.hubspot} />
            </SourceCard>
            <SourceCard title="Brevo" badge="Email" accent={palette.pink} source={data.brevo}>
              <BrevoPanel d={data.brevo} />
            </SourceCard>
          </div>
        </div>
      )}
    </div>
  );
}
