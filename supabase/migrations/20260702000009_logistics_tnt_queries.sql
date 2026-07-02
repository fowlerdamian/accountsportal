-- TNT disputes are lodged via TNT's invoice-query web form, ONE SUBMISSION PER
-- QUERY (per disputed con-note line), not per invoice.
alter table public.freight_invoice_lines add column if not exists query_submitted_at timestamptz;

alter table public.dispute_events drop constraint if exists dispute_events_event_type_check;
alter table public.dispute_events add constraint dispute_events_event_type_check
  check (event_type in ('created','letter_generated','email_sent','query_submitted','reply_received','credit_logged','status_changed','note'));

update public.carriers set account_number = '30031126' where name = 'TNT / FedEx' and account_number is null;
