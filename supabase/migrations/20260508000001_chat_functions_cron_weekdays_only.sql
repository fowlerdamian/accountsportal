-- Realtime alerts cron leaked into Saturday morning AEST because the single
-- DOW field can't express weekday-only intent across the AEST↔UTC midnight
-- boundary. Split into two jobs so together they cover Mon–Fri AEST only.

DO $mig$
DECLARE
  base_url text := 'https://nvlezbqolzwixquusbfo.supabase.co/functions/v1';
  headers  jsonb := jsonb_build_object(
    'Content-Type',  'application/json',
    'Authorization', 'Bearer ' || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im52bGV6YnFvbHp3aXhxdXVzYmZvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDk4MDEzMywiZXhwIjoyMDkwNTU2MTMzfQ.UtLSrpPuLWJsvlsusvB_AnhNG9d6BxoPdwzzlkLLR7o'
  );
  rt_cmd text := format(
    $f$SELECT net.http_post(url := %L, headers := %L::jsonb, body := '{}'::jsonb)$f$,
    base_url || '/cin7-realtime-alerts',
    headers
  );
BEGIN
  PERFORM cron.unschedule('cin7-realtime-alerts');
  -- Evening UTC (21-23) → next-morning AEST (07-09). Sun-Thu UTC = Mon-Fri AEST.
  PERFORM cron.schedule('cin7-realtime-alerts-am', '*/15 21-23 * * 0-4', rt_cmd);
  -- Morning/afternoon UTC (00-08) → same-day AEST (10-18). Mon-Fri UTC = Mon-Fri AEST.
  PERFORM cron.schedule('cin7-realtime-alerts-pm', '*/15 0-8 * * 1-5',   rt_cmd);
END $mig$;
