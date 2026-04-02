-- Phase 2: claims_email, dispute_emails table, new carrier seeds

-- 1. Add claims_email to carriers
alter table public.carriers
  add column if not exists claims_email text;

-- 2. dispute_emails logging table
create table if not exists public.dispute_emails (
  id           uuid primary key default gen_random_uuid(),
  invoice_id   uuid references public.freight_invoices(id) not null,
  sent_to      text,
  sent_at      timestamptz not null default now(),
  letter_text  text,
  sent_by      uuid references auth.users(id),
  status       text not null default 'sent'
               check (status in ('sent', 'draft'))
);
create index if not exists dispute_emails_invoice_id_idx on public.dispute_emails(invoice_id);
alter table public.dispute_emails enable row level security;
create policy "Auth can select dispute_emails" on public.dispute_emails for select to authenticated using (true);
create policy "Auth can insert dispute_emails" on public.dispute_emails for insert to authenticated with check (true);

-- 3. New carriers (Feature 3)
insert into public.carriers (name, email, claims_email)
select 'FedEx Australia', 'billing@fedex.com.au', 'claims@fedex.com.au'
where not exists (select 1 from public.carriers where name = 'FedEx Australia');

insert into public.carriers (name, email, claims_email)
select 'Australia Post', 'invoices@auspost.com.au', 'freight.claims@auspost.com.au'
where not exists (select 1 from public.carriers where name = 'Australia Post');

insert into public.carriers (name, email, claims_email)
select 'StarTrack', 'billing@startrack.com.au', 'claims@startrack.com.au'
where not exists (select 1 from public.carriers where name = 'StarTrack');

-- 4. Backfill claims_email on Phase 1 carriers
update public.carriers set claims_email = 'claims@toll.com.au'
  where name = 'Toll Group' and claims_email is null;
update public.carriers set claims_email = 'claims@tnt.com.au'
  where name = 'TNT Australia' and claims_email is null;
update public.carriers set claims_email = 'claims.au@linfox.com'
  where name = 'Linfox' and claims_email is null;
update public.carriers set claims_email = 'claims@startrack.com.au'
  where name = 'StarTrack' and claims_email is null;
