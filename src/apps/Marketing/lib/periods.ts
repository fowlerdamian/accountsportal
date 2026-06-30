// Period maths for the Marketing Dashboard filter — mirrors the Finance
// dashboard's Month / Calendar-Year / Financial-Year grains, but resolves to a
// concrete {startDate,endDate} range (the marketing sources are queried live by
// date, not from pre-aggregated monthly snapshots). AU FY = 1 Jul → 30 Jun;
// "FY26" ends Jun-2026.

export type Grain = "month" | "cy" | "fy";

export const GRAINS: { key: Grain; label: string }[] = [
  { key: "month", label: "Month" },
  { key: "cy", label: "Calendar Year" },
  { key: "fy", label: "Financial Year" },
];

export interface PeriodOption { value: string; label: string }
export interface DateRange { startDate: string; endDate: string }

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// Financial year (ending year) that a calendar month belongs to.
const fyOfMonth = (y: number, m: number) => (m >= 7 ? y + 1 : y);

// Build selector options for a grain. `now` anchors the lists to the present.
export function buildOptions(grain: Grain, now = new Date()): PeriodOption[] {
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  if (grain === "month") {
    // Trailing 24 months, newest first.
    const out: PeriodOption[] = [];
    for (let i = 0; i < 24; i++) {
      const d = new Date(y, now.getMonth() - i, 1);
      out.push({ value: `${d.getFullYear()}-${pad(d.getMonth() + 1)}`, label: `${MONTHS[d.getMonth()]} ${d.getFullYear()}` });
    }
    return out;
  }
  if (grain === "cy") {
    return [y, y - 1, y - 2, y - 3].map((yr) => ({ value: String(yr), label: String(yr) }));
  }
  // fy — ending year
  const curFy = fyOfMonth(y, m);
  return [curFy, curFy - 1, curFy - 2, curFy - 3].map((fy) => ({ value: String(fy), label: `FY${String(fy).slice(2)}` }));
}

// The default selection for a grain (current month / year / FY).
export function defaultAnchor(grain: Grain, now = new Date()): string {
  return buildOptions(grain, now)[0].value;
}

// Resolve a {grain, anchor} selection to a concrete inclusive date range,
// clamped so the end never runs past today.
export function dateRange(grain: Grain, anchor: string, now = new Date()): DateRange {
  const today = iso(now);
  if (grain === "month") {
    const [y, m] = anchor.split("-").map(Number);
    const start = `${y}-${pad(m)}-01`;
    const end = iso(new Date(y, m, 0)); // last day of month m (1-indexed → day 0 of next)
    return { startDate: start, endDate: end < today ? end : today };
  }
  if (grain === "cy") {
    const y = Number(anchor);
    const end = `${y}-12-31`;
    return { startDate: `${y}-01-01`, endDate: end < today ? end : today };
  }
  // fy — ending year `anchor`: 1 Jul (anchor-1) → 30 Jun (anchor)
  const fy = Number(anchor);
  const end = `${fy}-06-30`;
  return { startDate: `${fy - 1}-07-01`, endDate: end < today ? end : today };
}

export function periodLabel(grain: Grain, anchor: string): string {
  return buildOptions(grain).find((o) => o.value === anchor)?.label ?? anchor;
}
