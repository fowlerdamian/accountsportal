
-- Purchase Orders (synced from Cin7 Core)
create type public.po_status as enum ('Draft', 'Authorised', 'Ordered', 'Receiving', 'Received', 'Cancelled');

create table public.purchase_orders (
  id            uuid        primary key default gen_random_uuid(),
  cin7_id       text        unique not null,
  po_number     text        not null,
  supplier_name text        not null,
  status        po_status   not null default 'Draft',
  due_date      date,
  total_amount  numeric(12,2),
  currency      text        not null default 'AUD',
  line_items    jsonb       not null default '[]',
  synced_at     timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.purchase_orders enable row level security;

create policy "Staff can view purchase orders"
  on public.purchase_orders for select to authenticated
  using (true);

create policy "Service role can manage purchase orders"
  on public.purchase_orders for all to service_role
  using (true) with check (true);

create trigger update_purchase_orders_updated_at
  before update on public.purchase_orders
  for each row execute function public.update_updated_at_column();

create index idx_purchase_orders_due_date on public.purchase_orders(due_date);
create index idx_purchase_orders_status   on public.purchase_orders(status);
