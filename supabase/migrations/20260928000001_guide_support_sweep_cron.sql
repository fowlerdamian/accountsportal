-- guide-support sweep: the viewer now pings Google Chat only after the
-- customer finishes the contact step (so the message carries their details).
-- If they close the tab first the question would never be reported, so every
-- 5 minutes guide-support { action: "sweep" } notifies any question 3 min to
-- 2 days old with notified_at still null.
-- Re-uses the service-role Authorization header embedded in guide-delivery-poll.
do $$
declare
  hdr text;
begin
  select substring(command from 'headers := ''(.*?)''::jsonb') into hdr
    from cron.job where jobname = 'guide-delivery-poll' limit 1;
  if hdr is null then
    raise notice 'guide-delivery-poll job not found — guide-support-sweep cron NOT created';
    return;
  end if;
  perform cron.unschedule(jobid) from cron.job where jobname = 'guide-support-sweep';
  perform cron.schedule(
    'guide-support-sweep',
    '*/5 * * * *',
    format('SELECT net.http_post(url := %L, headers := %L::jsonb, body := %L::jsonb)',
           'https://nvlezbqolzwixquusbfo.supabase.co/functions/v1/guide-support',
           hdr, '{"action":"sweep"}')
  );
end $$;
