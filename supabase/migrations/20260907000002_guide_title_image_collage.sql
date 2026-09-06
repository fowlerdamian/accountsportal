-- Title-image collage: guides and variants can carry up to 4 product images.
-- `product_image_url` stays as the first image (thumbnails, emails, older
-- clients keep working); `product_image_urls` is the full ordered list.

alter table public.instruction_sets add column if not exists product_image_urls text[];
alter table public.guide_variants   add column if not exists product_image_urls text[];

update public.instruction_sets set product_image_urls = array[product_image_url]
 where product_image_urls is null and coalesce(product_image_url, '') <> '';
update public.guide_variants set product_image_urls = array[product_image_url]
 where product_image_urls is null and coalesce(product_image_url, '') <> '';

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

  delete from public.instruction_steps where instruction_set_id = p_guide_id;

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
      -- Up to 4 title images; empty list → NULL (inherit the guide's images).
      if jsonb_typeof(v_variant->'product_image_urls') = 'array' then
        -- Drop blanks first, then keep the first 4 in order.
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
