-- Warehouse auto product labels: the SKUs whose product barcode label prints by
-- itself when the SKU is picked (shipstation-webhook poll-orders, Cin7 pick
-- authorised). `payload` is the label exactly as the Barcode Labels tool builds
-- it (BarcodeLabelInput: title, subtitle, sku, barcode, notes, logo), so the
-- edge function copies it into label_print_jobs without calling Cin7 again.
-- Managed at /warehouse/auto-labels.
create table if not exists public.product_label_skus (
  sku text primary key check (sku = upper(btrim(sku)) and sku <> ''),
  payload jsonb not null,
  copies_per_unit integer not null default 1 check (copies_per_unit between 1 and 10),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid
);
alter table public.product_label_skus enable row level security;
drop policy if exists "staff manage product_label_skus" on public.product_label_skus;
create policy "staff manage product_label_skus" on public.product_label_skus
  for all using (is_staff(auth.uid())) with check (is_staff(auth.uid()));

-- Fulfilments already handled for guide labels count as handled for product
-- labels too, so adding a SKU never prints for an order picked before today.
insert into public.label_orders_seen (shipstation_order_id, order_number, note)
select 'cin7-product:' || substr(shipstation_order_id, 6), order_number, 'seeded'
from public.label_orders_seen where shipstation_order_id like 'cin7:%'
on conflict (shipstation_order_id) do nothing;
