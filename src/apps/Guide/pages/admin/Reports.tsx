// Guide Reports — rebuilt 2026-09-04 on the server-side `guide_report` /
// `guide_report_steps` RPCs (migration 20260904000001). Nothing is aggregated
// in the browser any more; the page just lays the numbers out.
//
// Brand colour rule (fixed, never cycled): AGA = dark steel, Trailbait = yellow.
// Every brand-coloured mark is also labelled or legended, so identity never
// rests on colour alone.
import { useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { Download, Loader2, ArrowUpRight, ArrowDownRight, Minus, Flag, ChevronRight, RefreshCw } from "lucide-react";
import { Button } from "@guide/components/ui/button";
import { Badge } from "@guide/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@guide/components/ui/select";
import { supabase } from "@guide/integrations/supabase/client";
import { cn } from "@guide/lib/utils";

// ── Brand palette ────────────────────────────────────────────────────────────
type BrandKey = "aga" | "trailbait";
const BRAND: Record<BrandKey, { label: string; name: string; fill: string; ink: string }> = {
  aga:       { label: "AGA", name: "Automotive Group Australia", fill: "#6b7a90", ink: "#aeb9cc" },
  trailbait: { label: "TB",  name: "Trailbait",                  fill: "#f3ca0f", ink: "#f3ca0f" },
};
const BRAND_ORDER: BrandKey[] = ["aga", "trailbait"];
const brandOf = (k: string) => BRAND[k as BrandKey] ?? { label: k.slice(0, 3).toUpperCase(), name: k, fill: "#8b8b8b", ink: "#bbbbbb" };

// Status hues for delivery outcomes (reserved — never reused for series).
const STATUS = { sent: "#4e8a99", skipped: "#5b5b5b", failed: "#c14f50" };
const SURFACE = "#161616";

// ── RPC payload types ────────────────────────────────────────────────────────
interface Totals {
  sessions: number; sessions_prev: number; started: number; completed: number; completed_prev: number;
  step_views: number; avg_rating: number | null; avg_rating_prev: number | null; ratings: number;
  flags: number; flags_open: number; comments: number; support: number; support_open: number;
  emails_sent: number; emails_skipped: number; emails_failed: number; unmatched_open: number;
}
interface BrandRow { key: string; name: string; colour: string | null; sessions: number; completed: number; sessions_prev: number; guides: number; avg_rating: number | null; ratings: number; emails_sent: number }
interface DailyRow { day: string; brand: string; sessions: number; completed: number }
interface GuideRow { id: string; title: string; product_code: string; slug: string; brands: string[] | null; sessions: number; completed: number; sessions_prev: number; avg_rating: number | null; ratings: number; flags: number; support: number; steps: number }
interface RatingRow { rating: number; n: number }
interface DeliveryDay { day: string; sent: number; skipped: number; failed: number }
interface FlagRow { id: string; guide: string; guide_id: string; step: number | null; comment: string | null; resolved: boolean; created_at: string }
interface Report {
  days: number; since: string; totals: Totals; by_brand: BrandRow[]; daily: DailyRow[]; guides: GuideRow[];
  ratings: RatingRow[]; deliveries_daily: DeliveryDay[]; flags: FlagRow[];
}
interface StepReach { step: number; title: string; reached: number }

function useGuideReport(days: number) {
  return useQuery({
    queryKey: ["guide_report", days],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("guide_report", { p_days: days });
      if (error) throw error;
      return data as unknown as Report;
    },
    staleTime: 60_000,
  });
}
function useGuideSteps(guideId: string | null, days: number) {
  return useQuery({
    queryKey: ["guide_report_steps", guideId, days],
    enabled: !!guideId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("guide_report_steps", { p_guide_id: guideId, p_days: days });
      if (error) throw error;
      return data as unknown as { sessions: number; steps: StepReach[] };
    },
    staleTime: 60_000,
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────
const pct = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 100) : 0);
const fmtDay = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-AU", { day: "numeric", month: "short" });
const fmtWhen = (iso: string) => new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short" });
const csvCell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

/** Every calendar day in the window (Brisbane), oldest first, as YYYY-MM-DD. */
function dayRange(days: number): string[] {
  const out: string[] = [];
  const end = new Date(new Date().toLocaleString("en-US", { timeZone: "Australia/Brisbane" }));
  end.setHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end.getTime() - i * 86_400_000);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
  }
  return out;
}

function Delta({ now, prev, suffix = "", invert = false }: { now: number | null; prev: number | null; suffix?: string; invert?: boolean }) {
  if (now == null || prev == null || prev === 0) return <span className="text-[11px] text-muted-foreground">no prior data</span>;
  const diff = now - prev;
  const rel = Math.round((diff / prev) * 100);
  const good = invert ? diff < 0 : diff > 0;
  const Icon = diff === 0 ? Minus : diff > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-[11px] font-medium", diff === 0 ? "text-muted-foreground" : good ? "text-[var(--brand-aqua)]" : "text-[var(--brand-pink)]")}>
      <Icon className="w-3 h-3" />{diff === 0 ? "flat" : `${rel > 0 ? "+" : ""}${rel}%${suffix}`}
      <span className="text-muted-foreground font-normal ml-1">vs prior</span>
    </span>
  );
}

function Kpi({ label, value, sub, delta }: { label: string; value: ReactNode; sub?: ReactNode; delta?: ReactNode }) {
  return (
    <div className="rounded-lg border bg-card px-4 py-3 min-w-0">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold tabular-nums leading-tight mt-0.5 truncate">{value}</div>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">{delta}{sub}</div>
    </div>
  );
}

function Card({ title, children, className, aside }: { title: string; children: ReactNode; className?: string; aside?: ReactNode }) {
  return (
    <section className={cn("rounded-lg border bg-card p-4", className)}>
      <div className="flex items-center justify-between gap-3 mb-3">
        <h3 className="text-sm font-medium">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

function BrandChip({ k }: { k: string }) {
  const b = brandOf(k);
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground" title={b.name}>
      <span className="inline-block w-2 h-2 rounded-full" style={{ background: b.fill }} aria-hidden />{b.label}
    </span>
  );
}

const TOOLTIP = {
  contentStyle: { background: "#1c1c1c", border: "1px solid #2a2a2a", borderRadius: 8, fontSize: 12, padding: "6px 10px" },
  labelStyle: { color: "#a1a1aa", marginBottom: 2 },
  itemStyle: { color: "#e5e7eb", padding: 0 },
  cursor: { fill: "rgba(255,255,255,0.04)" },
};
const AXIS = { stroke: "#3a3a3a", tick: { fill: "#8a8a8a", fontSize: 11 }, tickLine: false, axisLine: false } as const;

/** Thin horizontal bar with a direct label — used for the HTML-only mini charts. */
function HBar({ label, value, max, fill, suffix, muted }: { label: ReactNode; value: number; max: number; fill: string; suffix?: string; muted?: boolean }) {
  const w = max > 0 ? Math.max(value > 0 ? 2 : 0, (value / max) * 100) : 0;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 text-xs">
      <div className="min-w-0">
        <div className={cn("truncate mb-1", muted ? "text-muted-foreground" : "text-foreground/90")}>{label}</div>
        <div className="h-2 rounded-sm bg-muted/60 overflow-hidden">
          <div className="h-full rounded-sm" style={{ width: `${w}%`, background: fill }} />
        </div>
      </div>
      <div className="tabular-nums text-right w-16 text-foreground/90">{value}{suffix}</div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────
type SortKey = "sessions" | "completion" | "avg_rating" | "flags" | "support" | "title";

export default function Reports() {
  const navigate = useNavigate();
  const [days, setDays] = useState(30);
  const [sort, setSort] = useState<SortKey>("sessions");
  const [selected, setSelected] = useState<string | null>(null);
  const report = useGuideReport(days);
  const steps = useGuideSteps(selected, days);
  const r = report.data;

  // Daily sessions pivoted per brand, every day present so the axis is continuous.
  const daily = useMemo(() => {
    if (!r) return [];
    const byDay = new Map<string, Record<string, number>>();
    for (const d of dayRange(r.days)) byDay.set(d, { aga: 0, trailbait: 0 });
    for (const row of r.daily) {
      const rec = byDay.get(row.day) ?? { aga: 0, trailbait: 0 };
      rec[row.brand] = (rec[row.brand] ?? 0) + row.sessions;
      byDay.set(row.day, rec);
    }
    return [...byDay.entries()].map(([day, v]) => ({ day, label: fmtDay(day), ...v }));
  }, [r]);

  const deliveries = useMemo(() => {
    if (!r) return [];
    const byDay = new Map(r.deliveries_daily.map((d) => [d.day, d]));
    return dayRange(r.days).map((day) => ({ label: fmtDay(day), sent: byDay.get(day)?.sent ?? 0, skipped: byDay.get(day)?.skipped ?? 0, failed: byDay.get(day)?.failed ?? 0 }));
  }, [r]);

  const guides = useMemo(() => {
    if (!r) return [];
    const rows = r.guides.map((g) => ({ ...g, completion: pct(g.completed, g.sessions) }));
    const dir = sort === "title" ? 1 : -1;
    return rows.sort((a, b) => {
      const av = sort === "title" ? a.title : sort === "completion" ? a.completion : (a[sort] ?? -1);
      const bv = sort === "title" ? b.title : sort === "completion" ? b.completion : (b[sort] ?? -1);
      if (av === bv) return b.sessions - a.sessions;
      return (av > bv ? 1 : -1) * dir;
    });
  }, [r, sort]);

  const selectedGuide = guides.find((g) => g.id === selected) ?? null;
  const tickEvery = Math.max(1, Math.ceil(daily.length / 8));

  const exportCSV = () => {
    const header = ["Guide", "Product code", "Brands", "Sessions", "Completed", "Completion %", "Ratings", "Avg rating", "Flags", "Support"].join(",");
    const rows = guides.map((g) => [csvCell(g.title), csvCell(g.product_code), csvCell((g.brands ?? []).join(" ")), g.sessions, g.completed, g.completion, g.ratings, g.avg_rating ?? "", g.flags, g.support].join(","));
    const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `guide-report-${days}d-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  if (report.isLoading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }
  if (report.isError || !r) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm space-y-2" role="alert">
        <div className="font-medium text-destructive">Couldn't load the report</div>
        <div className="text-muted-foreground">{(report.error as any)?.message ?? "Unknown error"}</div>
        <Button variant="outline" size="sm" onClick={() => report.refetch()}><RefreshCw className="w-4 h-4 mr-1.5" /> Retry</Button>
      </div>
    );
  }

  const t = r.totals;
  const completion = pct(t.completed, t.started);
  const completionPrev = t.sessions_prev > 0 ? pct(t.completed_prev, t.sessions_prev) : null;
  const maxRating = Math.max(1, ...r.ratings.map((x) => x.n));
  const brandRows = BRAND_ORDER.map((k) => r.by_brand.find((b) => b.key === k)).filter(Boolean) as BrandRow[];
  const maxBrandSessions = Math.max(1, ...brandRows.map((b) => b.sessions));

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Header + filters */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Reports</h1>
          <p className="text-muted-foreground text-sm">How customers use the installation guides — sessions, completion, ratings and auto-delivery.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="hidden sm:flex items-center gap-3 mr-2" aria-label="Brand legend">
            {BRAND_ORDER.map((k) => <BrandChip key={k} k={k} />)}
          </div>
          <Select value={String(days)} onValueChange={(v) => { setDays(Number(v)); setSelected(null); }}>
            <SelectTrigger className="w-36" aria-label="Period"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
              <SelectItem value="365">Last year</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={exportCSV}><Download className="w-4 h-4 mr-2" /> CSV</Button>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="Sessions" value={t.sessions} delta={<Delta now={t.sessions} prev={t.sessions_prev} />} />
        <Kpi label="Completion" value={`${completion}%`} sub={<span>{t.completed} finished</span>} delta={<Delta now={completion} prev={completionPrev} suffix=" pts" />} />
        <Kpi label="Avg rating" value={t.avg_rating != null ? t.avg_rating.toFixed(1) : "—"} sub={<span>{t.ratings} rating{t.ratings === 1 ? "" : "s"}</span>} delta={<Delta now={t.avg_rating} prev={t.avg_rating_prev} />} />
        <Kpi label="Open flags" value={t.flags_open} sub={<span>{t.flags} raised · {t.comments} comments</span>} />
        <Kpi label="Guides emailed" value={t.emails_sent} sub={<span>{t.emails_skipped} skipped{t.emails_failed ? ` · ${t.emails_failed} failed` : ""}</span>} />
        <Kpi label="Unmatched SKUs" value={t.unmatched_open} sub={<button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={() => navigate("/guide/deliveries")}>SKU mapping</button>} />
      </div>

      {/* Sessions per day + brand scorecard */}
      <div className="grid lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-4">
        <Card title="Guide sessions per day" aside={<span className="text-[11px] text-muted-foreground">stacked by brand</span>}>
          {t.sessions === 0 ? (
            <div className="h-[240px] flex items-center justify-center text-sm text-muted-foreground">No sessions in this period</div>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={daily} margin={{ top: 4, right: 4, left: -20, bottom: 0 }} barCategoryGap="25%">
                <CartesianGrid vertical={false} stroke="#262626" />
                <XAxis dataKey="label" interval={tickEvery - 1} {...AXIS} />
                <YAxis allowDecimals={false} {...AXIS} width={40} />
                <Tooltip {...TOOLTIP} />
                <Legend wrapperStyle={{ fontSize: 11, paddingTop: 6 }} formatter={(v) => brandOf(String(v)).name} />
                <Bar dataKey="aga" name="aga" stackId="s" fill={BRAND.aga.fill} stroke={SURFACE} strokeWidth={1} />
                <Bar dataKey="trailbait" name="trailbait" stackId="s" fill={BRAND.trailbait.fill} stroke={SURFACE} strokeWidth={1} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card title="By brand">
          <div className="space-y-4">
            {brandRows.map((b) => {
              const brand = brandOf(b.key);
              return (
                <div key={b.key} className="rounded-md border p-3" style={{ borderColor: `${brand.fill}55` }}>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="inline-block w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: brand.fill }} aria-hidden />
                      <span className="text-sm font-medium truncate">{b.name}</span>
                    </div>
                    <span className="text-[11px] text-muted-foreground shrink-0">{b.guides} published</span>
                  </div>
                  <HBar label={<span>Sessions <span className="text-muted-foreground">· <Delta now={b.sessions} prev={b.sessions_prev} /></span></span>} value={b.sessions} max={maxBrandSessions} fill={brand.fill} />
                  <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                    <div><div className="text-muted-foreground">Completion</div><div className="tabular-nums font-medium">{pct(b.completed, b.sessions)}%</div></div>
                    <div><div className="text-muted-foreground">Rating</div><div className="tabular-nums font-medium">{b.avg_rating != null ? `${b.avg_rating.toFixed(1)} (${b.ratings})` : "—"}</div></div>
                    <div><div className="text-muted-foreground">Emailed</div><div className="tabular-nums font-medium">{b.emails_sent}</div></div>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      {/* Ratings + deliveries */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Card title="Ratings" aside={<span className="text-[11px] text-muted-foreground">{t.ratings} in period</span>}>
          {t.ratings === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">No ratings yet</div>
          ) : (
            <div className="space-y-2.5">
              {[...r.ratings].reverse().map((x) => (
                <HBar key={x.rating} label={`${x.rating} star${x.rating === 1 ? "" : "s"}`} value={x.n} max={maxRating} fill="var(--brand-accent)" muted={x.n === 0} />
              ))}
            </div>
          )}
        </Card>

        <Card title="Auto-delivery emails per day">
          {t.emails_sent + t.emails_skipped + t.emails_failed === 0 ? (
            <div className="h-[200px] flex items-center justify-center text-sm text-muted-foreground">No deliveries in this period</div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={deliveries} margin={{ top: 4, right: 4, left: -20, bottom: 0 }} barCategoryGap="25%">
                <CartesianGrid vertical={false} stroke="#262626" />
                <XAxis dataKey="label" interval={tickEvery - 1} {...AXIS} />
                <YAxis allowDecimals={false} {...AXIS} width={40} />
                <Tooltip {...TOOLTIP} />
                <Legend wrapperStyle={{ fontSize: 11, paddingTop: 6 }} />
                <Bar dataKey="sent" name="Sent" stackId="d" fill={STATUS.sent} stroke={SURFACE} strokeWidth={1} />
                <Bar dataKey="skipped" name="Skipped" stackId="d" fill={STATUS.skipped} stroke={SURFACE} strokeWidth={1} />
                <Bar dataKey="failed" name="Failed" stackId="d" fill={STATUS.failed} stroke={SURFACE} strokeWidth={1} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      {/* Guide table + drop-off */}
      <div className="grid lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-4 items-start">
        <Card title="Guide performance" aside={
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground hidden sm:inline">Sort</span>
            <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
              <SelectTrigger className="h-7 w-36 text-xs" aria-label="Sort guides"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="sessions">Sessions</SelectItem>
                <SelectItem value="completion">Completion %</SelectItem>
                <SelectItem value="avg_rating">Rating</SelectItem>
                <SelectItem value="flags">Flags</SelectItem>
                <SelectItem value="support">Support</SelectItem>
                <SelectItem value="title">Title</SelectItem>
              </SelectContent>
            </Select>
          </div>
        }>
          {guides.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">No guide activity in this period</div>
          ) : (
            <div className="overflow-x-auto -mx-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    <th className="text-left font-medium px-4 py-1.5">Guide</th>
                    <th className="text-right font-medium px-2 py-1.5">Sessions</th>
                    <th className="text-right font-medium px-2 py-1.5">Done</th>
                    <th className="text-right font-medium px-2 py-1.5">Rating</th>
                    <th className="text-right font-medium px-2 py-1.5">Flags</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {guides.map((g) => {
                    const active = g.id === selected;
                    return (
                      <tr key={g.id}
                        className={cn("border-t border-border/60 cursor-pointer transition-colors", active ? "bg-primary/10" : "hover:bg-muted/40")}
                        onClick={() => setSelected(active ? null : g.id)}
                        aria-selected={active}>
                        <td className="px-4 py-2 min-w-0">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="flex gap-0.5 shrink-0" aria-label={(g.brands ?? []).map((b) => brandOf(b).name).join(", ")}>
                              {(g.brands ?? []).map((b) => <span key={b} className="inline-block w-2 h-2 rounded-full" style={{ background: brandOf(b).fill }} title={brandOf(b).name} />)}
                            </div>
                            <span className="truncate font-medium">{g.title}</span>
                            <code className="text-[11px] text-muted-foreground shrink-0">{g.product_code}</code>
                          </div>
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums">{g.sessions}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{g.sessions ? `${g.completion}%` : "—"}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{g.avg_rating != null ? g.avg_rating.toFixed(1) : "—"}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{g.flags ? <span className="text-[var(--brand-pink)]">{g.flags}</span> : "0"}</td>
                        <td className="px-2 py-2 text-muted-foreground"><ChevronRight className={cn("w-4 h-4 transition-transform", active && "rotate-90")} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title={selectedGuide ? "Step drop-off" : "Step drop-off"} className="lg:sticky lg:top-4"
          aside={selectedGuide && (
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => navigate(`/guide/guides/${selectedGuide.id}/edit`)}>Open guide <ChevronRight className="w-3.5 h-3.5 ml-0.5" /></Button>
          )}>
          {!selectedGuide ? (
            <div className="py-10 text-center text-sm text-muted-foreground">Select a guide to see how far customers get through its steps.</div>
          ) : steps.isLoading ? (
            <div className="py-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
          ) : !steps.data || steps.data.steps.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">No steps recorded for this guide.</div>
          ) : (() => {
            const data = steps.data;
            const total = data.sessions;
            const fill = selectedGuide.brands?.length === 1 ? brandOf(selectedGuide.brands[0]).fill : "var(--brand-accent)";
            // Biggest single-step loss — the step to look at first.
            let worst = -1, worstLoss = 0;
            data.steps.forEach((s, i) => { const prev = i === 0 ? total : data.steps[i - 1].reached; const loss = prev - s.reached; if (loss > worstLoss) { worstLoss = loss; worst = i; } });
            return (
              <div className="space-y-3">
                <div className="text-xs text-muted-foreground truncate"><span className="text-foreground font-medium">{selectedGuide.title}</span> · {total} session{total === 1 ? "" : "s"}, {selectedGuide.steps} steps</div>
                <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
                  {data.steps.map((s, i) => (
                    <HBar key={s.step}
                      label={<span className={cn(i === worst && worstLoss > 0 && "text-[var(--brand-orange)]")}>{s.step}. {s.title || "Untitled step"}{i === worst && worstLoss > 0 ? ` — biggest drop (−${worstLoss})` : ""}</span>}
                      value={s.reached} max={Math.max(1, total)} fill={fill} suffix={` · ${pct(s.reached, total)}%`} />
                  ))}
                </div>
              </div>
            );
          })()}
        </Card>
      </div>

      {/* Recent flags */}
      <Card title="Recent flags" aside={<Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => navigate("/guide/feedback")}>All feedback <ChevronRight className="w-3.5 h-3.5 ml-0.5" /></Button>}>
        {r.flags.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">No flags in this period 🎉</div>
        ) : (
          <ul className="divide-y divide-border/60">
            {r.flags.map((f) => (
              <li key={f.id} className="py-2 flex items-start gap-3 text-sm">
                <Flag className={cn("w-4 h-4 mt-0.5 shrink-0", f.resolved ? "text-muted-foreground" : "text-[var(--brand-pink)]")} aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <button type="button" className="font-medium hover:underline truncate" onClick={() => navigate(`/guide/guides/${f.guide_id}/edit`)}>{f.guide}</button>
                    {f.step != null && <span className="text-xs text-muted-foreground">step {f.step}</span>}
                    <span className="text-xs text-muted-foreground">{fmtWhen(f.created_at)}</span>
                    {f.resolved ? <Badge variant="outline" className="text-[10px] h-5">resolved</Badge> : <Badge className="text-[10px] h-5 bg-[var(--brand-pink)] text-white">open</Badge>}
                  </div>
                  {f.comment && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{f.comment}</p>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
