-- Warehouse auto product labels: customers whose orders never auto-print.
-- shipstation-webhook compares the Cin7 sale's customer name (case-insensitive)
-- before queueing product labels. Managed at /warehouse/auto-labels.
create table if not exists public.product_label_excluded_customers (
  customer text primary key check (customer = btrim(customer) and customer <> ''),
  created_at timestamptz not null default now(),
  created_by uuid
);
create unique index if not exists product_label_excluded_customers_lower_uq
  on public.product_label_excluded_customers (lower(customer));
alter table public.product_label_excluded_customers enable row level security;
drop policy if exists "staff manage product_label_excluded_customers" on public.product_label_excluded_customers;
create policy "staff manage product_label_excluded_customers" on public.product_label_excluded_customers
  for all using (is_staff(auth.uid())) with check (is_staff(auth.uid()));
