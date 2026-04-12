-- ─────────────────────────────────────────────────────────────────────────────
-- Sales Support Cron Jobs (pg_cron)
-- Requires pg_cron and pg_net extensions enabled in Supabase dashboard.
-- Replace <PROJECT_REF> with your Supabase project reference.
-- Replace <SERVICE_ROLE_KEY> with your project service role key (use Vault in production).
-- ─────────────────────────────────────────────────────────────────────────────

-- Enable required extensions (safe to run multiple times)
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Helper: project edge function base URL
-- Update <PROJECT_REF> before running this migration.
DO $$
DECLARE
  base_url  text := 'https://nvlezbqolzwixquusbfo.supabase.co/functions/v1';
  svc_key   text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im52bGV6YnFvbHp3aXhxdXVzYmZvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDk4MDEzMywiZXhwIjoyMDkwNTU2MTMzfQ.UtLSrpPuLWJsvlsusvB_AnhNG9d6BxoPdwzzlkLLR7o';
  headers   jsonb := jsonb_build_object(
    'Content-Type',  'application/json',
    'Authorization', 'Bearer ' || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im52bGV6YnFvbHp3aXhxdXVzYmZvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDk4MDEzMywiZXhwIjoyMDkwNTU2MTMzfQ.UtLSrpPuLWJsvlsusvB_AnhNG9d6BxoPdwzzlkLLR7o'
  );
BEGIN

  -- ── Nightly lead discovery: 1am AEST = 3pm UTC ──────────────────────────
  PERFORM cron.schedule(
    'sales-discovery',
    '0 15 * * *',
    format(
      $$SELECT net.http_post(url := %L, headers := %L::jsonb, body := '{}'::jsonb)$$,
      base_url || '/sales-lead-discovery',
      headers
    )
  );

  -- ── Nightly enrichment: 2am AEST = 4pm UTC ──────────────────────────────
  PERFORM cron.schedule(
    'sales-enrichment',
    '0 16 * * *',
    format(
      $$SELECT net.http_post(url := %L, headers := %L::jsonb, body := '{}'::jsonb)$$,
      base_url || '/sales-lead-enrichment',
      headers
    )
  );

  -- ── Nightly Cin7 sync: 3am AEST = 5pm UTC ───────────────────────────────
  PERFORM cron.schedule(
    'sales-cin7-sync',
    '0 17 * * *',
    format(
      $$SELECT net.http_post(url := %L, headers := %L::jsonb, body := '{}'::jsonb)$$,
      base_url || '/sales-cin7-sync',
      headers
    )
  );

  -- ── Nightly scoring: 4am AEST = 6pm UTC ─────────────────────────────────
  PERFORM cron.schedule(
    'sales-scoring',
    '0 18 * * *',
    format(
      $$SELECT net.http_post(url := %L, headers := %L::jsonb, body := '{}'::jsonb)$$,
      base_url || '/sales-lead-scoring',
      headers
    )
  );

  -- ── Daily call list: 6am AEST = 8pm UTC ─────────────────────────────────
  PERFORM cron.schedule(
    'sales-calllist',
    '0 20 * * *',
    format(
      $$SELECT net.http_post(url := %L, headers := %L::jsonb, body := '{}'::jsonb)$$,
      base_url || '/sales-calllist-generate',
      headers
    )
  );

  -- ── HubSpot note sync: every hour ────────────────────────────────────────
  PERFORM cron.schedule(
    'sales-hubspot-notes',
    '30 * * * *',
    format(
      $$SELECT net.http_post(url := %L, headers := %L::jsonb, body := '{"action":"sync_notes"}'::jsonb)$$,
      base_url || '/sales-hubspot-sync',
      headers
    )
  );

END $$;
