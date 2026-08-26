-- ShipStation two-way integration for replacement picks.
alter table public.action_items
  add column if not exists shipstation_order_key   text,
  add column if not exists shipstation_shipment_id text;
create index if not exists action_items_ss_order_idx on public.action_items (shipstation_order_id) where is_replacement_pick;

-- Backup poll for the SHIP_NOTIFY webhook: every 30 min, ask ShipStation about open picks.
select cron.unschedule(jobid) from cron.job where jobname = 'shipstation-sync';
select cron.schedule('shipstation-sync', '*/30 * * * *', $$
  SELECT net.http_post(
    url := 'https://nvlezbqolzwixquusbfo.supabase.co/functions/v1/shipstation-webhook',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im52bGV6YnFvbHp3aXhxdXVzYmZvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDk4MDEzMywiZXhwIjoyMDkwNTU2MTMzfQ.UtLSrpPuLWJsvlsusvB_AnhNG9d6BxoPdwzzlkLLR7o"}'::jsonb,
    body := '{"action":"sync"}'::jsonb)
$$);
