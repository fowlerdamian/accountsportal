alter table public.purchase_orders
  add column if not exists order_date date;
