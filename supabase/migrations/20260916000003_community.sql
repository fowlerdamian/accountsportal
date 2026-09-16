-- Community app: one profile per customer, built from Dialpad calls, the shared
-- inbox and Shopify orders. Shapes mirror Atomic CRM (email_jsonb, phone_jsonb,
-- tags, notes, tasks). Synced calls / emails / orders land in community_notes
-- (kind ≠ 'note') so the profile page shows one timeline.

create table if not exists public.community_contacts (
  id                uuid primary key default gen_random_uuid(),
  first_name        text,
  last_name         text,
  title             text,
  company_name      text,
  email_jsonb       jsonb not null default '[]'::jsonb,   -- [{ "email", "type": Work|Home|Other }]
  phone_jsonb       jsonb not null default '[]'::jsonb,   -- [{ "number", "type" }]
  linkedin_url      text,
  gender            text,
  has_newsletter    boolean not null default false,
  background        text,
  status            text not null default 'cold',          -- cold | warm | hot | in-contract
  tags              text[] not null default '{}',
  avatar_url        text,
  address           jsonb,
  sales_id          uuid,                                   -- assigned staff (auth.users.id)
  first_seen        timestamptz not null default now(),
  last_seen         timestamptz not null default now(),
  shopify_customer_id text,
  nb_orders         integer not null default 0,
  total_spent       numeric(12,2) not null default 0,
  last_order_at     timestamptz,
  nb_calls          integer not null default 0,
  last_call_at      timestamptz,
  avg_csat          numeric(3,2),
  nb_emails         integer not null default 0,
  last_email_at     timestamptz,
  nb_tasks          integer not null default 0,
  ai_summary        text,
  ai_summary_at     timestamptz,
  search_text       text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists idx_community_contacts_last_seen on public.community_contacts (last_seen desc);
create index if not exists idx_community_contacts_shopify on public.community_contacts (shopify_customer_id) where shopify_customer_id is not null;

-- Identity index: every email / phone / Shopify customer id belongs to exactly one contact.
create table if not exists public.community_identities (
  id          bigserial primary key,
  contact_id  uuid not null references public.community_contacts(id) on delete cascade,
  kind        text not null check (kind in ('email','phone','shopify_customer','dialpad_contact')),
  value       text not null,                                -- normalised (lower-case email, E.164 phone)
  source      text,
  created_at  timestamptz not null default now(),
  unique (kind, value)
);
create index if not exists idx_community_identities_contact on public.community_identities (contact_id);

create table if not exists public.community_notes (
  id          uuid primary key default gen_random_uuid(),
  contact_id  uuid not null references public.community_contacts(id) on delete cascade,
  kind        text not null default 'note' check (kind in ('note','call','email','order')),
  text        text not null default '',
  date        timestamptz not null default now(),
  sales_id    uuid,
  status      text not null default 'note',
  source_ref  text,                                         -- dialpad call_id / gmail message id / shopify order id
  meta        jsonb not null default '{}'::jsonb,
  attachments jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now()
);
create unique index if not exists idx_community_notes_source on public.community_notes (kind, source_ref);
create index if not exists idx_community_notes_contact on public.community_notes (contact_id, date desc);

create table if not exists public.community_tasks (
  id          uuid primary key default gen_random_uuid(),
  contact_id  uuid not null references public.community_contacts(id) on delete cascade,
  type        text not null default 'None',
  text        text not null,
  due_date    date,
  done_date   timestamptz,
  sales_id    uuid,
  created_at  timestamptz not null default now()
);
create index if not exists idx_community_tasks_contact on public.community_tasks (contact_id, due_date);

create table if not exists public.community_sync_state (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Keep updated_at and the search column fresh.
create or replace function public.community_contacts_touch() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  new.search_text := lower(concat_ws(' ',
    new.first_name, new.last_name, new.company_name, new.title,
    (select string_agg(e->>'email', ' ') from jsonb_array_elements(coalesce(new.email_jsonb, '[]'::jsonb)) e),
    (select string_agg(p->>'number', ' ') from jsonb_array_elements(coalesce(new.phone_jsonb, '[]'::jsonb)) p),
    array_to_string(new.tags, ' ')
  ));
  return new;
end $$;
drop trigger if exists trg_community_contacts_touch on public.community_contacts;
create trigger trg_community_contacts_touch before insert or update on public.community_contacts
  for each row execute function public.community_contacts_touch();

-- Recompute the cached counters on a contact from its notes and tasks.
create or replace function public.community_recompute_stats(p_contact uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.community_contacts c set
    nb_orders     = (select count(*) from community_notes n where n.contact_id = p_contact and n.kind = 'order'),
    total_spent   = coalesce((select sum((n.meta->>'total')::numeric) from community_notes n where n.contact_id = p_contact and n.kind = 'order' and n.meta ? 'total'), 0),
    last_order_at = (select max(n.date) from community_notes n where n.contact_id = p_contact and n.kind = 'order'),
    nb_calls      = (select count(*) from community_notes n where n.contact_id = p_contact and n.kind = 'call'),
    last_call_at  = (select max(n.date) from community_notes n where n.contact_id = p_contact and n.kind = 'call'),
    avg_csat      = (select round(avg((n.meta->>'csat')::numeric), 2) from community_notes n where n.contact_id = p_contact and n.kind = 'call' and n.meta ? 'csat'),
    nb_emails     = (select count(*) from community_notes n where n.contact_id = p_contact and n.kind = 'email'),
    last_email_at = (select max(n.date) from community_notes n where n.contact_id = p_contact and n.kind = 'email'),
    nb_tasks      = (select count(*) from community_tasks t where t.contact_id = p_contact and t.done_date is null),
    first_seen    = least(c.first_seen, coalesce((select min(n.date) from community_notes n where n.contact_id = p_contact), c.first_seen)),
    last_seen     = greatest(c.last_seen, coalesce((select max(n.date) from community_notes n where n.contact_id = p_contact), c.last_seen))
  where c.id = p_contact;
end $$;

-- Merge p_drop into p_keep: identities, notes and tasks move across, scalar
-- fields fill gaps, arrays union. p_drop is deleted. Returns p_keep.
create or replace function public.community_merge_contacts(p_keep uuid, p_drop uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare d public.community_contacts%rowtype;
begin
  if p_keep = p_drop then raise exception 'cannot merge a contact into itself'; end if;
  select * into d from community_contacts where id = p_drop;
  if not found then raise exception 'contact % not found', p_drop; end if;
  if not exists (select 1 from community_contacts where id = p_keep) then raise exception 'contact % not found', p_keep; end if;

  update community_identities set contact_id = p_keep where contact_id = p_drop;
  update community_notes      set contact_id = p_keep where contact_id = p_drop;
  update community_tasks      set contact_id = p_keep where contact_id = p_drop;

  update community_contacts k set
    first_name   = coalesce(nullif(k.first_name, ''), d.first_name),
    last_name    = coalesce(nullif(k.last_name, ''), d.last_name),
    title        = coalesce(nullif(k.title, ''), d.title),
    company_name = coalesce(nullif(k.company_name, ''), d.company_name),
    linkedin_url = coalesce(nullif(k.linkedin_url, ''), d.linkedin_url),
    gender       = coalesce(nullif(k.gender, ''), d.gender),
    has_newsletter = k.has_newsletter or d.has_newsletter,
    background   = case when nullif(k.background, '') is null then d.background
                        when nullif(d.background, '') is null then k.background
                        else k.background || E'\n\n' || d.background end,
    avatar_url   = coalesce(k.avatar_url, d.avatar_url),
    address      = coalesce(k.address, d.address),
    sales_id     = coalesce(k.sales_id, d.sales_id),
    shopify_customer_id = coalesce(k.shopify_customer_id, d.shopify_customer_id),
    email_jsonb  = coalesce((select jsonb_agg(distinct e) from (
                     select jsonb_array_elements(k.email_jsonb) e union select jsonb_array_elements(d.email_jsonb)) s), '[]'::jsonb),
    phone_jsonb  = coalesce((select jsonb_agg(distinct p) from (
                     select jsonb_array_elements(k.phone_jsonb) p union select jsonb_array_elements(d.phone_jsonb)) s), '[]'::jsonb),
    tags         = (select coalesce(array_agg(distinct t), '{}') from unnest(k.tags || d.tags) t),
    first_seen   = least(k.first_seen, d.first_seen),
    last_seen    = greatest(k.last_seen, d.last_seen)
  where k.id = p_keep;

  delete from community_contacts where id = p_drop;
  perform community_recompute_stats(p_keep);
  return p_keep;
end $$;

alter table public.community_contacts   enable row level security;
alter table public.community_identities enable row level security;
alter table public.community_notes      enable row level security;
alter table public.community_tasks      enable row level security;
alter table public.community_sync_state enable row level security;

drop policy if exists "staff all community_contacts" on public.community_contacts;
create policy "staff all community_contacts" on public.community_contacts for all to authenticated using (true) with check (true);
drop policy if exists "staff read community_identities" on public.community_identities;
create policy "staff read community_identities" on public.community_identities for select to authenticated using (true);
drop policy if exists "staff all community_notes" on public.community_notes;
create policy "staff all community_notes" on public.community_notes for all to authenticated using (true) with check (true);
drop policy if exists "staff all community_tasks" on public.community_tasks;
create policy "staff all community_tasks" on public.community_tasks for all to authenticated using (true) with check (true);
drop policy if exists "staff read community_sync_state" on public.community_sync_state;
create policy "staff read community_sync_state" on public.community_sync_state for select to authenticated using (true);

grant execute on function public.community_merge_contacts(uuid, uuid) to authenticated;
grant execute on function public.community_recompute_stats(uuid) to authenticated;

comment on table public.community_contacts is 'Community app: unified customer profiles (Atomic CRM shape) built by the community-sync edge function from Dialpad calls, info@trailbait.com.au and Shopify orders.';
