-- Live UI updates: "Processing invoice…" flips to Processed and nav badges
-- refresh without a reload. (v2 tables were recreated and had dropped out of
-- the realtime publication.)
alter publication supabase_realtime add table public.freight_invoices;
alter publication supabase_realtime add table public.disputes;
