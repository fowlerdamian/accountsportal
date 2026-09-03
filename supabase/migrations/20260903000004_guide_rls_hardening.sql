-- Guide app security hardening (2026-09-03 audit).
--
--  1. Staff-only writes/reads on guide admin tables. The old policies were
--     `for all to authenticated using (true)` — every signed-in auth user
--     (including future contractor-hub accounts) could read customer order
--     lines in guide_deliveries, publish/delete guides and change delivery
--     settings. Now gated on public.is_staff(auth.uid()) (user_roles admin/editor),
--     the same guard the contractor-hub tables already use. Every current auth
--     user is staff, so nothing changes for the team.
--  2. Anonymous customers can only read PUBLISHED guides (steps/variants/vehicles
--     follow the guide). Previously any draft was readable by slug and "Unpublish"
--     never took a guide offline.
--  3. Anonymous inserts (feedback, support questions, view tracking) are limited
--     to published guides, sane lengths, and cannot pre-set resolved/escalated/answer.
--  4. replace_guide_content: staff check, guide-exists check, and variant ids are
--     PRESERVED when the client passes them (feedback.variant_id / step_views.variant_id
--     reference guide_variants without cascade, so re-creating variants on every save
--     would start failing once the viewer records a variant — which it now does).

-- ── 1. Staff-only policies ───────────────────────────────────────────────────
do $$
declare
  t text;
begin
  foreach t in array array[
    'instruction_sets','instruction_steps','guide_publications','guide_variants','guide_vehicles',
    'feedback','support_questions','brands','categories','guide_views','step_views',
    'guide_deliveries','guide_product_links','guide_delivery_settings'
  ] loop
    execute format('drop policy if exists %I on public.%I', 'auth_full_' || t, t);
    execute format('drop policy if exists %I on public.%I', 'authenticated full ' || t, t);
    execute format('drop policy if exists %I on public.%I', 'staff full ' || t, t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()))',
      'staff full ' || t, t
    );
  end loop;
end $$;

-- ── 2. Anonymous reads: published guides only ────────────────────────────────
drop policy if exists "public read instruction sets" on public.instruction_sets;
create policy "public read instruction sets" on public.instruction_sets
  for select to anon
  using (exists (select 1 from public.guide_publications p
                 where p.instruction_set_id = instruction_sets.id and p.status = 'published'));

drop policy if exists "public read instruction steps" on public.instruction_steps;
create policy "public read instruction steps" on public.instruction_steps
  for select to anon
  using (exists (select 1 from public.guide_publications p
                 where p.instruction_set_id = instruction_steps.instruction_set_id and p.status = 'published'));

drop policy if exists "public read guide variants" on public.guide_variants;
create policy "public read guide variants" on public.guide_variants
  for select to anon
  using (exists (select 1 from public.guide_publications p
                 where p.instruction_set_id = guide_variants.instruction_set_id and p.status = 'published'));

drop policy if exists "public read guide vehicles" on public.guide_vehicles;
create policy "public read guide vehicles" on public.guide_vehicles
  for select to anon
  using (exists (select 1 from public.guide_publications p
                 where p.instruction_set_id = guide_vehicles.instruction_set_id and p.status = 'published'));

-- brands / categories / guide_publications stay publicly readable (the viewer
-- needs brand styling, category names and publication status).

-- ── 3. Anonymous inserts: bounded, published guides only ─────────────────────
drop policy if exists "public insert feedback" on public.feedback;
create policy "public insert feedback" on public.feedback
  for insert to anon
  with check (
    resolved = false
    and (comment is null or length(comment) <= 2000)
    and (rating is null or rating between 1 and 5)
    and exists (select 1 from public.guide_publications p
                where p.instruction_set_id = feedback.instruction_set_id and p.status = 'published')
  );

drop policy if exists "public insert support questions" on public.support_questions;
create policy "public insert support questions" on public.support_questions
  for insert to anon
  with check (
    resolved = false and escalated = false and answer is null
    and length(question) between 1 and 2000
    and exists (select 1 from public.guide_publications p
                where p.instruction_set_id = support_questions.instruction_set_id and p.status = 'published')
  );

drop policy if exists "public insert step views" on public.step_views;
create policy "public insert step views" on public.step_views
  for insert to anon
  with check (exists (select 1 from public.guide_publications p
                      where p.instruction_set_id = step_views.instruction_set_id and p.status = 'published'));

drop policy if exists "public insert guide views" on public.guide_views;
create policy "public insert guide views" on public.guide_views
  for insert to anon
  with check (exists (select 1 from public.guide_publications p
                      where p.instruction_set_id = guide_views.instruction_set_id and p.status = 'published'));

-- ── 4. replace_guide_content: staff-gated, variant ids preserved ─────────────
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
      if coalesce(v_variant->>'id', '') <> '' then
        update public.guide_variants
           set variant_label = v_variant->>'variant_label',
               slug          = v_variant->>'slug'
         where id = (v_variant->>'id')::uuid
           and instruction_set_id = p_guide_id
        returning id into v_variant_id;
      end if;
      if v_variant_id is null then
        insert into public.guide_variants (instruction_set_id, variant_label, slug)
        values (p_guide_id, v_variant->>'variant_label', v_variant->>'slug')
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
