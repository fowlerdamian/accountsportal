import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from "recharts";
import { Loader2, AlertCircle, Layers } from "lucide-react";
import { palette } from "@portal/lib/palette";
import {
  CHANNELS, UNASSIGNED, UNASSIGNED_META,
  type ChannelKey, type BucketKey,
} from "@portal/lib/channels";
import { usePipelineMetrics, type PipelineMetrics, type PipelineChannel } from "../hooks/usePipeline";
import { useChannelDeals, type ChannelDealStats } from "../hooks/useChannelAnalytics";
import type { DateRange } from "../hooks/useMarketingDashboard";

// ── formatters (match Dashboard.tsx) ──────────────────────────────────────────
const nf = new Intl.NumberFormat("en-AU");
const fmtNum = (n?: number) => (n == null ? "—" : nf.format(n));
const fmtMoney = (n?: number) =>
  n == null ? "—" : new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(n);
const fmtPct = (n?: number | null) => (n == null ? "—" : `${n}%`);
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

// ── primitives (match Dashboard.tsx styling exactly) ──────────────────────────
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

function Mini({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="bg-muted/30 rounded-lg p-3">
      <div className="text-lg font-bold tabular-nums" style={accent ? { color: accent } : undefined}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-xs text-muted-foreground bg-muted/20 rounded-lg p-3 leading-relaxed">{children}</div>
  );
}

// ── per-channel KPI column ────────────────────────────────────────────────────
function ChannelCard({ label, accent, who, lead, deal }: {
  label: string; accent: string; who: string;
  lead?: PipelineMetrics; deal?: ChannelDealStats;
}) {
  return (
    <div className="rounded-xl border border-border bg-card/50 p-4 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="w-2.5 h-2.5 rounded-full" style={{ background: accent }} />
        <h3 className="text-sm font-bold">{label}</h3>
      </div>
      <p className="text-[11px] text-muted-foreground leading-snug -mt-1">{who}</p>
      <div className="grid grid-cols-2 gap-2">
        <Mini label="Active customers" value={fmtNum(deal?.activeCustomers)} accent={accent} />
        <Mini label="New leads" value={fmtNum(lead?.newLeads)} />
        <Mini label="Open pipeline" value={fmtMoney(deal?.openValue)} />
        <Mini label="Deals won" value={fmtNum(deal?.wonCount)} />
        <Mini label="Win rate" value={fmtPct(deal?.winRate)} />
        <Mini label="Won value" value={fmtMoney(deal?.wonValue)} />
      </div>
    </div>
  );
}

// ── per-channel conversion funnel (lead status) ───────────────────────────────
function MiniFunnel({ m, accent }: { m: PipelineMetrics; accent: string }) {
  if (!m.statusFunnel.length) return <Empty>No leads in this channel for the period.</Empty>;
  const max = Math.max(1, ...m.statusFunnel.map((s) => s.count));
  return (
    <div className="space-y-2">
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

// ── main view ─────────────────────────────────────────────────────────────────
export default function ChannelAnalytics({ range, periodText }: { range: DateRange; periodText: string }) {
  // Lead-side: reuse the EXISTING hook, once per channel (fixed order).
  const tb = usePipelineMetrics("trailbait" as PipelineChannel, range);
  const fc = usePipelineMetrics("fleetcraft", range);
  const aga = usePipelineMetrics("aga", range);
  const leadByKey: Record<ChannelKey, ReturnType<typeof usePipelineMetrics>> = {
    trailbait: tb, fleetcraft: fc, aga,
  };

  // Deal-side: the new isolated edge function.
  const deals = useChannelDeals(range);

  const leadLoading = tb.isLoading || fc.isLoading || aga.isLoading;
  const leadError = tb.error || fc.error || aga.error;

  if (leadLoading || deals.isLoading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }
  if (leadError || deals.isError) {
    const msg = (leadError as Error)?.message || (deals.error as Error)?.message;
    return (
      <div className="flex items-start gap-2 text-sm text-[var(--brand-pink)] bg-[rgba(158,42,43,0.12)] rounded-lg p-4">
        <AlertCircle className="w-5 h-5 shrink-0" />
        <span>Couldn't load channel analytics: {msg}</span>
      </div>
    );
  }

  const dealBuckets = deals.data?.buckets;
  const stages = deals.data?.stages ?? [];
  const dealFor = (k: BucketKey) => dealBuckets?.[k];

  // Channel mix — share of open pipeline value and of active customers.
  const totalOpen = CHANNELS.reduce((s, c) => s + (dealFor(c.key)?.openValue ?? 0), 0);
  const totalCust = CHANNELS.reduce((s, c) => s + (dealFor(c.key)?.activeCustomers ?? 0), 0);

  // Pipeline by stage × channel (stacked bar): one row per stage, a key per channel.
  const stageData = stages.map((st) => {
    const row: Record<string, number | string> = { stage: st.label };
    for (const c of CHANNELS) {
      row[c.key] = dealFor(c.key)?.byStage.find((b) => b.stageId === st.stageId)?.count ?? 0;
    }
    return row;
  });

  // New-leads trend by channel — merge the three generationSeries on date.
  const trendMap = new Map<string, Record<string, number | string>>();
  for (const c of CHANNELS) {
    for (const pt of leadByKey[c.key].data?.generationSeries ?? []) {
      const row = trendMap.get(pt.date) ?? { date: pt.date };
      row[c.key] = pt.leads;
      trendMap.set(pt.date, row);
    }
  }
  const trendData = [...trendMap.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));

  const unassigned = dealFor(UNASSIGNED);
  const hasUnassigned = !!unassigned && unassigned.totalDeals > 0;

  return (
    <div className="space-y-6">
      {/* per-channel KPI cards — taxonomy order */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {CHANNELS.map((c) => (
          <ChannelCard
            key={c.key}
            label={c.label}
            accent={c.accent()}
            who={c.who}
            lead={leadByKey[c.key].data}
            deal={dealFor(c.key)}
          />
        ))}
      </div>

      {/* Unassigned — surfaced, never hidden */}
      {hasUnassigned && (
        <div className="rounded-xl border border-border bg-card/50 p-4 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: UNASSIGNED_META.accent() }} />
            <span className="font-semibold">{UNASSIGNED_META.label}</span>
            <span className="text-xs text-muted-foreground">· {UNASSIGNED_META.who}</span>
          </div>
          <div className="flex items-center gap-4 text-xs tabular-nums">
            <span>{fmtNum(unassigned!.totalDeals)} deals</span>
            <span className="text-muted-foreground">open {fmtMoney(unassigned!.openValue)}</span>
          </div>
        </div>
      )}

      {/* Channel mix */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel title="Channel mix — open pipeline value" accent={palette.accent}>
          {totalOpen > 0 ? (
            <MixBars
              rows={CHANNELS.map((c) => ({
                key: c.key, label: c.label, accent: c.accent(),
                value: dealFor(c.key)?.openValue ?? 0,
              }))}
              total={totalOpen}
              fmt={fmtMoney}
            />
          ) : <Empty>No open pipeline value across channels yet.</Empty>}
        </Panel>
        <Panel title="Channel mix — active customers" accent={palette.blue}>
          {totalCust > 0 ? (
            <MixBars
              rows={CHANNELS.map((c) => ({
                key: c.key, label: c.label, accent: c.accent(),
                value: dealFor(c.key)?.activeCustomers ?? 0,
              }))}
              total={totalCust}
              fmt={(n) => fmtNum(n)}
            />
          ) : <Empty>No customers with a won deal yet.</Empty>}
        </Panel>
      </div>

      {/* Pipeline by stage × channel */}
      <Panel title="Pipeline by stage × channel" badge="open deals · count" accent={palette.accent}>
        {stageData.length ? (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={stageData} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#222" vertical={false} />
              <XAxis dataKey="stage" tick={{ fontSize: 10, fill: "#777" }} interval={0} angle={-12} textAnchor="end" height={50} />
              <YAxis tick={{ fontSize: 10, fill: "#777" }} width={36} allowDecimals={false} />
              <Tooltip {...TOOLTIP_STYLE} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {CHANNELS.map((c) => (
                <Bar key={c.key} dataKey={c.key} name={c.label} stackId="s" fill={c.accent()} radius={[0, 0, 0, 0]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        ) : <Empty>No open deals with stage data in HubSpot yet.</Empty>}
      </Panel>

      {/* New-leads trend by channel */}
      <Panel title="New leads over time, by channel" badge={periodText} accent={palette.blue}>
        {trendData.length ? (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={trendData} margin={{ top: 4, right: 8, left: -22, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#222" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#777" }} tickFormatter={fmtDate} minTickGap={24} />
              <YAxis tick={{ fontSize: 10, fill: "#777" }} width={32} allowDecimals={false} />
              <Tooltip {...TOOLTIP_STYLE} labelFormatter={fmtDate} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {CHANNELS.map((c) => (
                <Line key={c.key} type="monotone" dataKey={c.key} name={c.label}
                  stroke={c.accent()} strokeWidth={2} dot={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        ) : <Empty>No leads discovered in the selected period.</Empty>}
      </Panel>

      {/* Conversion funnel per channel */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {CHANNELS.map((c) => (
          <Panel key={c.key} title={`${c.label} funnel`} badge="this period" accent={c.accent()}>
            {leadByKey[c.key].data
              ? <MiniFunnel m={leadByKey[c.key].data!} accent={c.accent()} />
              : <Empty>No data.</Empty>}
          </Panel>
        ))}
      </div>

      {/* Top accounts per channel */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {CHANNELS.map((c) => {
          const top = dealFor(c.key)?.topAccounts ?? [];
          return (
            <Panel key={c.key} title={`${c.label} — top accounts`} badge="by deal value" accent={c.accent()}>
              {top.length ? (
                <div className="space-y-1.5">
                  {top.map((a, i) => (
                    <div key={i} className="flex items-center justify-between text-xs gap-2">
                      <span className="truncate" title={a.account}>{a.account}</span>
                      <span className="flex items-center gap-2 shrink-0">
                        <span className="tabular-nums font-medium">{fmtMoney(a.amount)}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${a.isOpen ? "bg-muted/40 text-muted-foreground" : "bg-muted/20 text-muted-foreground"}`}>
                          {a.isOpen ? "open" : "closed"}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              ) : <Empty>No deals for this channel yet.</Empty>}
            </Panel>
          );
        })}
      </div>

      <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
        <Layers className="w-3.5 h-3.5" />
        Leads &amp; funnel from sales pipeline (Postgres); customers, pipeline value, deals &amp; win rate from HubSpot deals.
        {deals.data?.generatedAt && ` Updated ${new Date(deals.data.generatedAt).toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" })}.`}
      </p>
    </div>
  );
}

// ── share-of-total horizontal bars ────────────────────────────────────────────
function MixBars({ rows, total, fmt }: {
  rows: { key: string; label: string; accent: string; value: number }[];
  total: number; fmt: (n: number) => string;
}) {
  return (
    <div className="space-y-3">
      {rows.map((r) => {
        const pct = total ? Math.round((r.value / total) * 100) : 0;
        return (
          <div key={r.key}>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-muted-foreground">{r.label}</span>
              <span className="tabular-nums font-medium">{fmt(r.value)} · {pct}%</span>
            </div>
            <div className="h-2.5 rounded-full bg-muted/30 overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${pct}%`, background: r.accent }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
