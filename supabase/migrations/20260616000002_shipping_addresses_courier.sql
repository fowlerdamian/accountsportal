-- Courier is a per-address attribute on the Manual Shipping Label tool.
alter table public.shipping_addresses
  add column if not exists courier text;
