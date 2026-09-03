-- Stock Turn: exclude drop-ship products (applied 2026-09-03 via MCP, two steps:
-- stock_turn_drop_ship_columns + stock_turn_exclude_drop_ship).
-- cin7_products.drop_ship_mode = Cin7 DropShipMode ("No Drop Ship" | "Optional Drop Ship"
-- | "Always Drop Ship"), captured by stock-turn-snapshot. Anything other than
-- "No Drop Ship" is never warehouse stock, so both RPCs leave it out entirely
-- (stock, sales and the trend). Null (not yet snapshotted) is kept.

alter table cin7_products
  add column if not exists drop_ship_mode text,
  add column if not exists tags text;

create or replace function stock_turn_report(p_from date, p_to date)
returns table (
  product_id uuid, sku text, name text, category text, brand text, status text,
  on_hand numeric, available numeric, on_order numeric, avg_cost numeric, stock_value numeric,
  avg_stock_value numeric, snapshot_days int,
  qty_sold numeric, revenue numeric, cogs numeric
)
language sql stable security invoker as $$
with dropship as (
  select product_id from cin7_products
  where drop_ship_mode is not null and drop_ship_mode <> 'No Drop Ship'
),
latest as (select max(snapshot_date) d from cin7_stock_snapshots),
cur as (
  select s.* from cin7_stock_snapshots s, latest where s.snapshot_date = latest.d
),
win as (
  select count(distinct snapshot_date) days
  from cin7_stock_snapshots
  where snapshot_date >= p_from and snapshot_date < (p_to + interval '1 month')::date
),
avgv as (
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
left join sales on sales.product_id = b.product_id
where b.product_id not in (select product_id from dropship);
$$;

create or replace function stock_turn_trend()
returns table (period_month date, revenue numeric, cogs numeric, avg_stock_value numeric, snapshot_days int)
language sql stable security invoker as $$
with dropship as (
  select product_id from cin7_products
  where drop_ship_mode is not null and drop_ship_mode <> 'No Drop Ship'
),
s as (
  select invoice_month m, sum(revenue) revenue, sum(cost) cogs
  from cin7_sale_product_lines
  where product_id not in (select product_id from dropship)
  group by 1
),
inv as (
  select date_trunc('month', snapshot_date)::date m,
         sum(stock_value) / count(distinct snapshot_date) v,
         count(distinct snapshot_date) n
  from cin7_stock_snapshots
  where product_id not in (select product_id from dropship)
  group by 1
)
select coalesce(s.m, inv.m), coalesce(s.revenue, 0), coalesce(s.cogs, 0), inv.v, coalesce(inv.n, 0)::int
from s full join inv on inv.m = s.m
order by 1;
$$;
