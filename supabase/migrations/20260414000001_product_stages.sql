-- ── 1. Add new values to the project_type enum ───────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_enum
    where enumlabel = 'web'
      and enumtypid = 'public.project_type'::regtype
  ) then
    alter type public.project_type add value 'web';
  end if;
end$$;

do $$
begin
  if not exists (
    select 1 from pg_enum
    where enumlabel = 'new_product'
      and enumtypid = 'public.project_type'::regtype
  ) then
    alter type public.project_type add value 'new_product';
  end if;
end$$;

-- ── 2. project_stages table ───────────────────────────────────────────────────
create table if not exists public.project_stages (
  id          uuid        primary key default gen_random_uuid(),
  project_id  uuid        not null references public.projects(id) on delete cascade,
  name        text        not null,
  position    int         not null,
  start_date  date,
  end_date    date,
  is_active   boolean     not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists project_stages_project_idx on public.project_stages(project_id);

alter table public.project_stages enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'project_stages' and policyname = 'Staff read project stages'
  ) then
    create policy "Staff read project stages"
      on public.project_stages for select to authenticated
      using (true);
  end if;
end$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'project_stages' and policyname = 'Staff insert project stages'
  ) then
    create policy "Staff insert project stages"
      on public.project_stages for insert to authenticated
      with check (true);
  end if;
end$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'project_stages' and policyname = 'Staff update project stages'
  ) then
    create policy "Staff update project stages"
      on public.project_stages for update to authenticated
      using (true);
  end if;
end$$;
