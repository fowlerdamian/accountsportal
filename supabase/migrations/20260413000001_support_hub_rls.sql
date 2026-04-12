-- Enable Row Level Security on all Support Hub tables.
-- Previously these tables were accessible via the anon key.
-- After this migration only authenticated Supabase sessions can read/write them.

alter table public.cases              enable row level security;
alter table public.action_items       enable row level security;
alter table public.case_attachments   enable row level security;
alter table public.case_updates       enable row level security;
alter table public.team_members       enable row level security;

-- Drop any existing permissive anon policies (idempotent)
drop policy if exists "Allow all" on public.cases;
drop policy if exists "Allow all" on public.action_items;
drop policy if exists "Allow all" on public.case_attachments;
drop policy if exists "Allow all" on public.case_updates;
drop policy if exists "Allow all" on public.team_members;

-- cases
create policy "Authenticated users can manage cases"
  on public.cases for all to authenticated
  using (true) with check (true);

-- action_items
create policy "Authenticated users can manage action_items"
  on public.action_items for all to authenticated
  using (true) with check (true);

-- case_attachments
create policy "Authenticated users can manage case_attachments"
  on public.case_attachments for all to authenticated
  using (true) with check (true);

-- case_updates
create policy "Authenticated users can manage case_updates"
  on public.case_updates for all to authenticated
  using (true) with check (true);

-- team_members: authenticated users can read all, but only update their own row
create policy "Authenticated users can read team_members"
  on public.team_members for select to authenticated
  using (true);

create policy "Users can update their own team_member row"
  on public.team_members for update to authenticated
  using (auth.uid() = id) with check (auth.uid() = id);

create policy "Authenticated users can insert team_members"
  on public.team_members for insert to authenticated
  with check (true);
