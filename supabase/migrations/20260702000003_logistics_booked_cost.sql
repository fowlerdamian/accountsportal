-- ShipStation booked cost becomes the PRIMARY expected-cost baseline.
-- The cost quoted at booking is based on the weight/dims we entered, so it
-- catches both wrong rates and re-rated weights in one comparison. Rate cards
-- remain as fallback for lines not booked through ShipStation.
alter table public.freight_invoice_lines
  add column if not exists booked_cost numeric(10,2),
  add column if not exists expected_source text check (expected_source in ('shipstation','rate_card'));
