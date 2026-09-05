-- Google Chat notifications only during business hours (Mon–Fri 8am–5pm,
-- Australia/Brisbane). Every sender in the portal now routes through the
-- notify-google-chat edge fn; outside business hours the fn parks the message
-- here and a 5-minute cron flushes anything due, so the team gets the backlog
-- at 8am instead of pings all evening / weekend.

create table if not exists public.chat_outbox (
  id          uuid primary key default gen_random_uuid(),
  webhook_url text not null,
  text        text not null,
  source      text,
  created_at  timestamptz not null default now(),
  send_after  timestamptz not null,
  sent_at     timestamptz,
  attempts    int not null default 0,
  last_error  text
);
create index if not exists chat_outbox_due_idx on public.chat_outbox (send_after) where sent_at is null;
alter table public.chat_outbox enable row level security;
-- No policies: only the service role (edge fn / cron) touches this table.

-- Business-hours helpers shared with the edge fn logic.
create or replace function public.is_chat_business_hours(p_at timestamptz default now())
returns boolean language sql immutable as $$
  select extract(isodow from (p_at at time zone 'Australia/Brisbane')) between 1 and 5
     and extract(hour   from (p_at at time zone 'Australia/Brisbane')) between 8 and 16
$$;

create or replace function public.next_chat_send_time(p_at timestamptz default now())
returns timestamptz language plpgsql immutable as $$
declare
  local_ts timestamp := p_at at time zone 'Australia/Brisbane';
  d        date      := local_ts::date;
begin
  if public.is_chat_business_hours(p_at) then return p_at; end if;
  -- Before 8am on a weekday → 8am today; otherwise 8am on the next weekday.
  if extract(isodow from d) between 1 and 5 and local_ts < d + time '08:00' then
    return (d + time '08:00') at time zone 'Australia/Brisbane';
  end if;
  loop
    d := d + 1;
    exit when extract(isodow from d) between 1 and 5;
  end loop;
  return (d + time '08:00') at time zone 'Australia/Brisbane';
end $$;

-- Flush cron: every 5 minutes ask notify-google-chat to send anything due.
-- Re-uses the Authorization header already embedded in the guide-delivery poll job.
do $$
declare
  hdr text;
begin
  select substring(command from 'headers := ''(.*?)''::jsonb') into hdr
    from cron.job where jobname = 'guide-delivery-poll' limit 1;
  if hdr is null then
    raise notice 'guide-delivery-poll job not found — chat-outbox-flush cron NOT created';
    return;
  end if;
  perform cron.unschedule(jobid) from cron.job where jobname = 'chat-outbox-flush';
  perform cron.schedule(
    'chat-outbox-flush',
    '*/5 * * * *',
    format('SELECT net.http_post(url := %L, headers := %L::jsonb, body := %L::jsonb)',
           'https://nvlezbqolzwixquusbfo.supabase.co/functions/v1/notify-google-chat',
           hdr, '{"action":"flush"}')
  );
end $$;
