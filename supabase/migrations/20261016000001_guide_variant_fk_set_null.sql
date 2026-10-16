-- Deleting a variant (dropped in the editor save RPC) failed because step_views
-- and feedback referenced guide_variants with no ON DELETE action. Keep the
-- history (still tied to the guide) and null out the variant link instead.
alter table public.step_views drop constraint step_views_variant_id_fkey,
  add constraint step_views_variant_id_fkey foreign key (variant_id) references public.guide_variants(id) on delete set null;
alter table public.feedback drop constraint feedback_variant_id_fkey,
  add constraint feedback_variant_id_fkey foreign key (variant_id) references public.guide_variants(id) on delete set null;
