-- ─────────────────────────────────────────────────────────────────────────────
-- Cron schedules for the chat functions ported from "Cin7 Chat Integration"
-- Each function self-gates on chat_function_settings.enabled, so toggling
-- on/off in the frontend does not require touching cron.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
DECLARE
  base_url text := 'https://nvlezbqolzwixquusbfo.supabase.co/functions/v1';
  headers  jsonb := jsonb_build_object(
    'Content-Type',  'application/json',
    'Authorization', 'Bearer ' || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im52bGV6YnFvbHp3aXhxdXVzYmZvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDk4MDEzMywiZXhwIjoyMDkwNTU2MTMzfQ.UtLSrpPuLWJsvlsusvB_AnhNG9d6BxoPdwzzlkLLR7o'
  );
BEGIN
  -- Daily stock digest: 7:30am AEST = 21:30 UTC the previous day
  PERFORM cron.schedule(
    'cin7-daily-digest',
    '30 21 * * *',
    format(
      $f$SELECT net.http_post(url := %L, headers := %L::jsonb, body := '{}'::jsonb)$f$,
      base_url || '/cin7-daily-digest',
      headers
    )
  );

  -- Realtime alerts: every 15 minutes (function still self-gates on enabled)
  PERFORM cron.schedule(
    'cin7-realtime-alerts',
    '*/15 * * * *',
    format(
      $f$SELECT net.http_post(url := %L, headers := %L::jsonb, body := '{}'::jsonb)$f$,
      base_url || '/cin7-realtime-alerts',
      headers
    )
  );
END $$;
