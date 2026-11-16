-- Warehouse barcode labels go through the print station too (kind = 'barcode',
-- label fields in payload). Guide jobs keep guide_id.
alter table public.label_print_jobs
  add column if not exists kind text not null default 'guide',
  add column if not exists payload jsonb,
  alter column guide_id drop not null;
alter table public.label_print_jobs drop constraint if exists label_print_jobs_kind_check;
alter table public.label_print_jobs add constraint label_print_jobs_kind_check
  check ((kind = 'guide' and guide_id is not null) or (kind = 'barcode' and payload is not null));
