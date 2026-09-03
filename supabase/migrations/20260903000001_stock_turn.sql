-- Stock Turn dashboard (Accounts › Stock Turn) — per-SKU stock turn and the
-- overall Stock Turn Ratio (= stock turn x GP%, target 200+).
--
--   cin7_products            product master (SKU, category, AverageCost) refreshed daily
--   cin7_sale_product_lines  per-sale x month x product invoice lines (qty/revenue/cost),
--                            written by stat-breakdown-sync alongside the bucket lines
--   cin7_stock_snapshots     daily stock on hand at cost, per product (stock-turn-snapshot fn)
--
-- Stock turn  = annualised COGS / average stock value (mean of the daily snapshots in the
--               window; falls back to the latest snapshot while history accumulates)
-- GP%         = (revenue - COGS) / revenue
-- Ratio       = stock turn x GP% (as a percentage number) — 5 turns x 40% GP = 200
--
-- pg_cron (created directly): stock-turn-daily  5 14 * * *  -> stock-turn-snapshot edge fn

create table if not exists cin7_products (
  product_id uuid primary key,
  sku text not null,
  name text,
  category text,
  brand text,
  status text,
  avg_cost numeric not null default 0,
  updated_at timestamptz not null default now()
);
create index if not exists cin7_products_sku_idx on cin7_products (sku);

create table if not exists cin7_sale_product_lines (
  sale_id uuid not null,
  invoice_month date not null,
  product_id uuid not null,
  sku text,
  qty numeric not null default 0,       -- units invoiced, net of credit notes
  revenue numeric not null default 0,   -- GST-exclusive, net of discounts + credit notes
  cost numeric not null default 0,      -- qty x Cin7 AverageCost at invoice time
  synced_at timestamptz not null default now(),
  primary key (sale_id, invoice_month, product_id)
);
create index if not exists cin7_sale_product_lines_product_idx on cin7_sale_product_lines (product_id, invoice_month);
create index if not exists cin7_sale_product_lines_month_idx on cin7_sale_product_lines (invoice_month);

create table if not exists cin7_stock_snapshots (
  snapshot_date date not null,          -- AEST calendar date
  product_id uuid not null,
  sku text,
  on_hand numeric not null default 0,   -- summed across locations/bins
  available numeric not null default 0,
  allocated numeric not null default 0,
  on_order numeric not null default 0,
  avg_cost numeric not null default 0,
  stock_value numeric generated always as (on_hand * avg_cost) stored,
  primary key (snapshot_date, product_id)
);
create index if not exists cin7_stock_snapshots_product_idx on cin7_stock_snapshots (product_id, snapshot_date);

alter table cin7_stat_sync_state
  add column if not exists last_snapshot timestamptz,
  add column if not exists last_snapshot_error text;

alter table cin7_products enable row level security;
alter table cin7_sale_product_lines enable row level security;
alter table cin7_stock_snapshots enable row level security;
create policy "authenticated read products" on cin7_products for select to authenticated using (true);
create policy "authenticated read product lines" on cin7_sale_product_lines for select to authenticated using (true);
create policy "authenticated read stock snapshots" on cin7_stock_snapshots for select to authenticated using (true);

-- One row per product for a month window [p_from, p_to] (first-of-month dates, inclusive):
-- latest stock position, average stock value over the window's snapshots, and sales.
create or replace function stock_turn_report(p_from date, p_to date)
returns table (
  product_id uuid, sku text, name text, category text, brand text, status text,
  on_hand numeric, available numeric, on_order numeric, avg_cost numeric, stock_value numeric,
  avg_stock_value numeric, snapshot_days int,
  qty_sold numeric, revenue numeric, cogs numeric
)
language sql stable security invoker as $$
with latest as (select max(snapshot_date) d from cin7_stock_snapshots),
cur as (
  select s.* from cin7_stock_snapshots s, latest where s.snapshot_date = latest.d
),
win as (
  select count(distinct snapshot_date) days
  from cin7_stock_snapshots
  where snapshot_date >= p_from and snapshot_date < (p_to + interval '1 month')::date
),
avgv as (
  -- products absent from a day's snapshot held no stock that day, so divide by
  -- the number of snapshot days in the window rather than rows per product
  select product_id, sum(stock_value) / nullif((select days from win), 0) v
  from cin7_stock_snapshots
  where snapshot_date >= p_from and snapshot_date < (p_to + interval '1 month')::date
  group by product_id
),
sales as (
  select product_id, max(sku) sku, sum(qty) qty, sum(revenue) revenue, sum(cost) cogs
  from cin7_sale_product_lines
  where invoice_month between p_from and p_to
  group by product_id
),
base as (
  select product_id from cur
  union select product_id from sales
)
select b.product_id,
  coalesce(p.sku, cur.sku, sales.sku, '?') as sku,
  p.name, p.category, p.brand, p.status,
  coalesce(cur.on_hand, 0), coalesce(cur.available, 0), coalesce(cur.on_order, 0),
  coalesce(cur.avg_cost, p.avg_cost, 0),
  coalesce(cur.stock_value, 0),
  coalesce(avgv.v, cur.stock_value, 0),
  coalesce((select days from win), 0)::int,
  coalesce(sales.qty, 0), coalesce(sales.revenue, 0), coalesce(sales.cogs, 0)
from base b
left join cin7_products p on p.product_id = b.product_id
left join cur on cur.product_id = b.product_id
left join avgv on avgv.product_id = b.product_id
left join sales on sales.product_id = b.product_id;
$$;

-- Monthly totals for the trend chart: sales from invoice lines + the month's
-- average total stock value (null for months before snapshots began).
create or replace function stock_turn_trend()
returns table (period_month date, revenue numeric, cogs numeric, avg_stock_value numeric, snapshot_days int)
language sql stable security invoker as $$
with s as (
  select invoice_month m, sum(revenue) revenue, sum(cost) cogs
  from cin7_sale_product_lines group by 1
),
inv as (
  select date_trunc('month', snapshot_date)::date m,
         sum(stock_value) / count(distinct snapshot_date) v,
         count(distinct snapshot_date) n
  from cin7_stock_snapshots group by 1
)
select coalesce(s.m, inv.m), coalesce(s.revenue, 0), coalesce(s.cogs, 0), inv.v, coalesce(inv.n, 0)::int
from s full join inv on inv.m = s.m
order by 1;
$$;

grant execute on function stock_turn_report(date, date) to authenticated;
grant execute on function stock_turn_trend() to authenticated;
