-- Stock Turn: built-to-order assemblies now attribute the WHOLE kit sale
-- (units × main-part qty, revenue, COGS) to the kit's main component — the
-- highest-cost line in the bill of materials — instead of spreading it across
-- every part by cost weight (000007). Minor parts (pins, brackets, fixings)
-- receive nothing. A main part that is itself a built-to-order assembly resolves
-- recursively (≤ 4 levels). Assemblies holding stock stay as their own line.
-- Applied 2026-09-03 via MCP as stock_turn_bom_main_component.
--
-- Caveat: "main" is chosen by Cin7 average cost, so a component with a wrong
-- cost in Cin7 (e.g. a pack received as one unit) can be picked as the main part.

create or replace function stock_turn_report(p_from date, p_to date)
returns table (
  product_id uuid, sku text, name text, category text, brand text, status text,
  on_hand numeric, available numeric, on_order numeric, avg_cost numeric, stock_value numeric,
  avg_stock_value numeric, snapshot_days int,
  qty_sold numeric, revenue numeric, cogs numeric
)
language sql stable security invoker as $$
with recursive excluded as (
  select product_id from cin7_products
  where (drop_ship_mode is not null and drop_ship_mode <> 'No Drop Ship')
     or (product_type is not null and product_type <> 'Stock')
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
bom as (
  select p.product_id assembly_id, (c->>'product_id')::uuid component_id, (c->>'qty')::numeric qty
  from cin7_products p, jsonb_array_elements(p.bom_components) c
  where p.bom_components is not null
    and (c->>'product_id') ~* '^[0-9a-f-]{36}$' and coalesce((c->>'qty')::numeric, 0) > 0
),
bto as (
  select distinct b.assembly_id from bom b
  left join cur on cur.product_id = b.assembly_id
  where coalesce(cur.on_hand, 0) <= 0
),
main as (
  select assembly_id, component_id, qty from (
    select b.assembly_id, b.component_id, b.qty,
           row_number() over (partition by b.assembly_id order by b.qty * coalesce(p.avg_cost, 0) desc, b.component_id) rn
    from bom b left join cin7_products p on p.product_id = b.component_id
  ) m where rn = 1
),
x as (
  select l.product_id, l.qty, l.revenue, l.cost, 0 lvl
  from cin7_sale_product_lines l
  where l.invoice_month between p_from and p_to
  union all
  select m.component_id, x.qty * m.qty, x.revenue, x.cost, x.lvl + 1
  from x
  join bto on bto.assembly_id = x.product_id
  join main m on m.assembly_id = x.product_id
  where x.lvl < 4
),
sales as (
  select product_id, sum(qty) qty, sum(revenue) revenue, sum(cost) cogs
  from x
  where product_id not in (select assembly_id from bto)
  group by product_id
),
base as (
  select product_id from cur
  union select product_id from sales
)
select b.product_id,
  coalesce(p.sku, cur.sku, '?') as sku,
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
where b.product_id not in (select product_id from excluded);
$$;

create or replace function stock_turn_trend(p_min_stock numeric default 0)
returns table (period_month date, revenue numeric, cogs numeric, avg_stock_value numeric, snapshot_days int)
language sql stable security invoker as $$
with recursive excluded as (
  select product_id from cin7_products
  where (drop_ship_mode is not null and drop_ship_mode <> 'No Drop Ship')
     or (product_type is not null and product_type <> 'Stock')
),
latest as (select max(snapshot_date) d from cin7_stock_snapshots),
cur as (
  select s.* from cin7_stock_snapshots s, latest where s.snapshot_date = latest.d
),
bom as (
  select p.product_id assembly_id, (c->>'product_id')::uuid component_id, (c->>'qty')::numeric qty
  from cin7_products p, jsonb_array_elements(p.bom_components) c
  where p.bom_components is not null
    and (c->>'product_id') ~* '^[0-9a-f-]{36}$' and coalesce((c->>'qty')::numeric, 0) > 0
),
bto as (
  select distinct b.assembly_id from bom b
  left join cur on cur.product_id = b.assembly_id
  where coalesce(cur.on_hand, 0) <= 0
),
main as (
  select assembly_id, component_id, qty from (
    select b.assembly_id, b.component_id, b.qty,
           row_number() over (partition by b.assembly_id order by b.qty * coalesce(p.avg_cost, 0) desc, b.component_id) rn
    from bom b left join cin7_products p on p.product_id = b.component_id
  ) m where rn = 1
),
x as (
  select l.product_id, l.invoice_month, l.revenue, l.cost, 0 lvl
  from cin7_sale_product_lines l
  union all
  select m.component_id, x.invoice_month, x.revenue, x.cost, x.lvl + 1
  from x
  join bto on bto.assembly_id = x.product_id
  join main m on m.assembly_id = x.product_id
  where x.lvl < 4
),
keep as (
  select s.product_id from cur s
  where s.stock_value >= p_min_stock and s.on_hand > 0
    and s.product_id not in (select product_id from excluded)
  union
  select product_id from x where p_min_stock <= 0
    and product_id not in (select product_id from excluded)
),
s as (
  select invoice_month m, sum(revenue) revenue, sum(cost) cogs
  from x
  where product_id not in (select assembly_id from bto)
    and product_id in (select product_id from keep)
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
