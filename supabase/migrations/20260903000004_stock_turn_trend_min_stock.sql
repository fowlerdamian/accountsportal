-- Stock Turn: the dashboard hides every line holding < $100 of stock (at cost),
-- so the trend RPC takes the same threshold (applied 2026-09-03 via MCP as
-- stock_turn_trend_min_stock). Default 0 keeps the old behaviour.
drop function if exists stock_turn_trend();
create or replace function stock_turn_trend(p_min_stock numeric default 0)
returns table (period_month date, revenue numeric, cogs numeric, avg_stock_value numeric, snapshot_days int)
language sql stable security invoker as $$
with dropship as (
  select product_id from cin7_products
  where drop_ship_mode is not null and drop_ship_mode <> 'No Drop Ship'
),
latest as (select max(snapshot_date) d from cin7_stock_snapshots),
keep as (
  select s.product_id from cin7_stock_snapshots s, latest
  where s.snapshot_date = latest.d and s.stock_value >= p_min_stock
    and s.product_id not in (select product_id from dropship)
  union
  -- with no threshold, products with no stock at all still count toward sales
  select product_id from cin7_sale_product_lines where p_min_stock <= 0
    and product_id not in (select product_id from dropship)
),
s as (
  select invoice_month m, sum(revenue) revenue, sum(cost) cogs
  from cin7_sale_product_lines
  where product_id in (select product_id from keep)
  group by 1
),
inv as (
  select date_trunc('month', snapshot_date)::date m,
         sum(stock_value) / count(distinct snapshot_date) v,
         count(distinct snapshot_date) n
  from cin7_stock_snapshots
  where product_id in (select product_id from keep)
  group by 1
)
select coalesce(s.m, inv.m), coalesce(s.revenue, 0), coalesce(s.cogs, 0), inv.v, coalesce(inv.n, 0)::int
from s full join inv on inv.m = s.m
order by 1;
$$;
grant execute on function stock_turn_trend(numeric) to authenticated;
