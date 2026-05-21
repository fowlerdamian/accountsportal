-- ─────────────────────────────────────────────────────────────────────────────
-- profiles ← auth.users sync
-- The Tasks app pulls staff from `profiles` for the assignee picker. Up to
-- now profiles has been populated ad-hoc (Contractor Hub uses a separate
-- `contractors` table), so many staff are missing. This migration:
--
--   1. Adds an `email` column to profiles if it doesn't exist
--   2. Backfills every auth.users row into profiles (idempotent — ON CONFLICT)
--   3. Adds a trigger so new signups + email changes flow into profiles
--
-- The trigger runs as SECURITY DEFINER so it can write into public.profiles
-- with elevated privileges from the auth schema.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Ensure email column exists on profiles
alter table public.profiles
  add column if not exists email text;

-- 2. Trigger function — uses ON CONFLICT so it works for both INSERT and
--    UPDATE on auth.users. Preserves any existing full_name override.
create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, email)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name',
      split_part(new.email, '@', 1)
    ),
    new.email
  )
  on conflict (id) do update set
    email     = excluded.email,
    full_name = coalesce(public.profiles.full_name, excluded.full_name);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert or update of email, raw_user_meta_data on auth.users
  for each row execute function public.handle_new_auth_user();

-- 3. One-shot backfill of existing auth.users
insert into public.profiles (id, full_name, email)
select
  u.id,
  coalesce(
    u.raw_user_meta_data->>'full_name',
    u.raw_user_meta_data->>'name',
    split_part(u.email, '@', 1)
  ),
  u.email
from auth.users u
where u.email is not null
on conflict (id) do update set
  email     = excluded.email,
  full_name = coalesce(public.profiles.full_name, excluded.full_name);
