-- Project page refresh icon on a STEP file: (re)draw it now, whatever the
-- project's stage. Requeues the existing job (keeping its material/finish) so
-- the worker overwrites the PDF in Drive, or creates one carrying the
-- project's last material/finish.

create or replace function public.request_step_drawing(p_file uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  f    public.files;
  prev record;
  jid  uuid;
begin
  if not public.is_staff(auth.uid()) then
    raise exception 'not allowed';
  end if;
  select * into f from files where id = p_file;
  if f.id is null or f.project_id is null or f.filename !~* '\.(step|stp)$' then
    raise exception 'not a project STEP file';
  end if;
  select material, finish into prev from step_drawing_jobs
   where project_id = f.project_id and material is not null
   order by created_at desc limit 1;
  insert into step_drawing_jobs (file_name, part_name, step_path, project_id, source_file_id, material, finish, drawn_by, created_by)
  values (f.filename, regexp_replace(f.filename, '\.(step|stp)$', '', 'i'), null, f.project_id, f.id,
          prev.material, prev.finish, null, auth.uid())
  on conflict (source_file_id) where source_file_id is not null do update
    set status = 'queued', error = null, started_at = null, finished_at = null,
        file_name = excluded.file_name, part_name = excluded.part_name
  returning id into jid;
  return jid;
end;
$$;

revoke execute on function public.request_step_drawing(uuid) from public, anon;
grant execute on function public.request_step_drawing(uuid) to authenticated;
