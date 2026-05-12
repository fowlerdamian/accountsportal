-- Replace 24/7 cron with business-hours schedule (matching the original
-- "Cin7 Chat Integration" project that we're retiring).
DO $mig$
DECLARE
  base_url text := 'https://nvlezbqolzwixquusbfo.supabase.co/functions/v1';
  headers  jsonb := jsonb_build_object(
    'Content-Type',  'application/json',
    'Authorization', 'Bearer ' || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im52bGV6YnFvbHp3aXhxdXVzYmZvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDk4MDEzMywiZXhwIjoyMDkwNTU2MTMzfQ.UtLSrpPuLWJsvlsusvB_AnhNG9d6BxoPdwzzlkLLR7o'
  );
BEGIN
  PERFORM cron.unschedule('cin7-daily-digest');
  PERFORM cron.unschedule('cin7-realtime-alerts');

  -- Daily digest: 7:30am AEST Mon-Fri = 21:30 UTC Sun-Thu
  PERFORM cron.schedule(
    'cin7-daily-digest',
    '30 21 * * 0-4',
    format(
      $f$SELECT net.http_post(url := %L, headers := %L::jsonb, body := '{}'::jsonb)$f$,
      base_url || '/cin7-daily-digest',
      headers
    )
  );

  -- Realtime alerts: every 15 min during AEST business hours
  -- (07:00-18:59 AEST = 21:00-23:59 + 00:00-08:59 UTC), Mon-Sat AEST = Sun-Fri UTC.
  PERFORM cron.schedule(
    'cin7-realtime-alerts',
    '*/15 21-23,0-8 * * 0-5',
    format(
      $f$SELECT net.http_post(url := %L, headers := %L::jsonb, body := '{}'::jsonb)$f$,
      base_url || '/cin7-realtime-alerts',
      headers
    )
  );
END $mig$;
