
-- updated_at trigger function
create or replace function public.update_updated_at_column()
returns trigger as $$
begin new.updated_at = now(); return new;
end;
$$ language plpgsql set search_path = public;

-- Role-check helpers (create if this project doesn't already have them)
create or replace function public.has_role(_user_id uuid, _role text)
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.user_roles where user_id = _user_id and role = _role) $$;

create or replace function public.is_staff(_user_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.user_roles where user_id = _user_id and role in ('admin', 'editor')) $$;

-- carriers
create table public.carriers (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  email      text,
  created_at timestamptz not null default now()
);
alter table public.carriers enable row level security;
create policy "Staff can view carriers"    on public.carriers for select to authenticated using (true);
create policy "Staff can insert carriers"  on public.carriers for insert to authenticated with check (true);
create policy "Staff can update carriers"  on public.carriers for update to authenticated using (true);
create policy "Admins can delete carriers" on public.carriers for delete to authenticated using (true);

-- rate_cards
create table public.rate_cards (
  id             uuid primary key default gen_random_uuid(),
  carrier_id     uuid references public.carriers(id) not null,
  service        text not null,
  lane           text not null,
  rate           text not null,
  effective_from date,
  effective_to   date,
  created_at     timestamptz not null default now()
);
alter table public.rate_cards enable row level security;
create policy "Staff can view rate_cards"    on public.rate_cards for select to authenticated using (true);
create policy "Staff can insert rate_cards"  on public.rate_cards for insert to authenticated with check (true);
create policy "Staff can update rate_cards"  on public.rate_cards for update to authenticated using (true);
create policy "Admins can delete rate_cards" on public.rate_cards for delete to authenticated using (true);

-- freight_invoices
create table public.freight_invoices (
  id           uuid primary key default gen_random_uuid(),
  invoice_ref  text not null unique,
  carrier_id   uuid references public.carriers(id) not null,
  invoice_date date not null,
  due_date     date,
  status       text not null default 'pending'
                 check (status in ('pending','flagged','disputed','approved','resolved')),
  notes        text,
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
alter table public.freight_invoices enable row level security;
create policy "Staff can view freight_invoices"    on public.freight_invoices for select to authenticated using (true);
create policy "Staff can insert freight_invoices"  on public.freight_invoices for insert to authenticated with check (true);
create policy "Staff can update freight_invoices"  on public.freight_invoices for update to authenticated using (true);
create policy "Admins can delete freight_invoices" on public.freight_invoices for delete to authenticated using (true);

-- freight_invoice_lines
create table public.freight_invoice_lines (
  id               uuid primary key default gen_random_uuid(),
  invoice_id       uuid references public.freight_invoices(id) on delete cascade not null,
  description      text not null,
  detail           text,
  charged_total    numeric(10,2) not null,
  contracted_total numeric(10,2),
  sort_order       int default 0,
  created_at       timestamptz not null default now()
);
alter table public.freight_invoice_lines enable row level security;
create policy "Staff can view freight_invoice_lines"    on public.freight_invoice_lines for select to authenticated using (true);
create policy "Staff can insert freight_invoice_lines"  on public.freight_invoice_lines for insert to authenticated with check (true);
create policy "Staff can update freight_invoice_lines"  on public.freight_invoice_lines for update to authenticated using (true);
create policy "Admins can delete freight_invoice_lines" on public.freight_invoice_lines for delete to authenticated using (true);

-- indexes
create index on public.freight_invoices(status);
create index on public.freight_invoices(carrier_id);
create index on public.freight_invoices(invoice_date desc);
create index on public.freight_invoice_lines(invoice_id);
create index on public.rate_cards(carrier_id);

-- updated_at trigger
create trigger update_freight_invoices_updated_at
  before update on public.freight_invoices
  for each row execute function public.update_updated_at_column();
