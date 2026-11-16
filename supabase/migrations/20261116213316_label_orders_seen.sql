-- Packed-time guide labels: one row per ShipStation order that has been looked at.
-- The insert is the claim that stops the ORDER_NOTIFY webhook and the every-minute
-- poll (shipstation-webhook `poll-orders`) from queueing the same order twice.
create table if not exists public.label_orders_seen (
  shipstation_order_id text primary key,
  order_number text,
  seen_at timestamptz not null default now(),
  labels_queued integer,
  note text
);
alter table public.label_orders_seen enable row level security; -- service role only
