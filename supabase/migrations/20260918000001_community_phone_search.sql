-- Phone search that accepts any format the user types.
--
-- search_text previously held only the display form ("0410 849 548"), so
-- "0410849548", "+61 410 849 548" and "410849548" all missed. Every stored
-- number now also contributes digit-only tokens: the raw digits, the local
-- 0-prefixed form, the national form without the trunk 0, and the last 9
-- digits (the part that is identical across every Australian format).

create or replace function public.community_phone_tokens(p text) returns text
language sql immutable as $$
  select case
    when length(d.digits) < 5 then nullif(d.digits, '')
    else concat_ws(' ',
      d.digits,
      case when d.digits like '61%' and length(d.digits) >= 10 then '0' || substr(d.digits, 3) end,
      case when d.digits like '0%'                            then substr(d.digits, 2)       end,
      right(d.digits, 9)
    )
  end
  from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as digits) d
$$;

comment on function public.community_phone_tokens(text) is
  'Digit-only search tokens for a phone number so any input format (0400…, +61 400…, 400 000 000) matches.';

create or replace function public.community_contacts_touch() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  new.search_text := lower(concat_ws(' ',
    new.first_name, new.last_name, new.company_name, new.title,
    (select string_agg(e->>'email', ' ')
       from jsonb_array_elements(coalesce(new.email_jsonb, '[]'::jsonb)) e),
    -- display form + every digit variant, so any typed format matches
    (select string_agg(concat_ws(' ', p->>'number', public.community_phone_tokens(p->>'number')), ' ')
       from jsonb_array_elements(coalesce(new.phone_jsonb, '[]'::jsonb)) p),
    array_to_string(new.tags, ' ')
  ));
  return new;
end $$;

-- Substring search over search_text is the hot path for the contact list.
create extension if not exists pg_trgm;
create index if not exists idx_community_contacts_search_trgm
  on public.community_contacts using gin (search_text gin_trgm_ops);

-- Identity values are matched by suffix when a phone-shaped query is typed.
create index if not exists idx_community_identities_value on public.community_identities (value);

-- Rebuild search_text for every existing contact.
update public.community_contacts set updated_at = updated_at;
