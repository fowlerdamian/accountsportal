-- ─────────────────────────────────────────────────────────────────────────────
-- Daily Focus Digest cron (pg_cron + pg_net)
-- Posts each staff member's personalised "Today's Focus" to their Google Chat
-- webhook twice a day: 8am and 3pm AEST (Australia/Brisbane, UTC+10, no DST).
--   8am AEST = 22:00 UTC  ·  3pm AEST = 05:00 UTC
-- ─────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
DECLARE
  base_url text := 'https://nvlezbqolzwixquusbfo.supabase.co/functions/v1';
  svc_key  text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im52bGV6YnFvbHp3aXhxdXVzYmZvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDk4MDEzMywiZXhwIjoyMDkwNTU2MTMzfQ.UtLSrpPuLWJsvlsusvB_AnhNG9d6BxoPdwzzlkLLR7o';
  headers  jsonb := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || svc_key);
BEGIN
  -- Replace existing jobs of the same name (idempotent re-run).
  BEGIN PERFORM cron.unschedule('daily-focus-morning');   EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN PERFORM cron.unschedule('daily-focus-afternoon'); EXCEPTION WHEN OTHERS THEN NULL; END;

  -- Morning kickoff — 8am AEST
  PERFORM cron.schedule(
    'daily-focus-morning',
    '0 22 * * *',
    format($$SELECT net.http_post(url := %L, headers := %L::jsonb, body := '{}'::jsonb)$$,
           base_url || '/daily-focus-digest', headers)
  );

  -- Afternoon check-in — 3pm AEST
  PERFORM cron.schedule(
    'daily-focus-afternoon',
    '0 5 * * *',
    format($$SELECT net.http_post(url := %L, headers := %L::jsonb, body := '{}'::jsonb)$$,
           base_url || '/daily-focus-digest', headers)
  );
END $$;
