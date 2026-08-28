// cashflow-forecast — 13-week cash flow forecast for the Accounts › Cash Flow tab.
//
// Pulls live on every call:
//   Xero  — bank balances (BankSummary), open AR + AP invoices, paid AR invoices
//           (last 180 days, for observed days-to-pay per channel), trailing 3-month
//           P&L (wages / GST / recurring opex run-rate), contact groups (channel).
//   Cin7  — purchase orders raised but not yet billed, stock on hand + on order at
//           average cost. Cached for CONFIG.cin7.cacheMinutes (one call per PO).
//
// Everything the page shows is computed here and returned as one JSON payload.
// Persists: cashflow_forecast_log (weekly variance), cashflow_monthly_metrics
// (DSO/DIO/DPO/CCC trend), cashflow_cache (Cin7 block).

import { createClient } from "npm:@supabase/supabase-js@2";
import { requireStaff } from "../_shared/auth.ts";
import { cin7Fetch } from "../_shared/cin7-client.ts";

// ═════════════════════════════════════════════════════════════════════════════
// CONFIG — everything a human should be able to change without touching logic.
// ═════════════════════════════════════════════════════════════════════════════
const CONFIG = {
  /** Minimum cash floor (AUD). Headroom and the floor band are measured from this. */
  minimumCashFloor: 150_000,

  /** Weeks in the forecast horizon. */
  weeks: 13,

  /**
   * Collection profiles — days from invoice date to cash in bank.
   * `observed` days from the last 180 days of paid invoices are used when at least
   * `minSamples` exist for a channel; otherwise the midpoint of the range below.
   * Channels are NEVER averaged together. With clampToRange the observed median is
   * kept inside [minDays, maxDays] (Shopify/Cin7 create invoices at payment time,
   * which makes same-day "payments" look like fast terms); the raw median is still reported.
   */
  clampObservedToRange: true,
  collections: {
    dtc:       { label: "DTC",          minDays: 3,  maxDays: 5,  businessDays: true,  minSamples: 10 },
    stockist:  { label: "Stockists",    minDays: 40, maxDays: 60, businessDays: false, minSamples: 5 },
    fleet_gov: { label: "Fleet & Govt", minDays: 45, maxDays: 90, businessDays: false, minSamples: 5 },
  } as Record<Channel, { label: string; minDays: number; maxDays: number; businessDays: boolean; minSamples: number }>,

  /**
   * Channel assignment. Xero Contact Group names are checked first (case-insensitive);
   * then contact-name keywords. Anything left is DTC.
   */
  channelGroups: {
    fleet_gov: ["fleet", "government", "govt", "council"],
    stockist:  ["stockist", "wholesale", "dealer", "reseller", "trade"],
    dtc:       ["retail", "dtc", "shopify", "online"],
  } as Record<Channel, string[]>,
  channelKeywords: {
    fleet_gov: /\b(council|shire|department|dept|govt|government|fleet|police|ambulance|fire|defence|university|hospital|nsw|qld|vic|wa|sa|tas|nt|act|rfs|ses|rural fire|water|energy|rail|transport|mines?|mining)\b/i,
    stockist:  /\b(pty|ltd|4x4|4wd|auto|motors?|offroad|off-road|holdings|trading|supplies|accessories|canopies|ute|group|co\.?|inc|enterprises|industries)\b/i,
  } as Record<string, RegExp>,

  /** Payroll. Payday anchor is any real payday; the cycle is projected forward from it. */
  payroll: {
    cycle: "fortnightly" as "weekly" | "fortnightly" | "monthly",
    anchorPayday: "2026-08-27",       // a known payday (YYYY-MM-DD)
    /** Net wages per pay run. null → derived from Xero P&L wages ÷ runs per month, less PAYGW. */
    netPerRun: null as number | null,
    /** Gross wages per pay run. null → derived from Xero P&L (wages + salaries accounts). */
    grossPerRun: null as number | null,
    /** Regex matched against Xero P&L account names to find gross wages. */
    wagesAccountPattern: /wages|salar|payroll(?! tax)|superannuation/i,
    superAccountPattern: /superannuation|super\b/i,
    /** Average PAYGW as a share of gross (used only when deriving from P&L). */
    paygwRate: 0.22,
  },

  /** Superannuation guarantee — per pay run, due within N business days of payday. */
  super: { rate: 0.12, dueBusinessDaysAfterPayday: 7 },

  /** PAYG withholding remittance. Monthly (medium withholder) on the 21st, or "quarterly" via BAS. */
  paygw: { cycle: "monthly" as "monthly" | "quarterly", dueDayOfMonth: 21 },

  /** NSW payroll tax — monthly on the 7th. Threshold is annual. */
  payrollTaxNSW: { enabled: true, rate: 0.0545, annualThreshold: 1_200_000, dueDayOfMonth: 7 },

  /**
   * BAS — one net figure: GST on sales − GST credits + PAYGW (if quarterly) + PAYG
   * instalment − fuel tax credits. Due dates are MM-DD; the quarter is the 3 months
   * ending the month before the due month.
   */
  bas: {
    cycle: "quarterly" as "quarterly" | "monthly",
    dueDates: ["02-28", "04-28", "07-28", "10-28"],
    paygInstalmentPerQuarter: 0,
    fuelTaxCreditsPerQuarter: 0,
    gstRate: 0.10,
  },

  /** Statutory / large dated payments that aren't in Xero yet. Dates YYYY-MM-DD. */
  containerBalances: [] as { label: string; amount: number; date: string }[],
  /** Recurring finance repayments. dayOfMonth 1–28. */
  equipmentFinance: [] as { label: string; amount: number; dayOfMonth: number }[],

  /** Accounts payable + Cin7 purchase order assumptions. */
  payables: {
    /** Bill an unbilled Cin7 PO this many days after order date if it has no RequiredBy date. */
    poLeadDays: 45,
    /** Supplier terms from bill date to payment. */
    supplierTermsDays: 30,
    /** Overdue Xero bills are paid evenly across these forecast weeks (1 = this week). */
    overdueApWeeks: [1, 2, 3, 4],
  },

  /** Receivables assumptions. */
  receivables: {
    /** Overdue AR is collected across these forecast weeks (base case). Downside excludes it. */
    overdueCollectWeeks: [2, 3, 4],
    /** Share of overdue AR expected to be collected (base case). */
    overdueRecovery: 0.6,
    /** Trailing days of invoicing used as the run-rate for new sales. */
    runRateDays: 91,
  },

  /** Downside case. */
  downside: {
    collectionsDelayDays: 14,
    newSalesFactor: 0.85,
  },

  /** Recurring operating cash costs (rent, subscriptions, freight…) come from the P&L run-rate. */
  opex: {
    /** Exclude these P&L accounts from the recurring outflow (they're modelled separately). */
    excludePattern: /wages|salar|superannuation|payroll|depreciation|amortisation|interest|income tax/i,
    /** P&L accounts treated as cost of goods (drive DIO/DPO + GST credits) wherever they sit in the layout. */
    cogsAccountPattern: /cost of goods|cost of sales|cogs|purchases|inventory|stock|freight in|landed|duty|customs/i,
    trailingMonths: 3,
  },

  /** Xero. Bank accounts to exclude from "cash at bank" (e.g. credit cards). Case-insensitive names. */
  xero: { excludeBankAccounts: [] as string[], observedPaymentDays: 180 },

  /** Cin7 Core. */
  cin7: { cacheMinutes: 120, maxPoDetailCalls: 60, poLookbackDays: 180 },

  /** Business days for the calendar. */
  publicHolidays: ["2026-10-05", "2026-12-25", "2026-12-28", "2027-01-01", "2027-01-26"],
};
// ═════════════════════════════════════════════════════════════════════════════

type Channel = "dtc" | "stockist" | "fleet_gov";
type SC = ReturnType<typeof createClient>;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ─── Date helpers ─────────────────────────────────────────────────────────────

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const parseISO = (s: string) => new Date(`${s}T00:00:00Z`);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);
const HOLIDAYS = new Set(CONFIG.publicHolidays);
function isBusinessDay(d: Date) { const w = d.getUTCDay(); return w !== 0 && w !== 6 && !HOLIDAYS.has(iso(d)); }
function addBusinessDays(d: Date, n: number) {
  let cur = d, left = n;
  while (left > 0) { cur = addDays(cur, 1); if (isBusinessDay(cur)) left--; }
  return cur;
}
function nextBusinessDay(d: Date) { let c = d; while (!isBusinessDay(c)) c = addDays(c, 1); return c; }
function mondayOf(d: Date) { const w = (d.getUTCDay() + 6) % 7; return addDays(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())), -w); }
function monthStart(d: Date) { return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)); }
function addMonths(d: Date, n: number) { return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, d.getUTCDate())); }
function xeroDate(v: unknown): Date | null {
  if (!v) return null;
  const s = String(v);
  const m = s.match(/\/Date\((-?\d+)/);
  if (m) return new Date(Number(m[1]));
  const d = new Date(s.length === 10 ? `${s}T00:00:00Z` : s);
  return Number.isNaN(d.getTime()) ? null : d;
}
function median(xs: number[]) { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
const round = (n: number) => Math.round(n * 100) / 100;
const xeroDateTime = (d: Date) => `DateTime(${d.getUTCFullYear()},${d.getUTCMonth() + 1},${d.getUTCDate()})`;

// ─── Xero token (same pattern as xero-pl-snapshot) ────────────────────────────

let cachedToken: string | null = null;
let tokenExpiresAt = 0;

async function getXeroToken(sc: SC): Promise<{ token: string; tenantId: string }> {
  const { data: row, error } = await sc.from("xero_tokens").select("refresh_token, tenant_id, tenant_name").eq("id", 1).single();
  if (error || !row?.refresh_token) throw new Error("XERO_NOT_CONNECTED: Xero has not been authorised.");
  if (cachedToken && Date.now() < tokenExpiresAt - 60_000 && row.tenant_id) return { token: cachedToken, tenantId: row.tenant_id };

  const res = await fetch("https://identity.xero.com/connect/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: "Basic " + btoa(`${Deno.env.get("XERO_CLIENT_ID")}:${Deno.env.get("XERO_CLIENT_SECRET")}`) },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: row.refresh_token }),
  });
  if (!res.ok) {
    const t = await res.text();
    if (t.includes("invalid_grant")) { await sc.from("xero_tokens").delete().eq("id", 1); throw new Error("XERO_NOT_CONNECTED: Xero authorisation has expired. Please reconnect."); }
    throw new Error(`Xero token error: ${t}`);
  }
  const data = await res.json();
  cachedToken = data.access_token; tokenExpiresAt = Date.now() + data.expires_in * 1000;
  let tenantId = row.tenant_id as string | null;
  if (!tenantId) {
    const c = await fetch("https://api.xero.com/connections", { headers: { Authorization: `Bearer ${cachedToken}` } }).then((r) => r.json());
    tenantId = c?.[0]?.tenantId ?? null;
  }
  await sc.from("xero_tokens").upsert({
    id: 1, access_token: data.access_token, refresh_token: data.refresh_token,
    expires_at: new Date(tokenExpiresAt).toISOString(), scope: data.scope,
    tenant_id: tenantId, tenant_name: row.tenant_name, updated_at: new Date().toISOString(),
  });
  if (!tenantId) throw new Error("No Xero tenant connected");
  return { token: cachedToken!, tenantId };
}

async function xeroGet(auth: { token: string; tenantId: string }, path: string, extra: Record<string, string> = {}) {
  const res = await fetch(`https://api.xero.com/api.xro/2.0${path}`, {
    headers: { Authorization: `Bearer ${auth.token}`, "Xero-Tenant-Id": auth.tenantId, Accept: "application/json", ...extra },
  });
  if (res.status === 429) { await new Promise((r) => setTimeout(r, 2000)); return xeroGet(auth, path, extra); }
  if (!res.ok) throw new Error(`Xero ${path} (${res.status}): ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

async function xeroInvoices(auth: { token: string; tenantId: string }, where: string, modifiedSince?: Date, summaryOnly = true) {
  const out: any[] = [];
  const extra: Record<string, string> = modifiedSince ? { "If-Modified-Since": modifiedSince.toUTCString() } : {};
  for (let page = 1; page < 40; page++) {
    const j = await xeroGet(auth, `/Invoices?where=${encodeURIComponent(where)}&page=${page}${summaryOnly ? "&summaryOnly=true" : ""}`, extra);
    const inv = j.Invoices ?? [];
    out.push(...inv);
    if (inv.length < 100) break;
  }
  return out;
}

// ─── Xero pulls ───────────────────────────────────────────────────────────────

async function bankClosing(auth: { token: string; tenantId: string }, toDate: string) {
  // Balance Sheet "Bank" section (scope accounting.reports.balancesheet.read — BankSummary needs reports.read).
  const j = await xeroGet(auth, `/Reports/BalanceSheet?date=${toDate}&standardLayout=true`);
  const excl = CONFIG.xero.excludeBankAccounts.map((s) => s.toLowerCase());
  let total = 0; const accounts: { name: string; balance: number }[] = [];
  const walk = (rs: any[], section: string) => {
    for (const r of rs ?? []) {
      const title = r.Title ? String(r.Title) : section;
      if (r.Rows) walk(r.Rows, title);
      if (r.RowType !== "Row" || !/^bank$/i.test(title.trim())) continue;
      const cells = r.Cells ?? []; const name = String(cells[0]?.Value ?? "");
      if (!(cells[0]?.Attributes ?? []).some((a: any) => a.Id === "account")) continue;
      if (excl.includes(name.toLowerCase())) continue;
      const bal = parseFloat(String(cells[1]?.Value ?? "0").replace(/,/g, "")) || 0;
      accounts.push({ name, balance: bal }); total += bal;
    }
  };
  walk(j?.Reports?.[0]?.Rows, "");
  return { total, accounts };
}

async function latestBankTxnDate(auth: { token: string; tenantId: string }): Promise<Date | null> {
  const j = await xeroGet(auth, `/BankTransactions?order=${encodeURIComponent("Date DESC")}&page=1`);
  let max: Date | null = null;
  for (const t of j.BankTransactions ?? []) { const d = xeroDate(t.Date); if (d && (!max || d > max)) max = d; }
  return max;
}

async function channelMap(auth: { token: string; tenantId: string }): Promise<Map<string, Channel>> {
  const m = new Map<string, Channel>();
  try {
    const j = await xeroGet(auth, `/ContactGroups`);
    for (const g of j.ContactGroups ?? []) {
      const name = String(g.Name ?? "").toLowerCase();
      let ch: Channel | null = null;
      for (const [c, keys] of Object.entries(CONFIG.channelGroups)) if (keys.some((k) => name.includes(k))) { ch = c as Channel; break; }
      if (!ch) continue;
      const full = await xeroGet(auth, `/ContactGroups/${g.ContactGroupID}`);
      for (const c of full.ContactGroups?.[0]?.Contacts ?? []) m.set(c.ContactID, ch);
    }
  } catch (_) { /* groups optional */ }
  return m;
}

function classify(contact: any, groups: Map<string, Channel>): Channel {
  const g = groups.get(contact?.ContactID); if (g) return g;
  const name = String(contact?.Name ?? "");
  if (CONFIG.channelKeywords.fleet_gov.test(name)) return "fleet_gov";
  if (CONFIG.channelKeywords.stockist.test(name)) return "stockist";
  return "dtc";
}

interface PL { revenue: number; cogs: number; wagesGross: number; superExp: number; otherOpex: number; months: number; lines?: { section: string; name: string; amt: number; as: string }[] }
async function trailingPL(auth: { token: string; tenantId: string }, today: Date): Promise<PL> {
  const n = CONFIG.opex.trailingMonths;
  const end = addDays(monthStart(today), -1);
  const start = monthStart(addMonths(end, -(n - 1)));
  const j = await xeroGet(auth, `/Reports/ProfitAndLoss?fromDate=${iso(start)}&toDate=${iso(end)}&standardLayout=true`);
  const pl: PL = { revenue: 0, cogs: 0, wagesGross: 0, superExp: 0, otherOpex: 0, months: n, lines: [] };
  const tag = (section: string, name: string, amt: number, as: string) => { pl.lines!.push({ section, name, amt, as }); };
  const walk = (rows: any[], section: string) => {
    for (const r of rows ?? []) {
      const title = r.Title ? String(r.Title) : section;
      if (r.Rows) walk(r.Rows, title);
      if (r.RowType !== "Row") continue;
      const cells = r.Cells ?? []; if (cells.length < 2) continue;
      if (!(cells[0]?.Attributes ?? []).some((a: any) => a.Id === "account")) continue;
      const name = String(cells[0]?.Value ?? "");
      const amt = parseFloat(String(cells[cells.length - 1]?.Value ?? "0").replace(/,/g, "")) || 0;
      const sec = section.toLowerCase();
      if (/cost of sales|cost of goods|direct cost/.test(sec) || CONFIG.opex.cogsAccountPattern.test(name)) { pl.cogs += amt; tag(section, name, amt, "cogs"); continue; }
      if (/income|revenue|sales/.test(sec) && !/other income/.test(sec)) { pl.revenue += amt; tag(section, name, amt, "revenue"); continue; }
      if (CONFIG.payroll.superAccountPattern.test(name)) { pl.superExp += amt; tag(section, name, amt, "super"); continue; }
      if (CONFIG.payroll.wagesAccountPattern.test(name)) { pl.wagesGross += amt; tag(section, name, amt, "wages"); continue; }
      if (CONFIG.opex.excludePattern.test(name)) { tag(section, name, amt, "excluded"); continue; }
      pl.otherOpex += amt; tag(section, name, amt, "opex");
    }
  };
  walk(j?.Reports?.[0]?.Rows, "");
  return pl;
}

// ─── Cin7 pulls (cached) ──────────────────────────────────────────────────────

interface Cin7Block {
  unbilledPOs: { id: string; number: string; supplier: string; orderDate: string; requiredBy: string | null; total: number; invoiced: number; status: string }[];
  unbilledTotal: number;
  stockOnHandCost: number;
  stockOnOrderCost: number;
  skus: number;
  fetchedAt: string;
  warnings: string[];
}

async function fetchCin7(): Promise<Cin7Block> {
  const warnings: string[] = [];
  // Purchase orders raised but not yet billed
  const unbilledPOs: Cin7Block["unbilledPOs"] = [];
  const since = iso(addDays(new Date(), -CONFIG.cin7.poLookbackDays));
  const pos: any[] = [];
  for (let page = 1; page <= 4; page++) {
    const list = await cin7Fetch("/purchaseList", { query: { Page: page, Limit: 500, UpdatedSince: since } });
    if (!list.ok) { warnings.push(`purchaseList: ${list.error}`); break; }
    const items = ((list.data as any)?.PurchaseList ?? []) as any[];
    pos.push(...items);
    if (items.length < 500) break;
  }
  const candidates = pos.filter((p) => {
    const st = String(p.Status ?? p.OrderStatus ?? "").toUpperCase();
    const inv = String(p.CombinedInvoiceStatus ?? p.InvoiceStatus ?? "").toUpperCase();
    if (["VOIDED", "DRAFT", "COMPLETED", "CANCELLED"].includes(st)) return false;
    return inv === "" || inv.includes("NOT INVOICED") || inv.includes("PARTIAL") || inv.includes("NOT AVAILABLE");
  }).slice(0, CONFIG.cin7.maxPoDetailCalls);
  for (const p of candidates) {
    const o = await cin7Fetch("/purchase/order", { query: { TaskID: p.ID } });
    const total = Number((o.data as any)?.Total ?? 0);
    if (!o.ok || !total) continue;
    const invoiced = Number(p.InvoiceAmount ?? 0);
    if (total - invoiced <= 0) continue;
    unbilledPOs.push({
      id: p.ID, number: p.OrderNumber, supplier: p.Supplier ?? "", status: p.Status ?? "",
      orderDate: iso(xeroDate(p.OrderDate) ?? new Date()), requiredBy: p.RequiredBy ? iso(xeroDate(p.RequiredBy)!) : null,
      total: round(total), invoiced: round(invoiced),
    });
  }
  // Stock at cost
  const cost = new Map<string, number>();
  for (let page = 1; page < 20; page++) {
    const r = await cin7Fetch("/product", { query: { Page: page, Limit: 1000 } });
    if (!r.ok) { warnings.push(`product: ${r.error}`); break; }
    const items = ((r.data as any)?.Products ?? []) as any[];
    for (const it of items) cost.set(it.SKU, Number(it.AverageCost ?? 0));
    if (items.length < 1000) break;
  }
  let onHand = 0, onOrder = 0, skus = 0;
  for (let page = 1; page < 20; page++) {
    const r = await cin7Fetch("/ref/productavailability", { query: { Page: page, Limit: 1000 } });
    if (!r.ok) { warnings.push(`productavailability: ${r.error}`); break; }
    const items = ((r.data as any)?.ProductAvailabilityList ?? []) as any[];
    for (const it of items) {
      const c = cost.get(it.SKU) ?? 0; skus++;
      onHand += Number(it.OnHand ?? 0) * c; onOrder += Number(it.OnOrder ?? 0) * c;
    }
    if (items.length < 1000) break;
  }
  return {
    unbilledPOs, unbilledTotal: round(unbilledPOs.reduce((s, p) => s + p.total - p.invoiced, 0)),
    stockOnHandCost: round(onHand), stockOnOrderCost: round(onOrder), skus, fetchedAt: new Date().toISOString(), warnings,
  };
}

async function cin7Cached(sc: SC, force: boolean): Promise<Cin7Block> {
  if (!force) {
    const { data } = await sc.from("cashflow_cache").select("payload, fetched_at").eq("key", "cin7").maybeSingle();
    if (data && Date.now() - new Date(data.fetched_at).getTime() < CONFIG.cin7.cacheMinutes * 60_000) return data.payload as Cin7Block;
  }
  const block = await fetchCin7();
  await sc.from("cashflow_cache").upsert({ key: "cin7", payload: block, fetched_at: block.fetchedAt });
  return block;
}

// ─── Forecast engine ──────────────────────────────────────────────────────────

interface Flow { date: Date; amount: number; kind: "in" | "out"; label: string; category: string; downsideOnly?: false; baseOnly?: boolean; channel?: Channel }

function weekIndex(weekStarts: Date[], d: Date): number {
  // 0-based; dates before the horizon → 0, after → last
  for (let i = weekStarts.length - 1; i >= 0; i--) if (d >= weekStarts[i]) return Math.min(i, weekStarts.length - 1);
  return 0;
}

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
    const auth = await requireStaff(req, corsHeaders);
    if (!auth.ok) return auth.response;

    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    try {
      const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
      const sc = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      if (body?.debug === "pl") {
        const x = await getXeroToken(sc); const n = new Date();
        const pl = await trailingPL(x, new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate())));
        return json(pl);
      }
      const result = await buildForecast(sc, Boolean(body?.refreshCin7));
      return json(result);
    } catch (e) {
      return json({ error: String((e as Error).message ?? e) }, 500);
    }
  });

async function buildForecast(sc: SC, refreshCin7: boolean) {
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const xero = await getXeroToken(sc);
  const xeroSyncedAt = new Date().toISOString();

  const [bank, bankAsAt, groups, pl, arOpen, apOpen, arPaid, arRecent, cin7] = await Promise.all([
    bankClosing(xero, iso(today)),
    latestBankTxnDate(xero),
    channelMap(xero),
    trailingPL(xero, today),
    xeroInvoices(xero, 'Type=="ACCREC" AND Status=="AUTHORISED"'),
    xeroInvoices(xero, 'Type=="ACCPAY" AND Status=="AUTHORISED"'),
    xeroInvoices(xero, 'Type=="ACCREC" AND Status=="PAID"', addDays(today, -CONFIG.xero.observedPaymentDays), false),
    xeroInvoices(xero, `Type=="ACCREC" AND Status!="VOIDED" AND Status!="DELETED" AND Status!="DRAFT" AND Date>=${xeroDateTime(addDays(today, -CONFIG.receivables.runRateDays))}`, undefined, false),
    cin7Cached(sc, refreshCin7),
  ]);

  // ── Observed collection behaviour per channel ─────────────────────────────
  const observed: Record<Channel, number[]> = { dtc: [], stockist: [], fleet_gov: [] };
  for (const inv of arPaid) {
    const d0 = xeroDate(inv.Date), d1 = xeroDate(inv.FullyPaidOnDate);
    if (!d0 || !d1) continue;
    const days = Math.max(0, Math.round((d1.getTime() - d0.getTime()) / DAY));
    if (days > 365) continue;
    observed[classify(inv.Contact, groups)].push(days);
  }
  const profile: Record<Channel, { days: number; source: "observed" | "config"; samples: number; median: number | null }> = {} as any;
  for (const ch of Object.keys(CONFIG.collections) as Channel[]) {
    const cfg = CONFIG.collections[ch]; const med = median(observed[ch]);
    const useObs = observed[ch].length >= cfg.minSamples && med != null;
    const toCal = (d: number) => (cfg.businessDays ? d * 1.4 : d);
    const cfgDays = toCal((cfg.minDays + cfg.maxDays) / 2);
    let days = useObs ? med! : cfgDays;
    if (useObs && CONFIG.clampObservedToRange) days = Math.min(toCal(cfg.maxDays), Math.max(toCal(cfg.minDays), days));
    profile[ch] = { days: Math.round(days * 10) / 10, source: useObs ? "observed" : "config", samples: observed[ch].length, median: med };
  }

  // ── Horizon ───────────────────────────────────────────────────────────────
  const W = CONFIG.weeks;
  const week1 = mondayOf(today);
  const weekStarts = Array.from({ length: W }, (_, i) => addDays(week1, i * 7));
  const horizonEnd = addDays(week1, W * 7);
  const flows: Flow[] = [];
  const push = (f: Flow) => { if (f.amount > 0 && f.date < horizonEnd) flows.push(f); };

  // ── Receivables: open AR by observed profile ──────────────────────────────
  const arByChannel: Record<Channel, number> = { dtc: 0, stockist: 0, fleet_gov: 0 };
  let arOverdue = 0, arTotal = 0;
  for (const inv of arOpen) {
    const due = Number(inv.AmountDue ?? 0); if (due <= 0) continue;
    const ch = classify(inv.Contact, groups); arByChannel[ch] += due; arTotal += due;
    const d0 = xeroDate(inv.Date) ?? today;
    const expected = addDays(d0, profile[ch].days);
    if (expected < today) {
      arOverdue += due;
      const wks = CONFIG.receivables.overdueCollectWeeks;
      for (const w of wks) push({ date: weekStarts[Math.min(w - 1, W - 1)], amount: due * CONFIG.receivables.overdueRecovery / wks.length, kind: "in", label: "Overdue AR recovery", category: "ar_overdue", channel: ch, baseOnly: true });
    } else {
      push({ date: expected, amount: due, kind: "in", label: `AR ${inv.Contact?.Name ?? ""}`, category: "ar", channel: ch });
    }
  }

  // ── New sales run-rate (from trailing invoicing), collected by profile ────
  const runRate: Record<Channel, number> = { dtc: 0, stockist: 0, fleet_gov: 0 };
  for (const inv of arRecent) runRate[classify(inv.Contact, groups)] += Number(inv.Total ?? 0);
  const weeklyRun: Record<Channel, number> = { dtc: 0, stockist: 0, fleet_gov: 0 };
  for (const ch of Object.keys(runRate) as Channel[]) weeklyRun[ch] = runRate[ch] / CONFIG.receivables.runRateDays * 7;
  for (let i = 0; i < W + 13; i++) {
    const invoiceDate = addDays(week1, i * 7 + 3); // mid-week invoicing
    if (invoiceDate < today) continue;
    for (const ch of Object.keys(weeklyRun) as Channel[]) {
      push({ date: addDays(invoiceDate, profile[ch].days), amount: weeklyRun[ch], kind: "in", label: `New sales ${CONFIG.collections[ch].label}`, category: "sales_runrate", channel: ch });
    }
  }

  // ── Payables: Xero AP ─────────────────────────────────────────────────────
  let apTotal = 0, apNext4 = 0;
  for (const inv of apOpen) {
    const due = Number(inv.AmountDue ?? 0); if (due <= 0) continue;
    apTotal += due;
    const dd = xeroDate(inv.DueDate) ?? today;
    if (dd < today) {
      const wks = CONFIG.payables.overdueApWeeks;
      apNext4 += due;
      for (const w of wks) push({ date: weekStarts[Math.min(w - 1, W - 1)], amount: due / wks.length, kind: "out", label: `AP ${inv.Contact?.Name ?? ""}`, category: "ap" });
    } else {
      if (dd < addDays(today, 28)) apNext4 += due;
      push({ date: dd, amount: due, kind: "out", label: `AP ${inv.Contact?.Name ?? ""}`, category: "ap" });
    }
  }

  // ── Payables: Cin7 POs not yet billed ─────────────────────────────────────
  for (const po of cin7.unbilledPOs) {
    const billDate = po.requiredBy ? parseISO(po.requiredBy) : addDays(parseISO(po.orderDate), CONFIG.payables.poLeadDays);
    let payDate = addDays(billDate, CONFIG.payables.supplierTermsDays);
    if (payDate < today) payDate = weekStarts[1] ?? today;
    push({ date: payDate, amount: po.total - po.invoiced, kind: "out", label: `PO ${po.number} ${po.supplier}`, category: "po_unbilled" });
  }

  // ── Payroll, super, PAYGW, payroll tax ────────────────────────────────────
  const runsPerMonth = CONFIG.payroll.cycle === "weekly" ? 52 / 12 : CONFIG.payroll.cycle === "fortnightly" ? 26 / 12 : 1;
  const grossMonthly = pl.wagesGross / pl.months;
  const grossPerRun = CONFIG.payroll.grossPerRun ?? grossMonthly / runsPerMonth;
  const netPerRun = CONFIG.payroll.netPerRun ?? grossPerRun * (1 - CONFIG.payroll.paygwRate);
  const paygwPerRun = grossPerRun - netPerRun;
  const cycleDays = CONFIG.payroll.cycle === "weekly" ? 7 : CONFIG.payroll.cycle === "fortnightly" ? 14 : 0;
  const calendar: { label: string; amount: number; date: string; category: string }[] = [];
  const addCal = (label: string, amount: number, date: Date, category: string) => {
    if (amount <= 0) return;
    push({ date, amount, kind: "out", label, category });
    if (date >= today && date < horizonEnd) calendar.push({ label, amount: round(amount), date: iso(date), category });
  };
  {
    let payday = parseISO(CONFIG.payroll.anchorPayday);
    if (cycleDays) { while (payday < today) payday = addDays(payday, cycleDays); while (addDays(payday, -cycleDays) >= today) payday = addDays(payday, -cycleDays); }
    else { payday = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), payday.getUTCDate())); if (payday < today) payday = addMonths(payday, 1); }
    let paygwMonthAcc = new Map<string, number>();
    for (let i = 0; i < 30; i++) {
      if (payday >= horizonEnd) break;
      addCal("Payroll", netPerRun, payday, "payroll");
      addCal("Super", grossPerRun * CONFIG.super.rate, addBusinessDays(payday, CONFIG.super.dueBusinessDaysAfterPayday), "super");
      const mk = iso(monthStart(payday)); paygwMonthAcc.set(mk, (paygwMonthAcc.get(mk) ?? 0) + paygwPerRun);
      payday = cycleDays ? addDays(payday, cycleDays) : addMonths(payday, 1);
    }
    // PAYGW: monthly on the 21st of the following month (or folded into BAS when quarterly)
    if (CONFIG.paygw.cycle === "monthly") {
      for (let m = -1; m < 5; m++) {
        const ms = addMonths(monthStart(today), m);
        const due = nextBusinessDay(new Date(Date.UTC(ms.getUTCFullYear(), ms.getUTCMonth() + 1, CONFIG.paygw.dueDayOfMonth)));
        if (due < today || due >= horizonEnd) continue;
        const amt = paygwMonthAcc.get(iso(ms)) ?? paygwPerRun * runsPerMonth;
        addCal("PAYGW", amt, due, "paygw");
      }
    }
    // NSW payroll tax: monthly on the 7th for the prior month
    if (CONFIG.payrollTaxNSW.enabled) {
      const taxable = Math.max(0, grossMonthly - CONFIG.payrollTaxNSW.annualThreshold / 12);
      for (let m = 0; m < 5; m++) {
        const ms = addMonths(monthStart(today), m);
        const due = nextBusinessDay(new Date(Date.UTC(ms.getUTCFullYear(), ms.getUTCMonth(), CONFIG.payrollTaxNSW.dueDayOfMonth)));
        if (due < today || due >= horizonEnd) continue;
        addCal("NSW payroll tax", taxable * CONFIG.payrollTaxNSW.rate, due, "payroll_tax");
      }
    }
  }

  // ── BAS: one net figure ───────────────────────────────────────────────────
  const monthlyRevenue = pl.revenue / pl.months;
  const monthlyGstCredits = ((pl.cogs + pl.otherOpex) / pl.months) * CONFIG.bas.gstRate;
  const monthlyGstOnSales = monthlyRevenue * CONFIG.bas.gstRate;
  const basMonths = CONFIG.bas.cycle === "quarterly" ? 3 : 1;
  const basDates = CONFIG.bas.cycle === "quarterly" ? CONFIG.bas.dueDates : Array.from({ length: 12 }, (_, i) => `${String(i + 1).padStart(2, "0")}-21`);
  for (const yr of [today.getUTCFullYear(), today.getUTCFullYear() + 1]) {
    for (const md of basDates) {
      const due = nextBusinessDay(parseISO(`${yr}-${md}`));
      if (due < today || due >= horizonEnd) continue;
      const net = (monthlyGstOnSales - monthlyGstCredits) * basMonths
        + (CONFIG.paygw.cycle === "quarterly" ? paygwPerRun * runsPerMonth * basMonths : 0)
        + CONFIG.bas.paygInstalmentPerQuarter - CONFIG.bas.fuelTaxCreditsPerQuarter;
      addCal("BAS", net, due, "bas");
    }
  }

  // ── Container balances + equipment finance ────────────────────────────────
  for (const c of CONFIG.containerBalances) { const d = parseISO(c.date); if (d >= today) addCal(c.label, c.amount, d, "container"); }
  for (const f of CONFIG.equipmentFinance) {
    for (let m = 0; m < 5; m++) {
      const ms = addMonths(monthStart(today), m);
      const d = new Date(Date.UTC(ms.getUTCFullYear(), ms.getUTCMonth(), f.dayOfMonth));
      if (d >= today) addCal(f.label, f.amount, d, "finance");
    }
  }

  // ── Recurring opex run-rate (GST-inclusive cash) ──────────────────────────
  const weeklyOpex = (pl.otherOpex / pl.months) * 12 / 52 * (1 + CONFIG.bas.gstRate);
  for (let i = 0; i < W; i++) push({ date: addDays(weekStarts[i], 2), amount: weeklyOpex, kind: "out", label: "Operating costs", category: "opex" });

  // ── Roll weekly ───────────────────────────────────────────────────────────
  const weeks = weekStarts.map((ws, i) => ({
    week: i + 1, start: iso(ws), end: iso(addDays(ws, 6)),
    inflow: 0, outflow: 0, close: 0, inflowDown: 0, closeDown: 0,
  }));
  for (const f of flows) {
    const i = weekIndex(weekStarts, f.date);
    if (f.kind === "out") { weeks[i].outflow += f.amount; continue; }
    weeks[i].inflow += f.amount;
    if (f.baseOnly) continue;
    const factor = f.category === "sales_runrate" ? CONFIG.downside.newSalesFactor : 1;
    const j = weekIndex(weekStarts, addDays(f.date, CONFIG.downside.collectionsDelayDays));
    if (addDays(f.date, CONFIG.downside.collectionsDelayDays) < horizonEnd) weeks[j].inflowDown += f.amount * factor;
  }
  let bal = bank.total, balDown = bank.total;
  for (const w of weeks) {
    bal += w.inflow - w.outflow; balDown += w.inflowDown - w.outflow;
    w.close = round(bal); w.closeDown = round(balDown);
    w.inflow = round(w.inflow); w.outflow = round(w.outflow); w.inflowDown = round(w.inflowDown);
  }
  const low = weeks.reduce((m, w) => (w.close < m.close ? w : m), weeks[0]);
  const lowDown = weeks.reduce((m, w) => (w.closeDown < m.closeDown ? w : m), weeks[0]);
  const totalOut = weeks.reduce((s, w) => s + w.outflow, 0);
  const daysCashOnHand = totalOut > 0 ? bank.total / (totalOut / (W * 7)) : null;

  // ── Variance log ──────────────────────────────────────────────────────────
  const lastWeekStart = addDays(week1, -7);
  let variance: { weekStart: string; forecast: number; actual: number; dollars: number; pct: number | null } | null = null;
  {
    const { data: prev } = await sc.from("cashflow_forecast_log").select("*").eq("week_start", iso(lastWeekStart)).maybeSingle();
    if (prev) {
      let actual = prev.actual_close;
      if (actual == null) {
        const closing = await bankClosing(xero, iso(addDays(week1, -1)));
        actual = round(closing.total);
        await sc.from("cashflow_forecast_log").update({ actual_close: actual, actual_at: new Date().toISOString() }).eq("week_start", iso(lastWeekStart));
      }
      const dollars = round(Number(actual) - Number(prev.forecast_close));
      variance = { weekStart: iso(lastWeekStart), forecast: Number(prev.forecast_close), actual: Number(actual), dollars, pct: Number(prev.forecast_close) ? dollars / Math.abs(Number(prev.forecast_close)) : null };
    }
    // Record next week's forecast if not already recorded (first forecast wins).
    const next = weeks[1];
    if (next) {
      const { data: ex } = await sc.from("cashflow_forecast_log").select("week_start").eq("week_start", next.start).maybeSingle();
      if (!ex) await sc.from("cashflow_forecast_log").insert({ week_start: next.start, forecast_close: next.close });
    }
  }

  // ── Monthly working-capital metrics ───────────────────────────────────────
  const dailySales = (ch: Channel) => runRate[ch] / CONFIG.receivables.runRateDays;
  const dso = (ch: Channel) => (dailySales(ch) > 0 ? arByChannel[ch] / dailySales(ch) : null);
  const cogsPerDay = pl.cogs / pl.months * 12 / 365;
  const dio = cogsPerDay > 0 ? cin7.stockOnHandCost / cogsPerDay : null;
  const dpo = cogsPerDay > 0 ? (apTotal + cin7.unbilledTotal) / cogsPerDay : null;
  const dsoW = arTotal > 0 ? (Object.keys(arByChannel) as Channel[]).reduce((s, ch) => s + (dso(ch) ?? 0) * arByChannel[ch] / arTotal, 0) : null;
  const ccc = dsoW != null && dio != null && dpo != null ? dsoW + dio - dpo : null;
  const thisMonth = iso(monthStart(today));
  const r1 = (v: number | null) => (v == null ? null : Math.round(v * 10) / 10);
  const current = { dso_dtc: r1(dso("dtc")), dso_stockist: r1(dso("stockist")), dso_fleet_gov: r1(dso("fleet_gov")), dio: r1(dio), dpo: r1(dpo), ccc: r1(ccc) };
  await sc.from("cashflow_monthly_metrics").upsert({ period_month: thisMonth, ...current, computed_at: new Date().toISOString() });
  const { data: prevM } = await sc.from("cashflow_monthly_metrics").select("*").lt("period_month", thisMonth).order("period_month", { ascending: false }).limit(1).maybeSingle();

  calendar.sort((a, b) => a.date.localeCompare(b.date));

  return {
    generatedAt: new Date().toISOString(),
    config: {
      minimumCashFloor: CONFIG.minimumCashFloor, weeks: W,
      collections: Object.fromEntries((Object.keys(CONFIG.collections) as Channel[]).map((ch) => [ch, { ...CONFIG.collections[ch], ...profile[ch] }])),
      payroll: { cycle: CONFIG.payroll.cycle, anchorPayday: CONFIG.payroll.anchorPayday },
    },
    bank: { total: round(bank.total), accounts: bank.accounts.map((a) => ({ ...a, balance: round(a.balance) })), asAt: bankAsAt ? iso(bankAsAt) : null },
    hero: {
      lowClose: low.close, lowWeek: low.week, lowWeekStart: low.start, lowWeekEnd: low.end,
      headroom: round(low.close - CONFIG.minimumCashFloor), floorBreach: low.close < CONFIG.minimumCashFloor,
      downsideLowClose: lowDown.closeDown, downsideLowWeek: lowDown.week, downsideBreach: lowDown.closeDown < CONFIG.minimumCashFloor,
      daysCashOnHand: daysCashOnHand == null ? null : Math.round(daysCashOnHand),
    },
    weeks,
    drivers: {
      owedToUs: { total: round(arTotal), overdue: round(arOverdue), byChannel: Object.fromEntries((Object.keys(arByChannel) as Channel[]).map((ch) => [ch, round(arByChannel[ch])])), invoices: arOpen.length },
      owedByUs: { apNext4Weeks: round(apNext4), apTotal: round(apTotal), apBills: apOpen.length, poUnbilled: cin7.unbilledTotal, poCount: cin7.unbilledPOs.length, pos: cin7.unbilledPOs.slice(0, 12) },
      stock: { onHandCost: cin7.stockOnHandCost, onOrderCost: cin7.stockOnOrderCost, skus: cin7.skus },
    },
    calendar: calendar.slice(0, 6),
    trust: {
      variance,
      freshness: { xeroSyncedAt, cin7SyncedAt: cin7.fetchedAt, bankAsAt: bankAsAt ? iso(bankAsAt) : null },
      warnings: cin7.warnings,
    },
    monthly: {
      period: thisMonth, current,
      previous: prevM ? { period: prevM.period_month, dso_dtc: prevM.dso_dtc, dso_stockist: prevM.dso_stockist, dso_fleet_gov: prevM.dso_fleet_gov, dio: prevM.dio, dpo: prevM.dpo, ccc: prevM.ccc } : null,
    },
    assumptions: {
      grossPerRun: round(grossPerRun), netPerRun: round(netPerRun), weeklyOpex: round(weeklyOpex),
      monthlyGstOnSales: round(monthlyGstOnSales), monthlyGstCredits: round(monthlyGstCredits),
      plMonths: pl.months, plLines: pl.lines, plRevenue: round(pl.revenue), plCogs: round(pl.cogs), plWages: round(pl.wagesGross), plOtherOpex: round(pl.otherOpex),
      weeklyRunRate: Object.fromEntries((Object.keys(weeklyRun) as Channel[]).map((ch) => [ch, round(weeklyRun[ch])])),
    },
  };
}
