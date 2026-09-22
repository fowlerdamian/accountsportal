-- Change detection for the SolidWorks thumbnail job (tools/sldprt-thumbs.ps1):
-- the local file's last-write time (UTC) the current thumbnail was rendered
-- from. NULL = never rendered by the job (or thumbnail came from elsewhere),
-- so the job renders it when the file is available locally.
alter table public.files add column if not exists thumbnail_source_mtime timestamptz;
comment on column public.files.thumbnail_source_mtime is 'Local file mtime (UTC) the thumbnail_url image was rendered from by the SLDPRT thumbnail job; NULL = not rendered by the job.';
