-- Logistics rebuild v2 — structured rate cards, matching engine fields, disputes entity
-- Prior tables held zero rows in production (verified 2026-07-02); safe to drop.

-- ── Drop v1 objects ───────────────────────────────────────────────────────────
drop table if exists public.dispute_emails;
drop table if exists public.freight_invoice_lines;
drop table if exists public.freight_invoices;
drop table if exists public.rate_cards;

-- ── Carriers: keep table + rows, extend ──────────────────────────────────────
alter table public.carriers add column if not exists account_number text;
alter table public.carriers add column if not exists fuel_levy_pct numeric(5,2); -- current levy %, applied by match engine

-- ── Rate cards: versioned header + structured entries ────────────────────────
create table public.rate_cards (
  id              uuid primary key default gen_random_uuid(),
  carrier_id      uuid references public.carriers(id) not null,
  name            text not null,                       -- e.g. "Toll FY26 National"
  status          text not null default 'draft'
                    check (status in ('draft','active','superseded')),
  effective_from  date,
  effective_to    date,
  source_filename text,
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table public.rate_card_entries (
  id           uuid primary key default gen_random_uuid(),
  rate_card_id uuid references public.rate_cards(id) on delete cascade not null,
  service      text not null,                          -- e.g. "Road Express"
  origin       text,                                   -- null = any origin
  destination  text,                                   -- null = any destination
  rate_type    text not null
                 check (rate_type in ('per_kg','per_item','flat','percent')),
  rate         numeric(12,4) not null,                 -- $/kg, $/item, $ flat, or % value
  base_charge  numeric(10,2) not null default 0,       -- fixed component added to per_kg/per_item
  min_charge   numeric(10,2),                          -- floor applied after calc
  notes        text,
  created_at   timestamptz not null default now()
);

-- ── Freight invoices ──────────────────────────────────────────────────────────
create table public.freight_invoices (
  id           uuid primary key default gen_random_uuid(),
  invoice_ref  text not null unique,
  carrier_id   uuid references public.carriers(id) not null,
  invoice_date date not null,
  due_date     date,
  status       text not null default 'pending'
                 check (status in ('pending','matched','flagged','disputed','approved','resolved')),
  notes        text,
  matched_at   timestamptz,                            -- last run of match engine
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table public.freight_invoice_lines (
  id               uuid primary key default gen_random_uuid(),
  invoice_id       uuid references public.freight_invoices(id) on delete cascade not null,
  description      text not null,
  detail           text,
  service          text,                               -- structured fields for matching
  origin           text,
  destination      text,
  weight_kg        numeric(10,2),
  qty              int,
  charged_total    numeric(10,2) not null,
  expected_total   numeric(10,2),                      -- written by match engine
  matched_entry_id uuid references public.rate_card_entries(id) on delete set null,
  match_status     text check (match_status in ('matched','no_rate','skipped')),
  sort_order       int not null default 0,
  created_at       timestamptz not null default now()
);

-- ── Disputes: first-class entity with recovery tracking ──────────────────────
create table public.disputes (
  id               uuid primary key default gen_random_uuid(),
  invoice_id       uuid references public.freight_invoices(id) on delete cascade not null,
  status           text not null default 'draft'
                     check (status in ('draft','sent','acknowledged','credited','rejected','written_off')),
  amount_claimed   numeric(10,2) not null default 0,
  amount_recovered numeric(10,2) not null default 0,
  letter_text      text,
  sent_to          text,
  sent_at          timestamptz,
  resolved_at      timestamptz,
  created_by       uuid references auth.users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table public.dispute_events (
  id         uuid primary key default gen_random_uuid(),
  dispute_id uuid references public.disputes(id) on delete cascade not null,
  event_type text not null
               check (event_type in ('created','letter_generated','email_sent','reply_received','credit_logged','status_changed','note')),
  detail     text,
  amount     numeric(10,2),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- ── RLS (staff portal: all authenticated users) ───────────────────────────────
alter table public.rate_cards            enable row level security;
alter table public.rate_card_entries     enable row level security;
alter table public.freight_invoices      enable row level security;
alter table public.freight_invoice_lines enable row level security;
alter table public.disputes              enable row level security;
alter table public.dispute_events        enable row level security;

create policy "Auth select rate_cards"  on public.rate_cards for select to authenticated using (true);
create policy "Auth insert rate_cards"  on public.rate_cards for insert to authenticated with check (true);
create policy "Auth update rate_cards"  on public.rate_cards for update to authenticated using (true);
create policy "Auth delete rate_cards"  on public.rate_cards for delete to authenticated using (true);

create policy "Auth select rate_card_entries" on public.rate_card_entries for select to authenticated using (true);
create policy "Auth insert rate_card_entries" on public.rate_card_entries for insert to authenticated with check (true);
create policy "Auth update rate_card_entries" on public.rate_card_entries for update to authenticated using (true);
create policy "Auth delete rate_card_entries" on public.rate_card_entries for delete to authenticated using (true);

create policy "Auth select freight_invoices" on public.freight_invoices for select to authenticated using (true);
create policy "Auth insert freight_invoices" on public.freight_invoices for insert to authenticated with check (true);
create policy "Auth update freight_invoices" on public.freight_invoices for update to authenticated using (true);
create policy "Auth delete freight_invoices" on public.freight_invoices for delete to authenticated using (true);

create policy "Auth select freight_invoice_lines" on public.freight_invoice_lines for select to authenticated using (true);
create policy "Auth insert freight_invoice_lines" on public.freight_invoice_lines for insert to authenticated with check (true);
create policy "Auth update freight_invoice_lines" on public.freight_invoice_lines for update to authenticated using (true);
create policy "Auth delete freight_invoice_lines" on public.freight_invoice_lines for delete to authenticated using (true);

create policy "Auth select disputes" on public.disputes for select to authenticated using (true);
create policy "Auth insert disputes" on public.disputes for insert to authenticated with check (true);
create policy "Auth update disputes" on public.disputes for update to authenticated using (true);
create policy "Auth delete disputes" on public.disputes for delete to authenticated using (true);

create policy "Auth select dispute_events" on public.dispute_events for select to authenticated using (true);
create policy "Auth insert dispute_events" on public.dispute_events for insert to authenticated with check (true);

-- ── Indexes ───────────────────────────────────────────────────────────────────
create index on public.rate_cards(carrier_id, status);
create index on public.rate_card_entries(rate_card_id);
create index on public.rate_card_entries(service);
create index on public.freight_invoices(status);
create index on public.freight_invoices(carrier_id);
create index on public.freight_invoices(invoice_date desc);
create index on public.freight_invoice_lines(invoice_id);
create index on public.disputes(invoice_id);
create index on public.disputes(status);
create index on public.dispute_events(dispute_id);

-- ── updated_at triggers ───────────────────────────────────────────────────────
create trigger update_rate_cards_updated_at
  before update on public.rate_cards
  for each row execute function public.update_updated_at_column();
create trigger update_freight_invoices_updated_at
  before update on public.freight_invoices
  for each row execute function public.update_updated_at_column();
create trigger update_disputes_updated_at
  before update on public.disputes
  for each row execute function public.update_updated_at_column();

-- ── Atomic invoice import RPC (header + lines in one transaction) ────────────
create or replace function public.import_freight_invoice(
  _invoice_ref  text,
  _carrier_id   uuid,
  _invoice_date date,
  _due_date     date,
  _lines        jsonb
) returns uuid
language plpgsql security invoker set search_path = public
as $$
declare
  _id uuid;
begin
  insert into freight_invoices (invoice_ref, carrier_id, invoice_date, due_date, created_by)
  values (_invoice_ref, _carrier_id, _invoice_date, _due_date, auth.uid())
  returning id into _id;

  insert into freight_invoice_lines
    (invoice_id, description, detail, service, origin, destination, weight_kg, qty, charged_total, sort_order)
  select
    _id,
    l->>'description',
    nullif(l->>'detail',''),
    nullif(l->>'service',''),
    nullif(l->>'origin',''),
    nullif(l->>'destination',''),
    nullif(l->>'weight_kg','')::numeric,
    nullif(l->>'qty','')::int,
    (l->>'charged_total')::numeric,
    coalesce((l->>'sort_order')::int, ord::int - 1)
  from jsonb_array_elements(_lines) with ordinality as t(l, ord);

  return _id;
end;
$$;

-- ── Atomic rate card import RPC (header + entries, supersede previous active) ─
create or replace function public.import_rate_card(
  _carrier_id     uuid,
  _name           text,
  _effective_from date,
  _source_filename text,
  _entries        jsonb
) returns uuid
language plpgsql security invoker set search_path = public
as $$
declare
  _id uuid;
begin
  insert into rate_cards (carrier_id, name, status, effective_from, source_filename, created_by)
  values (_carrier_id, _name, 'active', coalesce(_effective_from, current_date), _source_filename, auth.uid())
  returning id into _id;

  insert into rate_card_entries
    (rate_card_id, service, origin, destination, rate_type, rate, base_charge, min_charge, notes)
  select
    _id,
    e->>'service',
    nullif(e->>'origin',''),
    nullif(e->>'destination',''),
    e->>'rate_type',
    (e->>'rate')::numeric,
    coalesce(nullif(e->>'base_charge','')::numeric, 0),
    nullif(e->>'min_charge','')::numeric,
    nullif(e->>'notes','')
  from jsonb_array_elements(_entries) as e;

  -- supersede previous active cards for this carrier
  update rate_cards
     set status = 'superseded',
         effective_to = coalesce(effective_to, current_date)
   where carrier_id = _carrier_id
     and status = 'active'
     and id <> _id;

  return _id;
end;
$$;
