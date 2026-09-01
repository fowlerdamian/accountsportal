-- Stat Breakdown sync hardening (applied 2026-09-01 via MCP):
-- - running_until lease so overlapping runs (cron vs manual Sync) never fight
--   over Cin7's 60 calls/min quota or process the same sales concurrently
-- - cached Cin7 lookup maps (product buckets / customer types, 12h TTL) so
--   each run stops respending ~10 API calls rebuilding them

alter table cin7_stat_sync_state add column if not exists running_until timestamptz;

create table if not exists cin7_stat_maps (
  key text primary key,
  payload jsonb not null,
  fetched_at timestamptz not null default now()
);
alter table cin7_stat_maps enable row level security;
