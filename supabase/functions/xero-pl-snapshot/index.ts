// xero-pl-snapshot — Phase 2 of the Finance Dashboard.
// Pulls the Xero Profit & Loss report for one or more months, groups every P&L
// line by account_map, computes the derived EBITDA / contribution / breakeven
// metrics, and writes finance_snapshot + finance_expense_line.
//
// Server-side only. Reuses the existing Xero connection (xero_tokens, id=1) and
// the same raw-fetch + refresh-token pattern as xero-chat. Figures are
// GST-exclusive (Xero P&L default). verify_jwt is false — invoked by the Vercel
// cron (/api/finance-snapshot) with the service role key, or manually for backfill.

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

type SC = ReturnType<typeof createClient>;

// ─── Xero token + tenant helpers (same pattern as xero-chat) ──────────────────

let cachedToken: string | null = null;
let tokenExpiresAt = 0;
let cachedTenantId: string | null = null;

async function getXeroToken(sc: SC): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiresAt - 60000) return cachedToken!;

  const { data: row, error } = await sc
    .from("xero_tokens")
    .select("refresh_token, tenant_id, tenant_name")
    .eq("id", 1)
    .single();

  if (error || !row?.refresh_token) {
    throw new Error("XERO_NOT_CONNECTED: Xero has not been authorised.");
  }

  const clientId = Deno.env.get("XERO_CLIENT_ID")!;
  const clientSecret = Deno.env.get("XERO_CLIENT_SECRET")!;

  const res = await fetch("https://identity.xero.com/connect/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": "Basic " + btoa(`${clientId}:${clientSecret}`),
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: row.refresh_token }),
  });

  if (!res.ok) {
    const errText = await res.text();
    if (errText.includes("invalid_grant") || errText.includes("Token has expired")) {
      await sc.from("xero_tokens").delete().eq("id", 1);
      throw new Error("XERO_NOT_CONNECTED: Xero authorisation has expired. Please reconnect.");
    }
    throw new Error(`Xero token error: ${errText}`);
  }

  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + data.expires_in * 1000;

  await sc.from("xero_tokens").upsert({
    id: 1,
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(),
    scope: data.scope,
    tenant_id: row.tenant_id ?? cachedTenantId,
    tenant_name: row.tenant_name,
    updated_at: new Date().toISOString(),
  });

  if (row.tenant_id) cachedTenantId = row.tenant_id;
  return cachedToken!;
}

async function getTenant(sc: SC): Promise<{ id: string; name: string }> {
  const { data: row } = await sc.from("xero_tokens").select("tenant_id, tenant_name").eq("id", 1).single();
  if (row?.tenant_id) { cachedTenantId = row.tenant_id; return { id: row.tenant_id, name: row.tenant_name }; }
  const token = await getXeroToken(sc);
  const res = await fetch("https://api.xero.com/connections", { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Xero connections error: ${await res.text()}`);
  const conns = await res.json();
  if (!conns.length) throw new Error("No Xero connections found");
  cachedTenantId = conns[0].tenantId;
  return { id: conns[0].tenantId, name: conns[0].tenantName ?? "" };
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

function monthBounds(period: string): { from: string; to: string; firstDay: string } {
  // period = "YYYY-MM"
  const [y, m] = period.split("-").map(Number);
  const from = `${y}-${String(m).padStart(2, "0")}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1-based; day 0 of next month
  const to = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { from, to, firstDay: from };
}

function currentMonth(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function trailingMonths(n: number): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out.reverse();
}

// ─── Xero P&L report walk ─────────────────────────────────────────────────────

interface RawLine { accountId: string | null; name: string; amount: number; }

// Recursively collect leaf rows that carry an "account" attribute.
function walkRows(rows: any[], out: RawLine[]) {
  for (const row of rows ?? []) {
    if (row.Rows) walkRows(row.Rows, out);
    if (row.RowType !== "Row") continue;
    const cells = row.Cells ?? [];
    if (cells.length < 2) continue;
    const attrs = cells[0]?.Attributes ?? [];
    const acc = attrs.find((a: any) => a.Id === "account");
    const accountId = acc?.Value ?? null;
    const name = cells[0]?.Value ?? "";
    // last numeric cell = the period amount (single-period report has one value column)
    const valStr = cells[cells.length - 1]?.Value ?? "";
    const amount = parseFloat(String(valStr).replace(/,/g, "")) || 0;
    // Only real account rows carry an "account" attribute; skip computed
    // subtotals like "Gross Profit" / "Net Profit" (no accountId).
    if (!accountId) continue;
    out.push({ accountId, name, amount });
  }
}

async function fetchPL(token: string, tenantId: string, from: string, to: string): Promise<RawLine[]> {
  const url = `https://api.xero.com/api.xro/2.0/Reports/ProfitAndLoss?fromDate=${from}&toDate=${to}&standardLayout=true`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, "Xero-Tenant-Id": tenantId, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Xero P&L error (${res.status}): ${await res.text()}`);
  const json = await res.json();
  const report = json?.Reports?.[0];
  const lines: RawLine[] = [];
  if (report?.Rows) walkRows(report.Rows, lines);
  return lines;
}

// ─── Compute one month ────────────────────────────────────────────────────────

async function computeMonth(
  sc: SC, token: string, tenant: { id: string; name: string }, period: string,
  accountsById: Map<string, { code: string; name: string }>,
  accountsByName: Map<string, { code: string; name: string }>,
  map: Map<string, { bucket: string; behaviour: string }>,
) {
  const { from, to, firstDay } = monthBounds(period);
  const raw = await fetchPL(token, tenant.id, from, to);

  // Aggregate by account_code
  const lineByCode = new Map<string, { name: string; amount: number; bucket: string; behaviour: string }>();
  let unmappedCount = 0, unmappedAmount = 0;

  for (const r of raw) {
    if (r.amount === 0) continue;
    let resolved = r.accountId ? accountsById.get(r.accountId) : undefined;
    if (!resolved) resolved = accountsByName.get(r.name.trim().toLowerCase());
    const code = resolved?.code ?? `?:${r.name.trim()}`;
    const name = resolved?.name ?? r.name.trim();
    const m = map.get(code);
    const bucket = m?.bucket ?? "unmapped";
    const behaviour = m?.behaviour ?? "n/a";

    const existing = lineByCode.get(code);
    if (existing) existing.amount += r.amount;
    else lineByCode.set(code, { name, amount: r.amount, bucket, behaviour });
  }

  // Derived metrics
  let revenue = 0, cogs = 0, opex = 0, variable = 0, fixed = 0;
  for (const [, l] of lineByCode) {
    if (l.bucket === "revenue") revenue += l.amount;
    else if (l.bucket === "cogs") { cogs += l.amount; if (l.behaviour === "variable") variable += l.amount; else if (l.behaviour === "fixed") fixed += l.amount; }
    else if (l.bucket === "opex") { opex += l.amount; if (l.behaviour === "variable") variable += l.amount; else if (l.behaviour === "fixed") fixed += l.amount; }
    else if (l.bucket === "unmapped") { unmappedCount++; unmappedAmount += l.amount; }
    // depreciation / amortisation / interest / tax excluded from EBITDA by bucket
  }

  const grossProfit = revenue - cogs;
  const grossProfitPct = revenue !== 0 ? grossProfit / revenue : null;
  const ebitda = grossProfit - opex;
  const contribution = revenue - variable;
  const cmPct = revenue !== 0 ? contribution / revenue : null;
  const breakeven = (cmPct && cmPct !== 0) ? fixed / cmPct : null;
  const pctToBreakeven = (breakeven && breakeven !== 0) ? revenue / breakeven : null;
  const marginOfSafety = breakeven != null ? revenue - breakeven : null;

  // Write snapshot
  const { error: snapErr } = await sc.from("finance_snapshot").upsert({
    period_month: firstDay,
    revenue, cogs, gross_profit: grossProfit, gross_profit_pct: grossProfitPct,
    opex_ebitda: opex, ebitda, variable_costs: variable, fixed_costs: fixed,
    contribution, cm_pct: cmPct, breakeven_revenue: breakeven,
    pct_to_breakeven: pctToBreakeven, margin_of_safety: marginOfSafety,
    unmapped_count: unmappedCount, unmapped_amount: unmappedAmount,
    source_run_at: new Date().toISOString(), xero_org: tenant.name,
  });
  if (snapErr) throw new Error(`snapshot upsert: ${snapErr.message}`);

  // Replace expense lines for the month
  await sc.from("finance_expense_line").delete().eq("period_month", firstDay);
  const rows = [...lineByCode.entries()].map(([code, l]) => ({
    period_month: firstDay, account_code: code, account_name: l.name,
    amount: l.amount, bucket: l.bucket, cost_behaviour: l.behaviour,
  }));
  if (rows.length) {
    const { error: lineErr } = await sc.from("finance_expense_line").insert(rows);
    if (lineErr) throw new Error(`expense_line insert: ${lineErr.message}`);
  }

  return { period, revenue, cogs, grossProfit, ebitda, lines: rows.length, unmappedCount };
}

// ─── HTTP entrypoint ──────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const secret = Deno.env.get("FINANCE_CRON_SECRET");
    if (secret && req.headers.get("x-cron-secret") !== secret) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = await req.json().catch(() => ({}));
    let periods: string[];
    if (Array.isArray(body.months) && body.months.length) periods = body.months;
    else if (typeof body.month === "string") periods = [body.month];
    else if (typeof body.backfill === "number") periods = trailingMonths(body.backfill);
    else periods = [currentMonth()];

    const sc = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const token = await getXeroToken(sc);
    const tenant = await getTenant(sc);

    // Load lookup tables once
    const { data: accs } = await sc.from("xero_accounts").select("account_id, code, name");
    const accountsById = new Map<string, { code: string; name: string }>();
    const accountsByName = new Map<string, { code: string; name: string }>();
    for (const a of accs ?? []) {
      if (a.account_id) accountsById.set(a.account_id, { code: a.code, name: a.name });
      if (a.name) accountsByName.set(String(a.name).trim().toLowerCase(), { code: a.code, name: a.name });
    }
    const { data: mapRows } = await sc.from("account_map").select("account_code, ebitda_bucket, cost_behaviour, active");
    const map = new Map<string, { bucket: string; behaviour: string }>();
    for (const m of mapRows ?? []) {
      if (m.active === false) continue;
      map.set(m.account_code, { bucket: m.ebitda_bucket, behaviour: m.cost_behaviour });
    }

    const results = [];
    for (const p of periods) {
      results.push(await computeMonth(sc, token, tenant, p, accountsById, accountsByName, map));
    }

    // Keep the SUPPORT cases rollup current on the same nightly run (Phase 3).
    await sc.rpc("refresh_support_cases_rollup");

    return new Response(JSON.stringify({ ok: true, org: tenant.name, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e?.message ?? e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
