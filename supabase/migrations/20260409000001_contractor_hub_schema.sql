-- ─────────────────────────────────────────────────────────────────────────────
-- Contractor Hub Schema
-- ─────────────────────────────────────────────────────────────────────────────

-- profiles (standard Supabase pattern — mirrors auth.users for app joins)
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  full_name  text,
  email      text,
  created_at timestamptz not null default now()
);

-- auto-create profile on new auth user
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    new.email
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─────────────────────────────────────────────────────────────────────────────
-- contractors
-- ─────────────────────────────────────────────────────────────────────────────

create table public.contractors (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  email              text,
  phone              text,
  role               text not null,
  hourly_rate        numeric(10,2),
  status             text not null default 'active'
                       check (status in ('active', 'paused', 'ended')),
  source             text not null default 'direct'
                       check (source in ('upwork', 'direct')),
  upwork_contract_id text,
  upwork_profile_url text,
  avatar_url         text,
  notes              text,
  can_login          boolean not null default false,
  user_id            uuid references auth.users(id),
  created_at         timestamptz not null default now()
);

alter table public.contractors enable row level security;

-- staff: full access
create policy "Staff read contractors"
  on public.contractors for select to authenticated
  using (public.is_staff(auth.uid()));

create policy "Staff insert contractors"
  on public.contractors for insert to authenticated
  with check (public.is_staff(auth.uid()));

create policy "Staff update contractors"
  on public.contractors for update to authenticated
  using (public.is_staff(auth.uid()));

-- contractor user: read own row
create policy "Contractor reads own row"
  on public.contractors for select to authenticated
  using (user_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────────────
-- projects
-- ─────────────────────────────────────────────────────────────────────────────

create table public.projects (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  description      text,
  type             text not null default 'other'
                     check (type in ('product', 'website', 'other')),
  status           text not null default 'planning'
                     check (status in ('planning', 'active', 'on_hold', 'complete')),
  budget_allocated numeric(10,2),
  start_date       date,
  due_date         date,
  created_at       timestamptz not null default now()
);

alter table public.projects enable row level security;

create policy "Staff read projects"
  on public.projects for select to authenticated
  using (public.is_staff(auth.uid()));

create policy "Staff insert projects"
  on public.projects for insert to authenticated
  with check (public.is_staff(auth.uid()));

create policy "Staff update projects"
  on public.projects for update to authenticated
  using (public.is_staff(auth.uid()));

-- contractor user: read projects where they have assigned tasks
create policy "Contractor reads assigned projects"
  on public.projects for select to authenticated
  using (
    exists (
      select 1 from public.tasks t
      join public.contractors c on c.id = t.assigned_to
      where t.project_id = projects.id
        and c.user_id = auth.uid()
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- tasks
-- ─────────────────────────────────────────────────────────────────────────────

create table public.tasks (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references public.projects(id) on delete cascade,
  parent_task_id uuid references public.tasks(id) on delete cascade,
  title          text not null,
  description    text,
  assigned_to    uuid references public.contractors(id),
  status         text not null default 'backlog'
                   check (status in ('backlog', 'in_progress', 'review', 'done')),
  priority       text not null default 'medium'
                   check (priority in ('low', 'medium', 'high', 'urgent')),
  due_date       date,
  position       integer not null default 0,
  created_at     timestamptz not null default now()
);

create index tasks_project_id_idx   on public.tasks(project_id);
create index tasks_assigned_to_idx  on public.tasks(assigned_to);
create index tasks_parent_task_idx  on public.tasks(parent_task_id);
create index tasks_status_due_idx   on public.tasks(status, due_date);

alter table public.tasks enable row level security;

create policy "Staff read tasks"
  on public.tasks for select to authenticated
  using (public.is_staff(auth.uid()));

create policy "Staff insert tasks"
  on public.tasks for insert to authenticated
  with check (public.is_staff(auth.uid()));

create policy "Staff update tasks"
  on public.tasks for update to authenticated
  using (public.is_staff(auth.uid()));

-- contractor user: read/update own tasks
create policy "Contractor reads own tasks"
  on public.tasks for select to authenticated
  using (
    exists (
      select 1 from public.contractors c
      where c.id = tasks.assigned_to and c.user_id = auth.uid()
    )
  );

create policy "Contractor updates own tasks"
  on public.tasks for update to authenticated
  using (
    exists (
      select 1 from public.contractors c
      where c.id = tasks.assigned_to and c.user_id = auth.uid()
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- time_entries
-- ─────────────────────────────────────────────────────────────────────────────

create table public.time_entries (
  id            uuid primary key default gen_random_uuid(),
  contractor_id uuid not null references public.contractors(id),
  project_id    uuid not null references public.projects(id),
  task_id       uuid references public.tasks(id),
  hours         numeric(5,2) not null check (hours > 0),
  description   text,
  date          date not null default current_date,
  source        text not null default 'manual'
                  check (source in ('manual', 'timer', 'upwork')),
  created_at    timestamptz not null default now()
);

create index time_entries_project_idx    on public.time_entries(project_id);
create index time_entries_contractor_idx on public.time_entries(contractor_id);
create index time_entries_date_idx       on public.time_entries(date);

alter table public.time_entries enable row level security;

create policy "Staff read time_entries"
  on public.time_entries for select to authenticated
  using (public.is_staff(auth.uid()));

create policy "Staff insert time_entries"
  on public.time_entries for insert to authenticated
  with check (public.is_staff(auth.uid()));

create policy "Staff update time_entries"
  on public.time_entries for update to authenticated
  using (public.is_staff(auth.uid()));

create policy "Contractor reads own time_entries"
  on public.time_entries for select to authenticated
  using (
    exists (
      select 1 from public.contractors c
      where c.id = time_entries.contractor_id and c.user_id = auth.uid()
    )
  );

create policy "Contractor inserts own time_entries"
  on public.time_entries for insert to authenticated
  with check (
    exists (
      select 1 from public.contractors c
      where c.id = contractor_id and c.user_id = auth.uid()
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- time_entries_with_cost view
-- Cost = hours * contractor's current hourly_rate (not stored)
-- ─────────────────────────────────────────────────────────────────────────────

create view public.time_entries_with_cost as
  select
    te.*,
    c.hourly_rate,
    case
      when c.hourly_rate is not null then te.hours * c.hourly_rate
      else null
    end as cost
  from public.time_entries te
  join public.contractors c on c.id = te.contractor_id;

-- ─────────────────────────────────────────────────────────────────────────────
-- activity_log
-- ─────────────────────────────────────────────────────────────────────────────

create table public.activity_log (
  id            uuid primary key default gen_random_uuid(),
  contractor_id uuid references public.contractors(id),
  project_id    uuid references public.projects(id),
  task_id       uuid references public.tasks(id),
  type          text not null
                  check (type in ('note', 'update', 'status_change', 'file', 'time_log', 'upwork_message')),
  content       text not null,
  author_id     uuid not null,
  author_name   text not null,
  metadata      jsonb,
  created_at    timestamptz not null default now()
);

create index activity_log_project_idx    on public.activity_log(project_id);
create index activity_log_contractor_idx on public.activity_log(contractor_id);
create index activity_log_created_idx    on public.activity_log(created_at desc);

alter table public.activity_log enable row level security;

create policy "Staff read activity_log"
  on public.activity_log for select to authenticated
  using (public.is_staff(auth.uid()));

create policy "Staff insert activity_log"
  on public.activity_log for insert to authenticated
  with check (public.is_staff(auth.uid()));

create policy "Contractor reads own activity"
  on public.activity_log for select to authenticated
  using (
    exists (
      select 1 from public.contractors c
      where c.id = activity_log.contractor_id and c.user_id = auth.uid()
    )
  );

create policy "Contractor inserts activity"
  on public.activity_log for insert to authenticated
  with check (author_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────────────
-- files
-- ─────────────────────────────────────────────────────────────────────────────

create table public.files (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid references public.projects(id),
  task_id     uuid references public.tasks(id),
  filename    text not null,
  file_url    text not null,
  file_size   bigint not null,
  mime_type   text not null,
  uploaded_by uuid not null references public.profiles(id),
  source      text not null default 'upload'
                check (source in ('upload', 'upwork')),
  created_at  timestamptz not null default now()
);

create index files_project_idx on public.files(project_id);
create index files_task_idx    on public.files(task_id);

alter table public.files enable row level security;

create policy "Staff read files"
  on public.files for select to authenticated
  using (public.is_staff(auth.uid()));

create policy "Staff insert files"
  on public.files for insert to authenticated
  with check (public.is_staff(auth.uid()));

create policy "Contractor reads own project files"
  on public.files for select to authenticated
  using (
    exists (
      select 1 from public.tasks t
      join public.contractors c on c.id = t.assigned_to
      where t.project_id = files.project_id
        and c.user_id = auth.uid()
    )
  );

create policy "Contractor uploads files"
  on public.files for insert to authenticated
  with check (uploaded_by = auth.uid());

-- ─────────────────────────────────────────────────────────────────────────────
-- ai_chat_messages
-- ─────────────────────────────────────────────────────────────────────────────

create table public.ai_chat_messages (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null check (role in ('user', 'assistant')),
  content    text not null,
  metadata   jsonb,
  created_at timestamptz not null default now()
);

create index ai_chat_messages_user_idx on public.ai_chat_messages(user_id, created_at);

alter table public.ai_chat_messages enable row level security;

create policy "Users manage own chat messages"
  on public.ai_chat_messages for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────────────
-- project_budget_summary view
-- ─────────────────────────────────────────────────────────────────────────────

create view public.project_budget_summary as
  select
    p.id                                                                     as project_id,
    p.name,
    p.budget_allocated,
    coalesce(sum(te.hours * c.hourly_rate), 0)::numeric(10,2)               as budget_spent,
    case
      when p.budget_allocated is not null
      then (p.budget_allocated - coalesce(sum(te.hours * c.hourly_rate), 0))::numeric(10,2)
      else null
    end                                                                       as budget_remaining,
    coalesce(sum(te.hours), 0)::numeric(10,2)                                as total_hours
  from public.projects p
  left join public.time_entries te on te.project_id = p.id
  left join public.contractors  c  on c.id = te.contractor_id
  group by p.id, p.name, p.budget_allocated;
