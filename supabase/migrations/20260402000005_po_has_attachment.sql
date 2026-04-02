alter table public.purchase_orders
  add column if not exists has_attachment boolean not null default false;
