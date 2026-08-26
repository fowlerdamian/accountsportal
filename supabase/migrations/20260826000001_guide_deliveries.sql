-- Guide auto-delivery: email installation guides to Shopify customers on purchase.
--
--   guide_delivery_settings  single-row config (enabled, sender, brand, template)
--   guide_product_links      explicit Shopify SKU -> guide mapping (overrides auto-match)
--   guide_deliveries         one row per Shopify order processed (idempotency + audit log)

create table if not exists public.guide_delivery_settings (
  id              int primary key default 1 check (id = 1),
  enabled         boolean not null default false,
  brand_id        uuid references public.brands(id),
  from_email      text not null default 'Trailbait Guides <guides@automotivegroup.com.au>',
  reply_to        text,
  bcc_email       text,
  subject         text not null default 'Your installation guide{{s}} for order {{order}}',
  intro_text      text not null default 'Thanks for your order! Here are the step-by-step installation guides for the products you purchased. Each guide opens on your phone or computer — no download needed.',
  auto_match      boolean not null default true,
  poll_lookback_hours int not null default 48,
  updated_at      timestamptz not null default now()
);

insert into public.guide_delivery_settings (id, brand_id)
select 1, id from public.brands where key = 'trailbait'
on conflict (id) do nothing;

create table if not exists public.guide_product_links (
  id                  uuid primary key default gen_random_uuid(),
  sku                 text not null,
  instruction_set_id  uuid references public.instruction_sets(id) on delete cascade,
  -- instruction_set_id NULL = "never send a guide for this SKU" (explicit suppression)
  note                text,
  created_at          timestamptz not null default now(),
  created_by          uuid references auth.users(id)
);
create unique index if not exists guide_product_links_sku_idx on public.guide_product_links (upper(sku));

create table if not exists public.guide_deliveries (
  id                uuid primary key default gen_random_uuid(),
  shopify_order_id  bigint not null unique,
  order_name        text,
  order_created_at  timestamptz,
  customer_name     text,
  customer_email    text,
  source            text not null default 'webhook',      -- webhook | poll | manual
  status            text not null default 'pending',      -- pending | sent | skipped | failed
  line_items        jsonb not null default '[]'::jsonb,   -- [{sku,title,quantity,variant_title}]
  matched_guides    jsonb not null default '[]'::jsonb,   -- [{sku,instruction_set_id,title,url,match}]
  unmatched_skus    text[] not null default '{}',
  error             text,
  resend_id         text,
  attempts          int not null default 0,
  sent_at           timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists guide_deliveries_status_idx on public.guide_deliveries (status, created_at desc);
create index if not exists guide_deliveries_email_idx on public.guide_deliveries (lower(customer_email));

alter table public.guide_delivery_settings enable row level security;
alter table public.guide_product_links     enable row level security;
alter table public.guide_deliveries        enable row level security;

drop policy if exists "staff full guide_delivery_settings" on public.guide_delivery_settings;
create policy "staff full guide_delivery_settings" on public.guide_delivery_settings
  for all to authenticated using (true) with check (true);
drop policy if exists "staff full guide_product_links" on public.guide_product_links;
create policy "staff full guide_product_links" on public.guide_product_links
  for all to authenticated using (true) with check (true);
drop policy if exists "staff full guide_deliveries" on public.guide_deliveries;
create policy "staff full guide_deliveries" on public.guide_deliveries
  for all to authenticated using (true) with check (true);

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists guide_deliveries_touch on public.guide_deliveries;
create trigger guide_deliveries_touch before update on public.guide_deliveries
  for each row execute function public.touch_updated_at();
