alter table public.purchase_orders
  add column if not exists notes text;
