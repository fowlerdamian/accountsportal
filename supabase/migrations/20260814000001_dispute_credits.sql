-- Phase-2 close-out: carriers issue a unique reference number (URN) per
-- approved claim; each credit is recorded against its dispute so recoveries
-- can be totalled before the claim is closed out.

create table public.dispute_credits (
  id         uuid primary key default gen_random_uuid(),
  dispute_id uuid references public.disputes(id) on delete cascade not null,
  urn        text not null,
  amount     numeric(10,2) not null check (amount > 0),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (dispute_id, urn)
);

alter table public.dispute_credits enable row level security;

create policy "Auth select dispute_credits" on public.dispute_credits for select to authenticated using (true);
create policy "Auth insert dispute_credits" on public.dispute_credits for insert to authenticated with check (true);
create policy "Auth delete dispute_credits" on public.dispute_credits for delete to authenticated using (true);

create index on public.dispute_credits(dispute_id);
