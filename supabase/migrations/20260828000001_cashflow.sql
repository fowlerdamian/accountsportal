-- Cash Flow tab (Accounts module) — supporting tables for the cashflow-forecast
-- edge function. All three are written only by the service role; the browser
-- never reads them directly (the edge function returns everything it needs).

-- Weekly forecast log: the FIRST projected closing balance recorded for a week
-- (forecast_at) and the actual closing bank balance once the week has ended.
-- Drives the "last week's forecast variance" trust figure.
create table if not exists public.cashflow_forecast_log (
  week_start     date primary key,           -- Monday
  forecast_close numeric(14,2) not null,
  forecast_at    timestamptz   not null default now(),
  actual_close   numeric(14,2),
  actual_at      timestamptz
);

-- Monthly working-capital metrics (DSO by channel, DIO, DPO, CCC) — one row per
-- calendar month, upserted on every run so the latest month is always current
-- and the previous month gives the trend arrow.
create table if not exists public.cashflow_monthly_metrics (
  period_month   date primary key,           -- first day of month
  dso_dtc        numeric(8,1),
  dso_stockist   numeric(8,1),
  dso_fleet_gov  numeric(8,1),
  dio            numeric(8,1),
  dpo            numeric(8,1),
  ccc            numeric(8,1),
  computed_at    timestamptz not null default now()
);

-- Short-lived cache for the Cin7 block (unbilled POs need one call per PO, so
-- it is refreshed on a TTL rather than every page load).
create table if not exists public.cashflow_cache (
  key        text primary key,
  payload    jsonb not null,
  fetched_at timestamptz not null default now()
);

alter table public.cashflow_forecast_log    enable row level security;
alter table public.cashflow_monthly_metrics enable row level security;
alter table public.cashflow_cache           enable row level security;

create policy "service role manages cashflow_forecast_log"
  on public.cashflow_forecast_log for all to service_role using (true) with check (true);
create policy "service role manages cashflow_monthly_metrics"
  on public.cashflow_monthly_metrics for all to service_role using (true) with check (true);
create policy "service role manages cashflow_cache"
  on public.cashflow_cache for all to service_role using (true) with check (true);
