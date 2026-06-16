-- Saved "to" addresses for the Manual Shipping Label tool (Logistics app).
-- Staff can save frequently-used destination addresses to reuse when
-- generating AGA / TrailBait labels.

create table public.shipping_addresses (
  id         uuid primary key default gen_random_uuid(),
  label      text,                       -- optional nickname, e.g. "Main warehouse"
  name       text not null,              -- recipient / attention
  company    text,
  line1      text not null,
  line2      text,
  suburb     text not null,
  state      text not null,
  postcode   text not null,
  country    text not null default 'Australia',
  phone      text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.shipping_addresses enable row level security;
create policy "Staff can view shipping_addresses"   on public.shipping_addresses for select to authenticated using (true);
create policy "Staff can insert shipping_addresses" on public.shipping_addresses for insert to authenticated with check (true);
create policy "Staff can update shipping_addresses" on public.shipping_addresses for update to authenticated using (true);
create policy "Staff can delete shipping_addresses" on public.shipping_addresses for delete to authenticated using (true);

create index on public.shipping_addresses(created_at desc);

create trigger update_shipping_addresses_updated_at
  before update on public.shipping_addresses
  for each row execute function public.update_updated_at_column();
