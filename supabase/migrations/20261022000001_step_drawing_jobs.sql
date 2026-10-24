-- R&D → Drawings tab: STEP files queued from the portal, turned into A3 PDF
-- drawings by tools/step-drawings-worker.py (runs on the R&D PC; build123d is
-- too large for Vercel/edge functions).

create table if not exists public.step_drawing_jobs (
  id           uuid primary key default gen_random_uuid(),
  created_by   uuid references auth.users(id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now(),
  file_name    text not null,
  part_name    text not null,
  step_path    text not null,
  drawn_by     text,
  rev          text not null default 'A',
  status       text not null default 'queued' check (status in ('queued','running','done','error')),
  started_at   timestamptz,
  finished_at  timestamptz,
  pdf_path     text,
  png_path     text,
  scale        text,
  envelope     text,
  holes        text,
  error        text
);

create index if not exists step_drawing_jobs_status_idx on public.step_drawing_jobs (status, created_at);
create index if not exists step_drawing_jobs_created_idx on public.step_drawing_jobs (created_at desc);

alter table public.step_drawing_jobs enable row level security;

drop policy if exists step_drawing_jobs_staff on public.step_drawing_jobs;
create policy step_drawing_jobs_staff on public.step_drawing_jobs
  for all to authenticated
  using (public.is_staff(auth.uid()))
  with check (public.is_staff(auth.uid()));

-- Private bucket: step/<job id>/<file>, out/<job id>/<part>.pdf|.png
insert into storage.buckets (id, name, public, file_size_limit)
values ('step-drawings', 'step-drawings', false, 104857600)
on conflict (id) do nothing;

drop policy if exists step_drawings_staff_read on storage.objects;
create policy step_drawings_staff_read on storage.objects
  for select to authenticated
  using (bucket_id = 'step-drawings' and public.is_staff(auth.uid()));

drop policy if exists step_drawings_staff_insert on storage.objects;
create policy step_drawings_staff_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'step-drawings' and public.is_staff(auth.uid()));

drop policy if exists step_drawings_staff_delete on storage.objects;
create policy step_drawings_staff_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'step-drawings' and public.is_staff(auth.uid()));

