import { useState } from "react";
import { palette } from "@portal/lib/palette";
import {
  BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  RefreshCw, Loader2, AlertCircle, ShoppingCart, Mail, TrendingUp, MousePointerClick,
  DollarSign, Users, Flame, PhoneCall, Sparkles, GitBranch, BarChart3,
} from "lucide-react";
import {
  useTrailbaitDashboard, useBrandWebsite,
  type TrailbaitDashboard, type MarketingSegment, type ShopSegment, type EmailSegment,
  type WebsiteAnalytics,
} from "../hooks/useMarketingDashboard";
import { usePipelineMetrics, type PipelineMetrics, type PipelineChannel } from "../hooks/usePipeline";
import { GRAINS, buildOptions, defaultAnchor, dateRange, type Grain } from "../lib/periods";

// ── brands ──────────────────────────────────────────────────────────────────
type Brand = "trailbait" | "aga" | "fleetcraft";
type Segment = "consumer" | "b2b";

const BRANDS: { key: Brand; label: string; tagline: string; site: string; accent: () => string }[] = [
  { key: "trailbait",  label: "TrailBait",  tagline: "Ecommerce & email", site: "trailbait.com.au",              accent: () => palette.accent },
  { key: "aga",        label: "AGA",        tagline: "B2B pipeline",      site: "automotivegroupaustralia.com.au", accent: () => palette.pink },
  { key: "fleetcraft", label: "FleetCraft", tagline: "B2B pipeline",      site: "fleetcraft.com.au",             accent: () => palette.blue },
];

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

const STATUS_LABEL: Record<string, string> = {
  new: "New", enriched: "Enriched", scored: "Scored", qualified: "Qualified",
  contacted: "Contacted", converted: "Converted", disqualified: "Disqualified",
};
const statusLabel = (s: string) => STATUS_LABEL[s] ?? s.charAt(0).toUpperCase() + s.slice(1);

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

function Panel({ title, badge, accent, children }: {
  title: string; badge?: string; accent: string; children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card/50 p-5">
      <div className="flex items-center gap-2 mb-4">
        <span className="w-2.5 h-2.5 rounded-full" style={{ background: accent }} />
        <h3 className="text-sm font-semibold">{title}</h3>
        {badge && <span className="text-xs text-muted-foreground">· {badge}</span>}
      </div>
      {children}
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

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-xs text-muted-foreground bg-muted/20 rounded-lg p-3 leading-relaxed">
      {children}
    </div>
  );
}

// ── Website (GA4) panel — shared by every brand ──────────────────────────────
function WebsiteBody({ w, accent }: { w: WebsiteAnalytics; accent: string }) {
  if (!w.ok) {
    return (
      <Empty>
        <span className="inline-flex items-center gap-1.5 text-[var(--brand-pink)]">
          <AlertCircle className="w-3.5 h-3.5" /> Analytics: {w.error || "not connected"}
        </span>
      </Empty>
    );
  }
  const hasTraffic = (w.sessions ?? 0) > 0 || (w.timeseries?.length ?? 0) > 0;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Mini label="Active users" value={fmtNum(w.activeUsers)} />
        <Mini label="Sessions" value={fmtNum(w.sessions)} />
        <Mini label="Page views" value={fmtNum(w.pageViews)} />
        <Mini label="Key events" value={fmtNum(w.keyEvents)} />
      </div>
      {hasTraffic && w.timeseries?.length ? (
        <ResponsiveContainer width="100%" height={150}>
          <AreaChart data={w.timeseries} margin={{ top: 4, right: 8, left: -22, bottom: 0 }}>
            <defs>
              <linearGradient id="ga-sessions" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={accent} stopOpacity={0.5} />
                <stop offset="100%" stopColor={accent} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#222" vertical={false} />
            <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#777" }} tickFormatter={fmtDate} minTickGap={24} />
            <YAxis tick={{ fontSize: 10, fill: "#777" }} width={32} allowDecimals={false} />
            <Tooltip {...TOOLTIP_STYLE} labelFormatter={fmtDate}
              formatter={(v: any) => [fmtNum(Number(v)), "Sessions"]} />
            <Area type="monotone" dataKey="sessions" stroke={accent} fill="url(#ga-sessions)" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      ) : (
        <Empty>No traffic in this period yet — newly-installed tags take ~24–48h to start collecting.</Empty>
      )}
      {!!w.channels?.length && (
        <div className="space-y-1.5">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Top channels</div>
          {w.channels.slice(0, 5).map((c) => (
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

// ── TrailBait segment panels ─────────────────────────────────────────────────
function ShopifySegmentPanel({ d, accent }: { d: ShopSegment; accent: string }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        <Mini label="Revenue" value={fmtMoney(d.revenue, d.currency)} />
        <Mini label={`Orders${d.capped ? "+" : ""}`} value={fmtNum(d.orders)} />
        <Mini label="Avg order" value={fmtMoney(d.aov, d.currency)} />
      </div>
      {d.timeseries.length ? (
        <ResponsiveContainer width="100%" height={150}>
          <BarChart data={d.timeseries} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#222" vertical={false} />
            <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#777" }} tickFormatter={fmtDate} minTickGap={24} />
            <YAxis tick={{ fontSize: 10, fill: "#777" }} width={44}
              tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : v)} />
            <Tooltip {...TOOLTIP_STYLE} labelFormatter={fmtDate}
              formatter={(v: any) => [fmtMoney(Number(v), d.currency), "Revenue"]} />
            <Bar dataKey="revenue" fill={accent} radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <Empty>No orders in this segment for the selected period.</Empty>
      )}
    </div>
  );
}

function EmailSegmentPanel({ d, accent }: { d: EmailSegment; accent: string }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Mini label="Emails sent" value={fmtNum(d.sent)} />
        <Mini label="Open rate" value={fmtPct(d.openRate)} />
        <Mini label="Click rate" value={fmtPct(d.clickRate)} />
        <Mini label="Campaigns" value={fmtNum(d.campaignCount)} />
      </div>
      {d.campaigns.length ? (
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
              {d.campaigns.map((c, i) => (
                <tr key={i} className="border-t border-border/50">
                  <td className="py-1.5 pr-2 truncate max-w-[200px]" title={c.name}>{c.name}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums">{fmtNum(c.sent)}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums">{fmtPct(c.openRate)}</td>
                  <td className="py-1.5 pl-2 text-right tabular-nums">{fmtPct(c.clickRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty>No campaigns sent to this segment in the selected period.</Empty>
      )}
    </div>
  );
}

function TrailbaitView({ data, accent, site }: { data: TrailbaitDashboard; accent: string; site: string }) {
  const [segment, setSegment] = useState<Segment>("consumer");
  const seg: MarketingSegment = data[segment];
  const ccy = data.currency || "AUD";

  return (
    <div className="space-y-6">
      {/* segment toggle */}
      <div className="inline-flex rounded-lg bg-muted/30 p-0.5 text-xs">
        {(["consumer", "b2b"] as Segment[]).map((s) => (
          <button
            key={s}
            onClick={() => setSegment(s)}
            className={`px-4 py-1.5 rounded-md transition-colors font-medium ${
              segment === s ? "text-white" : "text-muted-foreground hover:text-foreground"
            }`}
            style={segment === s ? { background: accent } : undefined}
          >
            {s === "consumer" ? "Consumer" : "B2B"}
          </button>
        ))}
      </div>

      {!data.shopify.ok && (
        <Empty>
          <span className="inline-flex items-center gap-1.5 text-[var(--brand-pink)]">
            <AlertCircle className="w-3.5 h-3.5" /> Shopify: {data.shopify.error || "not connected"}
          </span>
        </Empty>
      )}

      {/* hero KPIs for the active segment */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard icon={DollarSign} accent={accent} label="Revenue"
          value={fmtMoney(seg.shopify.revenue, ccy)} sub={`${fmtNum(seg.shopify.orders)} orders`} />
        <StatCard icon={ShoppingCart} accent={accent} label="Avg order"
          value={fmtMoney(seg.shopify.aov, ccy)} sub={segment === "b2b" ? "Distributor accounts" : "Consumer accounts"} />
        <StatCard icon={Mail} accent={palette.aqua} label="Email open rate"
          value={fmtPct(seg.email.openRate)} sub={`${fmtNum(seg.email.sent)} sent`} />
        <StatCard icon={MousePointerClick} accent={palette.purple} label="Email click rate"
          value={fmtPct(seg.email.clickRate)} sub={`${fmtNum(seg.email.campaignCount)} campaigns`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel title="Shopify sales" badge={segment === "b2b" ? "B2B · TIER accounts" : "Consumer"} accent={accent}>
          <ShopifySegmentPanel d={seg.shopify} accent={accent} />
        </Panel>
        <Panel title="Email engagement" badge={segment === "b2b" ? "Distributor lists" : "End-user list"} accent={palette.aqua}>
          {data.email.ok ? <EmailSegmentPanel d={seg.email} accent={accent} />
            : <Empty><span className="inline-flex items-center gap-1.5 text-[var(--brand-pink)]"><AlertCircle className="w-3.5 h-3.5" /> Brevo: {data.email.error || "not connected"}</span></Empty>}
        </Panel>
      </div>

      {/* Whole-store website traffic — not segmented (GA4 can't see the TIER tag). */}
      <Panel title="Website traffic" badge={`${site} · whole store`} accent={palette.purple}>
        <WebsiteBody w={data.website} accent={palette.purple} />
      </Panel>
    </div>
  );
}

// ── AGA / FleetCraft pipeline view ───────────────────────────────────────────
function PipelineFunnel({ m, accent }: { m: PipelineMetrics; accent: string }) {
  const max = Math.max(1, ...m.statusFunnel.map((s) => s.count));
  return (
    <div className="space-y-2.5">
      {m.statusFunnel.map((s) => (
        <div key={s.status}>
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-muted-foreground">{statusLabel(s.status)}</span>
            <span className="tabular-nums font-medium">{fmtNum(s.count)}</span>
          </div>
          <div className="h-2 rounded-full bg-muted/30 overflow-hidden">
            <div className="h-full rounded-full"
              style={{ width: `${(s.count / max) * 100}%`, background: s.status === "disqualified" ? palette.pink : accent }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function PipelineView({ m, accent, website, site }: {
  m: PipelineMetrics; accent: string; website?: WebsiteAnalytics; site: string;
}) {
  const keepRate = m.newLeads ? Math.round((m.activeLeads / m.newLeads) * 100) : 0;
  return (
    <div className="space-y-6">
      {/* hero KPIs — all period-bound */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard icon={Sparkles} accent={accent} label="New leads"
          value={fmtNum(m.newLeads)} sub="discovered this period" />
        <StatCard icon={Users} accent={palette.aqua} label="Active pipeline"
          value={fmtNum(m.activeLeads)} sub={`${keepRate}% kept (not disqualified)`} />
        <StatCard icon={Flame} accent={palette.orange} label="Hot leads"
          value={fmtNum(m.qualified)} sub={`${fmtNum(m.warm)} warm`} />
        <StatCard icon={BarChart3} accent={palette.purple} label="Website sessions"
          value={fmtNum(website?.sessions)} sub={`${fmtNum(website?.activeUsers)} users`} />
      </div>

      {/* Brand website traffic — period-bound. */}
      <Panel title="Website traffic" badge={site} accent={palette.purple}>
        {website ? <WebsiteBody w={website} accent={palette.purple} />
          : <div className="flex items-center justify-center py-6 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /></div>}
      </Panel>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel title="Pipeline funnel" badge="discovered this period" accent={accent}>
          {m.statusFunnel.length ? <PipelineFunnel m={m} accent={accent} />
            : <Empty>No leads in this channel yet.</Empty>}
          <div className="mt-4 pt-3 border-t border-border/50 flex items-center justify-between text-xs">
            <span className="text-muted-foreground inline-flex items-center gap-1.5">
              <GitBranch className="w-3.5 h-3.5" /> Synced to CRM
            </span>
            <span className="tabular-nums font-medium">{fmtNum(m.syncedToCrm)} leads</span>
          </div>
        </Panel>

        <Panel title="Lead generation" badge="this period" accent={accent}>
          {m.generationSeries.length ? (
            <ResponsiveContainer width="100%" height={150}>
              <AreaChart data={m.generationSeries} margin={{ top: 4, right: 8, left: -22, bottom: 0 }}>
                <defs>
                  <linearGradient id="leadgen" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={accent} stopOpacity={0.5} />
                    <stop offset="100%" stopColor={accent} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#222" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#777" }} tickFormatter={fmtDate} minTickGap={24} />
                <YAxis tick={{ fontSize: 10, fill: "#777" }} width={32} allowDecimals={false} />
                <Tooltip {...TOOLTIP_STYLE} labelFormatter={fmtDate}
                  formatter={(v: any) => [fmtNum(Number(v)), "New leads"]} />
                <Area type="monotone" dataKey="leads" stroke={accent} fill="url(#leadgen)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <Empty>No new leads discovered in the selected period.</Empty>
          )}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Mini label="New this period" value={fmtNum(m.newLeads)} />
            <Mini label="Total discovered" value={fmtNum(m.totalLeads)} />
          </div>
        </Panel>

        <Panel title="Outbound activity" badge="call list · this period" accent={accent}>
          <div className="grid grid-cols-2 gap-2">
            <Mini label="Prospects queued" value={fmtNum(m.callsQueued)} />
            <Mini label="Calls completed" value={fmtNum(m.callsCompleted)} />
          </div>
          <div className="mt-3 text-xs text-muted-foreground inline-flex items-center gap-1.5">
            <PhoneCall className="w-3.5 h-3.5" style={{ color: accent }} />
            {m.callsQueued
              ? `${fmtNum(m.callsQueued)} prospects prioritised for outreach in this window.`
              : "No prospects queued for outreach in this period."}
          </div>
        </Panel>

        <Panel title="Lead quality" badge="active · this period" accent={accent}>
          <div className="grid grid-cols-3 gap-2">
            <Mini label="Hot (≥70)" value={fmtNum(m.qualified)} />
            <Mini label="Warm (45–69)" value={fmtNum(m.warm)} />
            <Mini label="Cold (<45)" value={fmtNum(Math.max(0, m.activeLeads - m.qualified - m.warm))} />
          </div>
          <div className="mt-4 h-2.5 rounded-full overflow-hidden flex">
            {[
              { v: m.qualified, c: palette.aqua },
              { v: m.warm, c: palette.orange },
              { v: Math.max(0, m.activeLeads - m.qualified - m.warm), c: "#444" },
            ].map((b, i) => b.v > 0 && (
              <div key={i} style={{ flex: b.v, background: b.c }} />
            ))}
          </div>
          <div className="mt-3 text-xs text-muted-foreground">
            {fmtNum(m.activeLeads)} active leads · avg score {fmtNum(m.avgScore)}
          </div>
        </Panel>
      </div>
    </div>
  );
}

// ── filter bar ────────────────────────────────────────────────────────────────
function FilterBar({ grain, setGrain, options, anchor, setAnchor }: {
  grain: Grain; setGrain: (g: Grain) => void;
  options: { value: string; label: string }[]; anchor: string; setAnchor: (a: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex rounded-lg bg-muted/30 p-0.5 text-xs font-mono">
        {GRAINS.map((g) => (
          <button
            key={g.key}
            onClick={() => setGrain(g.key)}
            className={`px-2.5 py-1.5 rounded-md transition-colors ${
              grain === g.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {g.label}
          </button>
        ))}
      </div>
      <select
        value={anchor}
        onChange={(e) => setAnchor(e.target.value)}
        className="bg-muted/30 border border-border rounded-lg px-2.5 py-1.5 text-xs font-mono cursor-pointer focus:outline-none focus:ring-1 focus:ring-ring"
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

// ── page ────────────────────────────────────────────────────────────────────
export default function MarketingDashboard() {
  const [brand, setBrand] = useState<Brand>("trailbait");
  const [grain, setGrain] = useState<Grain>("month");
  const [anchor, setAnchor] = useState<string>(() => defaultAnchor("month"));
  const options = buildOptions(grain);
  const range = dateRange(grain, anchor);

  const tb = useTrailbaitDashboard(range);
  const pipelineChannel: PipelineChannel = brand === "fleetcraft" ? "fleetcraft" : "aga";
  const pipe = usePipelineMetrics(pipelineChannel, range, brand !== "trailbait");
  const brandWeb = useBrandWebsite(pipelineChannel, range, brand !== "trailbait");

  const activeBrand = BRANDS.find((b) => b.key === brand)!;
  const accent = activeBrand.accent();
  const periodText = options.find((o) => o.value === anchor)?.label ?? anchor;

  const isTrailbait = brand === "trailbait";
  const isLoading = isTrailbait ? tb.isLoading : pipe.isLoading;
  const isError = isTrailbait ? tb.isError : pipe.isError;
  const error = isTrailbait ? tb.error : pipe.error;
  const isFetching = isTrailbait ? tb.isFetching : (pipe.isFetching || brandWeb.isFetching);
  const generatedAt = isTrailbait ? tb.data?.generatedAt : brandWeb.data?.generatedAt;
  const refetch = () => { if (isTrailbait) { tb.refetch(); } else { pipe.refetch(); brandWeb.refetch(); } };

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <TrendingUp className="w-5 h-5" style={{ color: accent }} />
            Marketing
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {activeBrand.label} · {activeBrand.tagline} — {periodText}
            {generatedAt && ` · updated ${new Date(generatedAt).toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" })}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <FilterBar
            grain={grain}
            setGrain={(g) => { setGrain(g); setAnchor(defaultAnchor(g)); }}
            options={options}
            anchor={anchor}
            setAnchor={setAnchor}
          />
          <button
            onClick={refetch}
            disabled={isFetching}
            className="flex items-center gap-2 text-xs bg-primary text-primary-foreground rounded-lg px-3 py-2 hover:bg-primary/90 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      </div>

      {/* brand tabs */}
      <div className="flex gap-2 mb-6 border-b border-border">
        {BRANDS.map((b) => {
          const on = b.key === brand;
          const a = b.accent();
          return (
            <button
              key={b.key}
              onClick={() => setBrand(b.key)}
              className={`relative px-4 py-2.5 text-sm font-semibold transition-colors ${
                on ? "text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {b.label}
              {on && <span className="absolute left-0 right-0 -bottom-px h-0.5 rounded-full" style={{ background: a }} />}
            </button>
          );
        })}
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-24 text-muted-foreground">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      )}

      {isError && !isLoading && (
        <div className="flex items-start gap-2 text-sm text-[var(--brand-pink)] bg-[rgba(158,42,43,0.12)] rounded-lg p-4">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span>Couldn't load dashboard: {(error as Error)?.message}</span>
        </div>
      )}

      {!isLoading && !isError && isTrailbait && tb.data && (
        <TrailbaitView data={tb.data} accent={accent} site={activeBrand.site} />
      )}
      {!isLoading && !isError && !isTrailbait && pipe.data && (
        <PipelineView m={pipe.data} accent={accent} website={brandWeb.data?.website} site={activeBrand.site} />
      )}
    </div>
  );
}
