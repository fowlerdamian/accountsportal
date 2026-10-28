-- Cloud CAD thumbnails: api/step-thumbnails (Vercel, every 10 min via pg_cron)
-- renders STEP files to PNG with no PC involved. A row needs a render when it
-- has never been rendered from its current version: thumbnail_source_mtime is
-- empty or older than modified_at. Failures are stamped too (thumbnail_url
-- left as is), so a broken file is retried only once it changes.

create or replace function public.step_thumbnail_queue(p_limit int default 20)
returns table (id uuid, filename text, source text, file_url text, drive_file_id text, modified_at timestamptz)
language sql stable security definer set search_path = public as $$
  select f.id, f.filename, f.source, f.file_url, f.drive_file_id, f.modified_at
    from files f
    join projects p on p.id = f.project_id and p.deleted_at is null
   where f.filename ~* '\.(step|stp)$'
     and (f.thumbnail_source_mtime is null or f.thumbnail_source_mtime < f.modified_at)
   order by f.modified_at desc
   limit p_limit;
$$;

revoke execute on function public.step_thumbnail_queue(int) from public, anon, authenticated;
