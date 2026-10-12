-- Cases + Customer Service merge: a case belongs to a customer profile.
-- cases.contact_id is filled automatically (Shopify order number first, then an
-- unambiguous name match) and can be set by hand from the case page.

alter table public.cases
  add column if not exists contact_id uuid references public.community_contacts(id) on delete set null;

create index if not exists cases_contact_id_idx on public.cases (contact_id);

create or replace function public.cases_match_contact(p_reference text, p_name text)
returns uuid
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  ref text := regexp_replace(coalesce(p_reference, ''), '[^0-9A-Za-z]', '', 'g');
  nm  text := lower(trim(coalesce(p_name, '')));
  hit uuid;
  n   int;
begin
  -- Shopify order number (#9108) → the contact that order's timeline note sits on.
  if length(ref) >= 3 then
    select contact_id into hit from community_notes
     where kind = 'order' and regexp_replace(meta->>'name', '[^0-9A-Za-z]', '', 'g') = ref
     order by date desc limit 1;
    if hit is not null then return hit; end if;
  end if;

  -- Name or company, only when exactly one contact carries it.
  if length(nm) >= 3 then
    select count(*), (array_agg(id))[1] into n, hit from community_contacts
     where lower(trim(coalesce(first_name, '') || ' ' || coalesce(last_name, ''))) = nm
        or lower(trim(company_name)) = nm;
    if n = 1 then return hit; end if;
  end if;
  return null;
end $$;

create or replace function public.cases_set_contact()
returns trigger
language plpgsql
as $$
begin
  if new.contact_id is null then
    new.contact_id := public.cases_match_contact(new.customer_reference, new.customer_name);
  end if;
  return new;
end $$;

drop trigger if exists cases_set_contact on public.cases;
create trigger cases_set_contact
  before insert or update of customer_reference, customer_name on public.cases
  for each row execute function public.cases_set_contact();

-- Contacts often arrive after the case (the order syncs later), so re-try unlinked cases.
create or replace function public.cases_link_contacts()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare changed int;
begin
  update cases c set contact_id = m.id
    from (select id as case_id, cases_match_contact(customer_reference, customer_name) as id
            from cases where contact_id is null) m
   where c.id = m.case_id and m.id is not null;
  get diagnostics changed = row_count;
  return changed;
end $$;

select public.cases_link_contacts();

select cron.unschedule('cases-link-contacts') where exists (select 1 from cron.job where jobname = 'cases-link-contacts');
select cron.schedule('cases-link-contacts', '35 * * * *', $$select public.cases_link_contacts()$$);

-- Merging two contacts carries their cases across (otherwise the FK nulls them).
create or replace function public.community_merge_contacts(p_keep uuid, p_drop uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare d public.community_contacts%rowtype;
begin
  if p_keep = p_drop then raise exception 'cannot merge a contact into itself'; end if;
  select * into d from community_contacts where id = p_drop;
  if not found then raise exception 'contact % not found', p_drop; end if;
  if not exists (select 1 from community_contacts where id = p_keep) then raise exception 'contact % not found', p_keep; end if;

  update community_identities set contact_id = p_keep where contact_id = p_drop;
  update community_notes      set contact_id = p_keep where contact_id = p_drop;
  update community_tasks      set contact_id = p_keep where contact_id = p_drop;
  update cases                set contact_id = p_keep where contact_id = p_drop;

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
end $function$;

notify pgrst, 'reload schema';
