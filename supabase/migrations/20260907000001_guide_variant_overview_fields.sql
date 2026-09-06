-- Guide variants: per-variant overview ("welcome screen") fields.
--
-- Until now a variant only carried a label and its own step sequence, so the
-- overview a customer sees after picking a variant still showed the guide's
-- base title, SKU, description, image, time and tools. Each variant can now
-- override those; NULL/empty means "inherit from the guide".

alter table public.guide_variants
  add column if not exists title             text,
  add column if not exists product_code      text,
  add column if not exists short_description text,
  add column if not exists product_image_url text,
  add column if not exists estimated_time    text,
  add column if not exists tools_required    text[];

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
      -- tools_required: JSON array of strings → text[]; absent/null → NULL (inherit).
      if jsonb_typeof(v_variant->'tools_required') = 'array' then
        select array_agg(t) into v_tools
          from jsonb_array_elements_text(v_variant->'tools_required') as t
         where coalesce(t, '') <> '';
      else
        v_tools := null;
      end if;

      if coalesce(v_variant->>'id', '') <> '' then
        update public.guide_variants
           set variant_label     = v_variant->>'variant_label',
               slug              = v_variant->>'slug',
               title             = nullif(v_variant->>'title', ''),
               product_code      = nullif(v_variant->>'product_code', ''),
               short_description = nullif(v_variant->>'short_description', ''),
               product_image_url = nullif(v_variant->>'product_image_url', ''),
               estimated_time    = nullif(v_variant->>'estimated_time', ''),
               tools_required    = v_tools
         where id = (v_variant->>'id')::uuid
           and instruction_set_id = p_guide_id
        returning id into v_variant_id;
      end if;
      if v_variant_id is null then
        insert into public.guide_variants
          (instruction_set_id, variant_label, slug, title, product_code, short_description,
           product_image_url, estimated_time, tools_required)
        values
          (p_guide_id, v_variant->>'variant_label', v_variant->>'slug',
           nullif(v_variant->>'title', ''), nullif(v_variant->>'product_code', ''),
           nullif(v_variant->>'short_description', ''), nullif(v_variant->>'product_image_url', ''),
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

  -- Vehicles: wipe + reinsert (skip blank rows from the UI).
  delete from public.guide_vehicles where instruction_set_id = p_guide_id;
  if jsonb_array_length(coalesce(p_vehicles, '[]'::jsonb)) > 0 then
    insert into public.guide_vehicles (instruction_set_id, make, model, year_from, year_to)
    select p_guide_id, v->>'make', v->>'model', (v->>'year_from')::int,
           coalesce(nullif(v->>'year_to', '')::int, 0)
    from jsonb_array_elements(p_vehicles) as v
    where coalesce(v->>'make','') <> '' and coalesce(v->>'model','') <> ''
      and coalesce(v->>'year_from','') <> '';
  end if;
end;
$$;

grant execute on function public.replace_guide_content(uuid, jsonb, jsonb, jsonb) to authenticated;
