-- Stat Breakdown: monthly revenue/cost by customer type + product bucket,
-- sourced from Cin7 invoice lines (AverageCost captured at invoice time).
-- Applied to production 2026-09-01 via MCP (stat_breakdown_tables).
-- pg_cron jobs (created directly, not in this migration):
--   stat-breakdown-hourly        40 * * * *   -> stat-breakdown-sync edge fn
--   stat-breakdown-drain-temp    */3 * * * *  -> backfill drain, self-removed by
--   stat-breakdown-drain-cleanup */10 * * * * -> unschedules both once pending=0

create table if not exists cin7_sale_stat_lines (
  sale_id uuid not null,
  invoice_month date not null,
  customer_type text not null,   -- Consumers | Distributors | Fleet | Bespoke
  bucket text not null,          -- leaf buckets: Lighting | Behind Grille Lighting | Electrical |
                                 -- Communication | Storage | Safety | Other
                                 -- (UI groups the first three under an Electrical parent)
  revenue numeric not null default 0,  -- GST-exclusive, net of discounts + credit notes
  cost numeric not null default 0,     -- line AverageCost x qty
  synced_at timestamptz not null default now(),
  primary key (sale_id, invoice_month, bucket)
);
create index if not exists cin7_sale_stat_lines_month_idx on cin7_sale_stat_lines (invoice_month);

-- Sales queued for (re)processing by the sync worker
create table if not exists cin7_stat_pending (
  sale_id uuid primary key,
  queued_at timestamptz not null default now()
);

create table if not exists cin7_stat_sync_state (
  id int primary key,
  cursor_updated timestamptz,     -- Cin7 saleList Updated watermark
  backfill_seeded boolean not null default false,
  last_run timestamptz,
  last_error text
);
insert into cin7_stat_sync_state (id, cursor_updated) values (1, '2000-01-01')
on conflict (id) do nothing;

alter table cin7_sale_stat_lines enable row level security;
alter table cin7_stat_pending enable row level security;
alter table cin7_stat_sync_state enable row level security;

create policy "authenticated read stat lines" on cin7_sale_stat_lines
  for select to authenticated using (true);
create policy "authenticated read stat pending" on cin7_stat_pending
  for select to authenticated using (true);
create policy "authenticated read stat sync state" on cin7_stat_sync_state
  for select to authenticated using (true);

-- Monthly rollup consumed by the Stat Breakdown tab
create or replace view stat_breakdown_monthly
with (security_invoker = true) as
select invoice_month as period_month, 'customer' as dimension, customer_type as segment,
       sum(revenue) as revenue, sum(cost) as cost, sum(revenue) - sum(cost) as profit
from cin7_sale_stat_lines
group by invoice_month, customer_type
union all
select invoice_month, 'category', bucket,
       sum(revenue), sum(cost), sum(revenue) - sum(cost)
from cin7_sale_stat_lines
group by invoice_month, bucket;
