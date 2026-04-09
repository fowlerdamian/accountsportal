-- upwork_sync_log — audit trail for all Upwork API calls (in and out)
create table public.upwork_sync_log (
  id            uuid primary key default gen_random_uuid(),
  direction     text not null check (direction in ('inbound', 'outbound')),
  entity_type   text not null,
  entity_id     uuid,
  status        text not null check (status in ('success', 'error')),
  error_message text,
  metadata      jsonb,
  created_at    timestamptz not null default now()
);

alter table public.upwork_sync_log enable row level security;

create policy "Staff read upwork_sync_log"
  on public.upwork_sync_log for select to authenticated
  using (public.is_staff(auth.uid()));

-- ── Cron jobs ─────────────────────────────────────────────────────────────────
-- Requires: pg_cron + pg_net extensions (enable both in Supabase dashboard under
-- Database → Extensions before running these).
--
-- Replace <PROJECT_URL> and <SERVICE_ROLE_KEY> with your project values, then run
-- these manually in the Supabase SQL editor after deploying migrations:
--
-- SELECT cron.schedule(
--   'hub-overdue-check',
--   '0 22 * * *',   -- 8 AM AEST daily (UTC+10)
--   $$
--     SELECT net.http_post(
--       url     := '<PROJECT_URL>/functions/v1/contractor-hub-notifications',
--       body    := '{"type":"overdue_check"}'::jsonb,
--       headers := '{"Content-Type":"application/json","Authorization":"Bearer <SERVICE_ROLE_KEY>"}'::jsonb
--     );
--   $$
-- );
--
-- SELECT cron.schedule(
--   'upwork-sync-inbound',
--   '*/15 * * * *',
--   $$
--     SELECT net.http_post(
--       url     := '<PROJECT_URL>/functions/v1/upwork-sync-inbound',
--       body    := '{}'::jsonb,
--       headers := '{"Content-Type":"application/json","Authorization":"Bearer <SERVICE_ROLE_KEY>"}'::jsonb
--     );
--   $$
-- );
