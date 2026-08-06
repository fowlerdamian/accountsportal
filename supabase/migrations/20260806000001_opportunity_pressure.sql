-- ─────────────────────────────────────────────────────────────────────────────
-- Opportunity Pressure module
-- Mirrors HubSpot deals (opportunities) and engagements (opportunity_activities).
-- Tasks are NOT stored here — they live in staff_tasks and are linked back via
-- staff_tasks.opportunity_id (the one nullable link column agreed for this
-- module). opportunity_task_sync holds HubSpot write-back linkage only; it is
-- sync metadata, never a second task register.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Opportunities (mirrored from HubSpot deals; only open deals render) ──────
create table public.opportunities (
  id                  uuid primary key default gen_random_uuid(),
  hubspot_deal_id     text not null unique,
  account_name        text not null default '',
  deal_name           text not null,
  amount              numeric(14,2),
  probability         numeric(5,4) check (probability >= 0 and probability <= 1),
  expected_close_date date,
  owner_name          text,
  owner_email         text,
  stage               text,
  division            text check (division in ('TrailBait', 'FleetCraft', 'OEM')),
  is_open             boolean not null default true,
  is_parked           boolean not null default false,
  hubspot_created_at  timestamptz,
  last_synced_at      timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index idx_opportunities_open    on public.opportunities (is_open) where is_open;
create index idx_opportunities_hs_deal on public.opportunities (hubspot_deal_id);

-- ── Activities (mirrored from HubSpot engagements + locally logged) ──────────
create table public.opportunity_activities (
  id                     uuid primary key default gen_random_uuid(),
  opportunity_id         uuid not null references public.opportunities(id) on delete cascade,
  -- Prefixed "<object>:<id>" (e.g. "note:123") — HubSpot ids are only unique
  -- per object type, so the prefix keeps notes/calls/emails/meetings apart.
  hubspot_engagement_id  text unique,
  type                   text not null check (type in ('note', 'call', 'email', 'meeting')),
  note                   text,
  owner_name             text,
  occurred_at            timestamptz not null,
  created_at             timestamptz not null default now()
);

create index idx_opp_activities_opp_time
  on public.opportunity_activities (opportunity_id, occurred_at desc);

-- ── Tasks app link (the single agreed column) ────────────────────────────────
alter table public.staff_tasks
  add column opportunity_id uuid references public.opportunities(id) on delete set null;

create index idx_staff_tasks_opportunity on public.staff_tasks (opportunity_id)
  where opportunity_id is not null;

-- ── HubSpot task write-back linkage (sync metadata only) ─────────────────────
create table public.opportunity_task_sync (
  staff_task_id      uuid primary key references public.staff_tasks(id) on delete cascade,
  opportunity_id     uuid not null references public.opportunities(id) on delete cascade,
  hubspot_task_id    text,
  last_pushed_status text,
  updated_at         timestamptz not null default now()
);

-- ── updated_at trigger ───────────────────────────────────────────────────────
create or replace function public.handle_opportunity_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_opportunities_updated_at
  before update on public.opportunities
  for each row execute function public.handle_opportunity_updated_at();

-- ── RLS — blanket authenticated, matching the other sales-side modules ───────
alter table public.opportunities          enable row level security;
alter table public.opportunity_activities enable row level security;
alter table public.opportunity_task_sync  enable row level security;

create policy "Authenticated users can manage opportunities"
  on public.opportunities for all to authenticated
  using (true) with check (true);

create policy "Authenticated users can manage opportunity activities"
  on public.opportunity_activities for all to authenticated
  using (true) with check (true);

create policy "Authenticated users can manage opportunity task sync"
  on public.opportunity_task_sync for all to authenticated
  using (true) with check (true);

-- ── Realtime (portal already uses supabase_realtime elsewhere) ───────────────
alter publication supabase_realtime add table public.opportunities;
alter publication supabase_realtime add table public.opportunity_activities;
