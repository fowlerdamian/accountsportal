-- Freight disputes audit fixes (2026-11-23)

-- 1. Control totals: what the invoice itself states, so extracted lines can be
--    reconciled. Older imports took the pre-fuel "Freight" column and silently
--    understated every charge by the fuel surcharge.
alter table public.freight_invoices
  add column if not exists stated_net numeric(12,2),   -- invoice total excl. GST as printed
  add column if not exists stated_gst numeric(12,2);   -- invoice GST as printed

-- 2. Duplicate billing: the same con note's freight billed on another invoice.
alter table public.freight_invoice_lines
  add column if not exists duplicate_invoice_ref text;

-- 3. One open dispute per invoice (the UI used to create a second draft when
--    "Raise Dispute" was clicked on an invoice whose dispute was already sent).
create unique index if not exists disputes_one_open_per_invoice
  on public.disputes(invoice_id)
  where status in ('draft', 'sent', 'acknowledged');

-- 4. amount_recovered is always the sum of the logged credits — maintained by
--    the database instead of client-side read-modify-write.
create or replace function public.sync_dispute_recovered() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  _dispute uuid := coalesce(new.dispute_id, old.dispute_id);
begin
  update disputes
     set amount_recovered = coalesce((select sum(amount) from dispute_credits where dispute_id = _dispute), 0)
   where id = _dispute;
  return null;
end;
$$;

drop trigger if exists dispute_credits_sync_recovered on public.dispute_credits;
create trigger dispute_credits_sync_recovered
  after insert or update or delete on public.dispute_credits
  for each row execute function public.sync_dispute_recovered();

-- 5. Atomic line (re-)extraction: replace an invoice's lines in one
--    transaction, carrying over "query lodged" stamps per con note so a
--    re-extracted invoice keeps its dispute history.
create or replace function public.replace_freight_invoice_lines(
  _invoice_id uuid,
  _lines      jsonb,
  _stated_net numeric default null,
  _stated_gst numeric default null
) returns int
language plpgsql security invoker set search_path = public
as $$
declare
  _n int;
begin
  if _lines is null or jsonb_array_length(_lines) = 0 then
    raise exception 'No line items supplied — existing lines left untouched';
  end if;

  with old as (
    delete from freight_invoice_lines where invoice_id = _invoice_id
    returning tracking_ref, service, description, query_submitted_at
  ),
  lodged as (
    select lower(tracking_ref) as r,
           (coalesce(service, '') || ' ' || description) ~* 'manual|mhp' as mhp,
           max(query_submitted_at) as ts
      from old
     where query_submitted_at is not null and tracking_ref is not null
     group by 1, 2
  )
  insert into freight_invoice_lines
    (invoice_id, description, detail, service, origin, destination, weight_kg, qty,
     charged_total, tracking_ref, sort_order, query_submitted_at)
  select
    _invoice_id,
    l->>'description',
    nullif(l->>'detail',''),
    nullif(l->>'service',''),
    nullif(l->>'origin',''),
    nullif(l->>'destination',''),
    nullif(l->>'weight_kg','')::numeric,
    nullif(l->>'qty','')::numeric::int,
    (l->>'charged_total')::numeric,
    nullif(l->>'tracking',''),
    ord::int - 1,
    (select g.ts from lodged g
      where g.r = lower(nullif(l->>'tracking',''))
        and g.mhp = ((coalesce(l->>'service','') || ' ' || (l->>'description')) ~* 'manual|mhp'))
  from jsonb_array_elements(_lines) with ordinality as t(l, ord);

  get diagnostics _n = row_count;

  update freight_invoices
     set stated_net = coalesce(_stated_net, stated_net),
         stated_gst = coalesce(_stated_gst, stated_gst)
   where id = _invoice_id;

  return _n;
end;
$$;
