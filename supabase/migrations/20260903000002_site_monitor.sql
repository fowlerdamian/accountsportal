-- Site monitor — hourly content-integrity check for fleetcraft.com.au
-- (edge fn `site-monitor`). Built after the 2026-08-31 homepage wipe: the page's
-- container blocks lost their inner blocks and the site showed empty sections for
-- two days. The function fetches each page uncached, counts structural markers and
-- emails an alert via Resend; this table dedups alerts and keeps the last result.
--
-- pg_cron (created directly): site-monitor-hourly  20 * * * *  -> site-monitor edge fn

create table if not exists site_monitor_state (
  check_key text primary key,
  label text,
  status text not null default 'unknown',          -- ok | fail | unknown
  consecutive_failures int not null default 0,
  last_checked_at timestamptz,
  last_ok_at timestamptz,
  last_fail_at timestamptz,
  last_alert_at timestamptz,
  last_error text,
  detail jsonb
);

alter table site_monitor_state enable row level security;
create policy "authenticated read site monitor" on site_monitor_state for select to authenticated using (true);
