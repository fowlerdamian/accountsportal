-- Weight/cubic verification vs ShipStation.
-- Carriers often mis-key shipment size and bill as a larger shipment; the match
-- engine now cross-checks the billed weight against the physical weight and
-- dimensions entered in ShipStation, using the con-note/tracking number.

alter table public.carriers
  add column if not exists cubic_factor_kg_m3 numeric(8,2) not null default 250; -- road freight kg/m³

alter table public.freight_invoice_lines
  add column if not exists tracking_ref        text,           -- con note / tracking # from the invoice
  add column if not exists actual_weight_kg    numeric(10,2),  -- dead weight from ShipStation
  add column if not exists actual_cubic_m3     numeric(10,4),  -- L×W×H from ShipStation dims
  add column if not exists chargeable_weight_kg numeric(10,2), -- max(dead, cubic × carrier factor)
  add column if not exists weight_check        text
    check (weight_check in ('ok','overbilled','unmatched'));

create index if not exists freight_invoice_lines_tracking_idx
  on public.freight_invoice_lines(tracking_ref);

-- import RPC: carry tracking through (same signature — body update only)
create or replace function public.import_freight_invoice(
  _invoice_ref  text,
  _carrier_id   uuid,
  _invoice_date date,
  _due_date     date,
  _lines        jsonb
) returns uuid
language plpgsql security invoker set search_path = public
as $$
declare
  _id uuid;
begin
  insert into freight_invoices (invoice_ref, carrier_id, invoice_date, due_date, created_by)
  values (_invoice_ref, _carrier_id, _invoice_date, _due_date, auth.uid())
  returning id into _id;

  insert into freight_invoice_lines
    (invoice_id, description, detail, service, origin, destination, weight_kg, qty, charged_total, tracking_ref, sort_order)
  select
    _id,
    l->>'description',
    nullif(l->>'detail',''),
    nullif(l->>'service',''),
    nullif(l->>'origin',''),
    nullif(l->>'destination',''),
    nullif(l->>'weight_kg','')::numeric,
    nullif(l->>'qty','')::int,
    (l->>'charged_total')::numeric,
    nullif(l->>'tracking',''),
    coalesce((l->>'sort_order')::int, ord::int - 1)
  from jsonb_array_elements(_lines) with ordinality as t(l, ord);

  return _id;
end;
$$;
