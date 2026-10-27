-- The Drive PDF a project drawing last saved, so a redraw (or a STEP renamed
-- in Drive) overwrites and renames that same PDF instead of leaving the old
-- one behind. Existing done jobs are seeded with the name they were saved as.
alter table public.step_drawing_jobs
  add column if not exists drive_pdf_id   text,
  add column if not exists drive_pdf_name text;
update public.step_drawing_jobs set drive_pdf_name = part_name || '.pdf'
 where project_id is not null and status = 'done' and drive_pdf_name is null;
