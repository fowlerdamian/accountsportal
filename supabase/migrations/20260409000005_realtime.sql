-- Enable Supabase Realtime for Contractor Hub tables.
-- This adds the tables to the supabase_realtime publication so that
-- postgres_changes subscriptions in the React layer receive live events.

alter publication supabase_realtime add table public.tasks;
alter publication supabase_realtime add table public.activity_log;
alter publication supabase_realtime add table public.time_entries;
alter publication supabase_realtime add table public.contractors;
