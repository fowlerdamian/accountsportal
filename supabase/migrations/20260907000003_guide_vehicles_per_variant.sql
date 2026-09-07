-- Vehicle fitment per variant.
--
-- Each guide_vehicles row now says which version it applies to:
--   variant_scope = 'all'     -> every version (default; all existing rows)
--   variant_scope = 'base'    -> only the base (variant_id IS NULL) step sequence
--   variant_scope = 'variant' -> only guide_variants(variant_id)
-- The viewer filters the "Suits" list by the chosen version and lists the
-- version-specific vehicles under each option in the picker.

alter table public.guide_vehicles
  add column if not exists variant_scope text not null default 'all',
  add column if not exists variant_id uuid references public.guide_variants(id) on delete cascade;

alter table public.guide_vehicles drop constraint if exists guide_vehicles_variant_scope_chk;
alter table public.guide_vehicles add constraint guide_vehicles_variant_scope_chk
  check (variant_scope in ('all', 'base', 'variant')
         and (variant_scope <> 'variant' or variant_id is not null));

create index if not exists guide_vehicles_variant_id_idx on public.guide_vehicles(variant_id);

create or replace function public.replace_guide_content(
  p_guide_id uuid,
  p_steps    jsonb default '[]'::jsonb,
  p_variants jsonb default '[]'::jsonb,
  p_vehicles jsonb default '[]'::jsonb
) returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_variant    jsonb;
  v_variant_id uuid;
  v_keep_ids   uuid[] := '{}';
  v_tools      text[];
  v_images     text[];
begin
  if not public.is_staff(auth.uid()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from public.instruction_sets where id = p_guide_id) then
    raise exception 'guide % not found', p_guide_id using errcode = 'P0002';
  end if;

  -- Wipe ALL step rows for this guide (main + variant; one table).
  delete from public.instruction_steps where instruction_set_id = p_guide_id;

  -- Main steps (variant_id NULL).
  if jsonb_array_length(coalesce(p_steps, '[]'::jsonb)) > 0 then
    insert into public.instruction_steps
      (instruction_set_id, variant_id, step_number, order_index, subtitle, description,
       image_url, image_original_url, image2_url, image2_original_url, is_divider)
    select
      p_guide_id, null,
      (s->>'step_number')::int, (s->>'order_index')::int,
      coalesce(s->>'subtitle', ''), coalesce(s->>'description', ''),
      nullif(s->>'image_url', ''), nullif(s->>'image_original_url', ''),
      nullif(s->>'image2_url', ''), nullif(s->>'image2_original_url', ''),
      coalesce((s->>'is_divider')::boolean, false)
    from jsonb_array_elements(p_steps) as s;
  end if;

  -- Variants: update the ones the client still has (by id), insert new ones,
  -- then delete whatever was dropped. Ids survive so feedback/step_views keep
  -- pointing at the right variant.
  if jsonb_array_length(coalesce(p_variants, '[]'::jsonb)) > 0 then
    for v_variant in select value from jsonb_array_elements(p_variants) loop
      v_variant_id := null;
      if jsonb_typeof(v_variant->'tools_required') = 'array' then
        select array_agg(t) into v_tools
          from jsonb_array_elements_text(v_variant->'tools_required') as t
         where coalesce(t, '') <> '';
      else
        v_tools := null;
      end if;
      -- Up to 4 title images; drop blanks first, then cap. Empty -> NULL (inherit).
      if jsonb_typeof(v_variant->'product_image_urls') = 'array' then
        select array_agg(u order by ord) into v_images
          from (select u, ord
                  from jsonb_array_elements_text(v_variant->'product_image_urls') with ordinality as x(u, ord)
                 where coalesce(u, '') <> ''
                 order by ord limit 4) q;
      else
        v_images := null;
      end if;
      if v_images is not null and cardinality(v_images) = 0 then v_images := null; end if;

      if coalesce(v_variant->>'id', '') <> '' then
        update public.guide_variants
           set variant_label      = v_variant->>'variant_label',
               slug               = v_variant->>'slug',
               title              = nullif(v_variant->>'title', ''),
               product_code       = nullif(v_variant->>'product_code', ''),
               short_description  = nullif(v_variant->>'short_description', ''),
               product_image_url  = coalesce(v_images[1], nullif(v_variant->>'product_image_url', '')),
               product_image_urls = v_images,
               estimated_time     = nullif(v_variant->>'estimated_time', ''),
               tools_required     = v_tools
         where id = (v_variant->>'id')::uuid
           and instruction_set_id = p_guide_id
        returning id into v_variant_id;
      end if;
      if v_variant_id is null then
        insert into public.guide_variants
          (instruction_set_id, variant_label, slug, title, product_code, short_description,
           product_image_url, product_image_urls, estimated_time, tools_required)
        values
          (p_guide_id, v_variant->>'variant_label', v_variant->>'slug',
           nullif(v_variant->>'title', ''), nullif(v_variant->>'product_code', ''),
           nullif(v_variant->>'short_description', ''),
           coalesce(v_images[1], nullif(v_variant->>'product_image_url', '')), v_images,
           nullif(v_variant->>'estimated_time', ''), v_tools)
        returning id into v_variant_id;
      end if;
      v_keep_ids := v_keep_ids || v_variant_id;

      if jsonb_array_length(coalesce(v_variant->'steps', '[]'::jsonb)) > 0 then
        insert into public.instruction_steps
          (instruction_set_id, variant_id, step_number, order_index, subtitle, description,
           image_url, image_original_url, image2_url, image2_original_url, is_divider)
        select
          p_guide_id, v_variant_id,
          (s->>'step_number')::int, (s->>'order_index')::int,
          coalesce(s->>'subtitle', ''), coalesce(s->>'description', ''),
          nullif(s->>'image_url', ''), nullif(s->>'image_original_url', ''),
          nullif(s->>'image2_url', ''), nullif(s->>'image2_original_url', ''),
          coalesce((s->>'is_divider')::boolean, false)
        from jsonb_array_elements(v_variant->'steps') as s;
      end if;
    end loop;
  end if;

  delete from public.guide_variants
   where instruction_set_id = p_guide_id
     and not (id = any (v_keep_ids));

  -- Vehicles: wipe + reinsert (skip blank rows from the UI). A vehicle may be
  -- tied to a version: variant_id (existing variant) or variant_slug (variant
  -- created in this same call) -> scope 'variant'; variant_scope 'base' ->
  -- base only; anything unresolvable falls back to 'all'.
  delete from public.guide_vehicles where instruction_set_id = p_guide_id;
  if jsonb_array_length(coalesce(p_vehicles, '[]'::jsonb)) > 0 then
    insert into public.guide_vehicles
      (instruction_set_id, make, model, year_from, year_to, variant_scope, variant_id)
    select p_guide_id, v->>'make', v->>'model', (v->>'year_from')::int,
           coalesce(nullif(v->>'year_to', '')::int, 0),
           case when gv.id is not null then 'variant'
                when v->>'variant_scope' = 'base' then 'base'
                else 'all' end,
           gv.id
    from jsonb_array_elements(p_vehicles) as v
    left join lateral (
      select g2.id from public.guide_variants g2
       where g2.instruction_set_id = p_guide_id
         and ((coalesce(v->>'variant_id', '') <> '' and g2.id::text = v->>'variant_id')
           or (coalesce(v->>'variant_slug', '') <> '' and g2.slug = v->>'variant_slug'))
       limit 1) gv on true
    where coalesce(v->>'make','') <> '' and coalesce(v->>'model','') <> ''
      and coalesce(v->>'year_from','') <> '';
  end if;
end;
$$;

grant execute on function public.replace_guide_content(uuid, jsonb, jsonb, jsonb) to authenticated;
