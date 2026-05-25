-- Atomic replace of a guide's content (steps, variants + their steps, vehicles).
-- Existing JS in GuideEditor.tsx did DELETE-then-INSERT across multiple tables
-- with no transaction; a failure mid-flight wiped all step rows for a guide.
-- This function runs the whole replacement inside a single Postgres tx so any
-- failure rolls back and the previous content is preserved.
CREATE OR REPLACE FUNCTION public.replace_guide_content(
  p_guide_id uuid,
  p_steps    jsonb DEFAULT '[]'::jsonb,
  p_variants jsonb DEFAULT '[]'::jsonb,
  p_vehicles jsonb DEFAULT '[]'::jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_variant   jsonb;
  v_variant_id uuid;
BEGIN
  -- Wipe ALL step rows for this guide (main + variant; one table).
  DELETE FROM public.instruction_steps WHERE instruction_set_id = p_guide_id;

  -- Main steps (variant_id NULL).
  IF jsonb_array_length(COALESCE(p_steps, '[]'::jsonb)) > 0 THEN
    INSERT INTO public.instruction_steps
      (instruction_set_id, variant_id, step_number, order_index, subtitle, description,
       image_url, image_original_url, image2_url, image2_original_url, is_divider)
    SELECT
      p_guide_id,
      NULL,
      (s->>'step_number')::int,
      (s->>'order_index')::int,
      COALESCE(s->>'subtitle', ''),
      COALESCE(s->>'description', ''),
      NULLIF(s->>'image_url', ''),
      NULLIF(s->>'image_original_url', ''),
      NULLIF(s->>'image2_url', ''),
      NULLIF(s->>'image2_original_url', ''),
      COALESCE((s->>'is_divider')::boolean, false)
    FROM jsonb_array_elements(p_steps) AS s;
  END IF;

  -- Variants: wipe + reinsert with their steps.
  DELETE FROM public.guide_variants WHERE instruction_set_id = p_guide_id;

  IF jsonb_array_length(COALESCE(p_variants, '[]'::jsonb)) > 0 THEN
    FOR v_variant IN SELECT value FROM jsonb_array_elements(p_variants) LOOP
      INSERT INTO public.guide_variants (instruction_set_id, variant_label, slug)
      VALUES (
        p_guide_id,
        v_variant->>'variant_label',
        v_variant->>'slug'
      )
      RETURNING id INTO v_variant_id;

      IF jsonb_array_length(COALESCE(v_variant->'steps', '[]'::jsonb)) > 0 THEN
        INSERT INTO public.instruction_steps
          (instruction_set_id, variant_id, step_number, order_index, subtitle, description,
           image_url, image_original_url, image2_url, image2_original_url, is_divider)
        SELECT
          p_guide_id,
          v_variant_id,
          (s->>'step_number')::int,
          (s->>'order_index')::int,
          COALESCE(s->>'subtitle', ''),
          COALESCE(s->>'description', ''),
          NULLIF(s->>'image_url', ''),
          NULLIF(s->>'image_original_url', ''),
          NULLIF(s->>'image2_url', ''),
          NULLIF(s->>'image2_original_url', ''),
          false
        FROM jsonb_array_elements(v_variant->'steps') AS s;
      END IF;
    END LOOP;
  END IF;

  -- Vehicles: wipe + reinsert (skip blank rows from the UI).
  DELETE FROM public.guide_vehicles WHERE instruction_set_id = p_guide_id;

  IF jsonb_array_length(COALESCE(p_vehicles, '[]'::jsonb)) > 0 THEN
    INSERT INTO public.guide_vehicles (instruction_set_id, make, model, year_from, year_to)
    SELECT
      p_guide_id,
      v->>'make',
      v->>'model',
      (v->>'year_from')::int,
      COALESCE(NULLIF(v->>'year_to', '')::int, 0)
    FROM jsonb_array_elements(p_vehicles) AS v
    WHERE COALESCE(v->>'make','') <> ''
      AND COALESCE(v->>'model','') <> ''
      AND COALESCE(v->>'year_from','') <> '';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.replace_guide_content(uuid, jsonb, jsonb, jsonb) TO authenticated;
