create table if not exists public.sales_scoring_weights (
  channel     text not null,
  factor_key  text not null,
  weight      numeric not null default 10 check (weight >= 0 and weight <= 100),
  description text,
  updated_at  timestamptz default now(),
  primary key (channel, factor_key)
);

alter table public.sales_scoring_weights enable row level security;

create policy "Staff can read weights"   on public.sales_scoring_weights for select to authenticated using (true);
create policy "Staff can update weights" on public.sales_scoring_weights for all    to authenticated using (true) with check (true);
create policy "Service role full"        on public.sales_scoring_weights for all    to service_role   using (true) with check (true);
