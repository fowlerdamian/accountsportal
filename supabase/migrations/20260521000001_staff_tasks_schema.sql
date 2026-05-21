-- ─────────────────────────────────────────────────────────────────────────────
-- staff_tasks  —  lite cross-staff task tracker with Eisenhower scoring,
-- dependency chains, and per-user Google Chat webhook URLs.
--
-- See plan: C:\Users\Damian\.claude\plans\fuzzy-roaming-sprout.md
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Per-user Google Chat webhook (configured in /settings) ───────────────────
alter table public.profiles
  add column if not exists google_chat_webhook_url text;

-- ── Tasks table ──────────────────────────────────────────────────────────────
create table public.staff_tasks (
  id                 uuid primary key default gen_random_uuid(),
  title              text not null,
  description        text,
  status             text not null default 'not_started'
                       check (status in ('not_started','in_progress','blocked','done')),
  created_by         uuid not null references auth.users(id) on delete restrict,
  assigned_to        uuid not null references auth.users(id) on delete restrict,
  due_date           date,
  urgency            smallint check (urgency between 1 and 5),
  importance         smallint check (importance between 1 and 5),
  blocked_by_task_id uuid references public.staff_tasks(id) on delete set null,
  parent_task_id     uuid references public.staff_tasks(id) on delete set null,
  completed_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index staff_tasks_assigned_to_idx on public.staff_tasks(assigned_to);
create index staff_tasks_created_by_idx  on public.staff_tasks(created_by);
create index staff_tasks_status_idx      on public.staff_tasks(status);
create index staff_tasks_due_date_idx    on public.staff_tasks(due_date);
create index staff_tasks_blocked_by_idx  on public.staff_tasks(blocked_by_task_id);

-- ── Comments thread ──────────────────────────────────────────────────────────
create table public.staff_task_comments (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references public.staff_tasks(id) on delete cascade,
  author_id  uuid not null references auth.users(id) on delete restrict,
  body       text not null,
  created_at timestamptz not null default now()
);
create index staff_task_comments_task_idx on public.staff_task_comments(task_id);

-- ── RLS — v1 keeps it simple: any authenticated user can read all tasks
-- (the portal is staff-only). Mutations are restricted to assignee / creator.
alter table public.staff_tasks enable row level security;

create policy "Authenticated can view staff_tasks"
  on public.staff_tasks for select to authenticated using (true);

create policy "Authenticated can insert own staff_tasks"
  on public.staff_tasks for insert to authenticated
  with check (auth.uid() = created_by);

create policy "Assignee or creator can update staff_tasks"
  on public.staff_tasks for update to authenticated
  using (auth.uid() in (assigned_to, created_by));

create policy "Creator can delete staff_tasks"
  on public.staff_tasks for delete to authenticated
  using (auth.uid() = created_by);

alter table public.staff_task_comments enable row level security;

create policy "Authenticated can view staff_task_comments"
  on public.staff_task_comments for select to authenticated using (true);

create policy "Authenticated can insert own staff_task_comments"
  on public.staff_task_comments for insert to authenticated
  with check (auth.uid() = author_id);

create policy "Author can delete own staff_task_comments"
  on public.staff_task_comments for delete to authenticated
  using (auth.uid() = author_id);

-- ── updated_at trigger ───────────────────────────────────────────────────────
create trigger trg_staff_tasks_updated_at
  before update on public.staff_tasks
  for each row execute function public.update_updated_at_column();

-- ── completed_at auto-stamp ──────────────────────────────────────────────────
create or replace function public.handle_staff_task_completed_at()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'done' and (old.status is null or old.status <> 'done') then
    new.completed_at = now();
  elsif new.status <> 'done' and old.status = 'done' then
    new.completed_at = null;
  end if;
  return new;
end;
$$;

create trigger trg_staff_tasks_completed_at
  before update on public.staff_tasks
  for each row when (new.status is distinct from old.status)
  execute function public.handle_staff_task_completed_at();

-- ── Auto-unblock parent when its blocker is marked done ──────────────────────
create or replace function public.handle_staff_task_blocker_done()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'done' and (old.status is null or old.status <> 'done') then
    update public.staff_tasks
      set status = 'not_started'
      where blocked_by_task_id = new.id and status = 'blocked';
  end if;
  return new;
end;
$$;

create trigger trg_staff_tasks_handle_blocker_done
  after update on public.staff_tasks
  for each row when (new.status is distinct from old.status)
  execute function public.handle_staff_task_blocker_done();

-- ── Realtime publication (so client channel subscriptions get row events) ────
-- The 20260409000005_realtime.sql migration enabled it for hub tables; mirror
-- the same setup here so the TaskDock can subscribe to live changes.
alter publication supabase_realtime add table public.staff_tasks;
alter publication supabase_realtime add table public.staff_task_comments;
