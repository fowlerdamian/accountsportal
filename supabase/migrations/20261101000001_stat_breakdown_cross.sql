-- Customer type × product category cross-tab per month, for the Sales Mix
-- cross-filter panel. Same source and security as stat_breakdown_monthly.
create or replace view public.stat_breakdown_cross
with (security_invoker = true) as
select invoice_month as period_month,
       customer_type,
       bucket,
       sum(revenue) as revenue,
       sum(cost) as cost,
       sum(revenue) - sum(cost) as profit
from public.cin7_sale_stat_lines
group by invoice_month, customer_type, bucket;

grant select on public.stat_breakdown_cross to authenticated, service_role;
