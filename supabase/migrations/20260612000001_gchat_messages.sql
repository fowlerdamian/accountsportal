-- Conversation history for the Google Chat bot (gchat-bot edge function).
-- Only the service role reads/writes this table: RLS is enabled with no
-- policies so portal users can't touch other people's Chat threads.
create table if not exists public.gchat_messages (
  id          uuid primary key default gen_random_uuid(),
  thread_name text not null,
  role        text not null check (role in ('user', 'assistant')),
  content     text not null,
  user_email  text,
  created_at  timestamptz not null default now()
);

create index if not exists gchat_messages_thread_idx
  on public.gchat_messages (thread_name, created_at desc);

alter table public.gchat_messages enable row level security;
