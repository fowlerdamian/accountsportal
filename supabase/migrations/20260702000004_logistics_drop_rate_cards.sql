-- Remove rate cards entirely. ShipStation booked cost is the sole freight
-- baseline; fuel levy lines are priced from carriers.fuel_levy_pct.
-- (rate_cards / rate_card_entries held zero rows.)

drop function if exists public.import_rate_card(uuid, text, date, text, jsonb);

alter table public.freight_invoice_lines drop column if exists matched_entry_id;

drop table if exists public.rate_card_entries;
drop table if exists public.rate_cards;

-- expected_source: 'shipstation' (booked cost) or 'carrier_levy' (fuel levy %)
alter table public.freight_invoice_lines drop constraint if exists freight_invoice_lines_expected_source_check;
alter table public.freight_invoice_lines
  add constraint freight_invoice_lines_expected_source_check
  check (expected_source in ('shipstation','carrier_levy'));
