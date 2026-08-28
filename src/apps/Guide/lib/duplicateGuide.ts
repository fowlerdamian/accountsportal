// Deep-copy a guide: instruction set, base steps, variants + their steps, vehicle fitment.
// Publications are NOT copied (the copy starts as a draft on every brand).
import { supabase } from "@guide/integrations/supabase/client";

const randomSlug = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(6))).map((b) => b.toString(36).padStart(2, "0")).join("").slice(0, 10);

/** Each SKU must stay unique per guide, so every token gets the suffix: "A, B" → "A-COPY, B-COPY". */
const copyCode = (code: string | null | undefined) =>
  String(code ?? "").split(/[,;\s]+/).filter(Boolean).map((c) => `${c}-COPY`).join(", ");

export async function duplicateGuide(sourceId: string): Promise<string> {
  const { data: src, error: srcErr } = await supabase.from("instruction_sets").select("*").eq("id", sourceId).single();
  if (srcErr || !src) throw srcErr ?? new Error("Guide not found");

  const { data: created, error: insErr } = await supabase.from("instruction_sets").insert({
    title: `Copy of ${src.title}`,
    product_code: copyCode(src.product_code),
    slug: randomSlug(),
    category_id: src.category_id,
    estimated_time: src.estimated_time,
    short_description: src.short_description,
    tools_required: src.tools_required,
    product_image_url: src.product_image_url,
    notice_text: src.notice_text,
    default_variant_label: (src as any).default_variant_label ?? null,
  }).select("id").single();
  if (insErr || !created) throw insErr ?? new Error("Could not create copy");
  const newId = created.id as string;

  // Variants first, so their steps can be re-pointed.
  const { data: variants } = await supabase.from("guide_variants").select("*").eq("instruction_set_id", sourceId);
  const variantMap = new Map<string, string>();
  for (const v of variants ?? []) {
    const { data: nv, error } = await supabase.from("guide_variants")
      .insert({ instruction_set_id: newId, variant_label: v.variant_label, slug: randomSlug() })
      .select("id").single();
    if (error || !nv) throw error ?? new Error("Could not copy variant");
    variantMap.set(v.id, nv.id);
  }

  const { data: steps } = await supabase.from("instruction_steps").select("*").eq("instruction_set_id", sourceId).order("order_index");
  if (steps?.length) {
    const { error } = await supabase.from("instruction_steps").insert(
      steps.map((s: any) => ({
        instruction_set_id: newId,
        variant_id: s.variant_id ? (variantMap.get(s.variant_id) ?? null) : null,
        step_number: s.step_number,
        subtitle: s.subtitle,
        description: s.description,
        order_index: s.order_index,
        image_url: s.image_url,
        image_original_url: s.image_original_url,
        image2_url: s.image2_url,
        image2_original_url: s.image2_original_url,
        video_url: s.video_url ?? null,
        is_divider: s.is_divider ?? false,
      })),
    );
    if (error) throw error;
  }

  const { data: vehicles } = await supabase.from("guide_vehicles").select("*").eq("instruction_set_id", sourceId);
  if (vehicles?.length) {
    const { error } = await supabase.from("guide_vehicles").insert(
      vehicles.map((v: any) => ({ instruction_set_id: newId, make: v.make, model: v.model, year_from: v.year_from, year_to: v.year_to })),
    );
    if (error) throw error;
  }

  return newId;
}
