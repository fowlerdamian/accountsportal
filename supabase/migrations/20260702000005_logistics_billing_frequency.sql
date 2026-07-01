-- Billing cadence per carrier for missing-invoice detection.
-- Gap analysis anchors at the first 2026 invoice date, 2026-01-03.
alter table public.carriers
  add column if not exists billing_frequency text
    check (billing_frequency in ('weekly','monthly'));

update public.carriers set billing_frequency = 'monthly' where name = 'Australia Post';

insert into public.carriers (name, billing_frequency)
select 'TNT Australia', 'weekly'
where not exists (select 1 from public.carriers where name = 'TNT Australia');
