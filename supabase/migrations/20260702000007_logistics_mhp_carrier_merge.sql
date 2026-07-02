-- 1. TNT and FedEx are the same carrier (FedEx Express Australia trading as
--    TNT Express) — merge into one record.
update public.carriers t
   set name = 'TNT / FedEx',
       email = coalesce(t.email, f.email),
       claims_email = coalesce(t.claims_email, f.claims_email)
  from public.carriers f
 where t.name = 'TNT Australia' and f.name = 'FedEx Australia';

update public.freight_invoices
   set carrier_id = (select id from public.carriers where name = 'TNT / FedEx')
 where carrier_id in (select id from public.carriers where name = 'FedEx Australia');

delete from public.carriers where name = 'FedEx Australia';

-- 2. MHP fee verification: the engine checks each Manual Handling fee against
--    TNT's published sortation-compatibility parameters using the ShipStation
--    dims/weight, and challenges fees on compatible packages.
alter table public.freight_invoice_lines
  add column if not exists fee_check text
    check (fee_check in ('mhp_ok','mhp_unjustified')),
  add column if not exists actual_dims text;  -- "L×W×H mm" from ShipStation, for evidence
