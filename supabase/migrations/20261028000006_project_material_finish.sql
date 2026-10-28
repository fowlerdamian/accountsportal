-- Project-level Material & Finish (set from the popup under the project name).
-- Automatic project drawings take them from the project; a project with none
-- yet still falls back to its last drawing's values. Changing them redraws
-- the project's drawings so the title blocks follow.

alter table public.projects
  add column if not exists material text,
  add column if not exists finish   text;

create or replace function public.queue_project_step_drawing(f public.files)
returns void language plpgsql security definer set search_path = public as $$
declare
  proj record;
  prev record;
begin
  if f.project_id is null or f.filename !~* '\.(step|stp)$' or not project_draws_steps(f.project_id) then
    return;
  end if;
  select material, finish into proj from projects where id = f.project_id;
  select material, finish into prev from step_drawing_jobs
   where project_id = f.project_id and material is not null
   order by created_at desc limit 1;
  insert into step_drawing_jobs (file_name, part_name, step_path, project_id, source_file_id, material, finish, created_by)
  values (f.filename, regexp_replace(f.filename, '\.(step|stp)$', '', 'i'), null, f.project_id, f.id,
          coalesce(proj.material, prev.material), coalesce(proj.finish, prev.finish), null)
  on conflict (source_file_id) where source_file_id is not null do update
    set status = 'queued', error = null, started_at = null, finished_at = null,
        file_name = excluded.file_name, part_name = excluded.part_name,
        material = coalesce(proj.material, step_drawing_jobs.material),
        finish   = coalesce(proj.finish,   step_drawing_jobs.finish);
end;
$$;

create or replace function public.request_step_drawing(p_file uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  f    public.files;
  proj record;
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
  select material, finish into proj from projects where id = f.project_id;
  select material, finish into prev from step_drawing_jobs
   where project_id = f.project_id and material is not null
   order by created_at desc limit 1;
  insert into step_drawing_jobs (file_name, part_name, step_path, project_id, source_file_id, material, finish, drawn_by, created_by)
  values (f.filename, regexp_replace(f.filename, '\.(step|stp)$', '', 'i'), null, f.project_id, f.id,
          coalesce(proj.material, prev.material), coalesce(proj.finish, prev.finish), null, auth.uid())
  on conflict (source_file_id) where source_file_id is not null do update
    set status = 'queued', error = null, started_at = null, finished_at = null,
        file_name = excluded.file_name, part_name = excluded.part_name,
        material = coalesce(proj.material, step_drawing_jobs.material),
        finish   = coalesce(proj.finish,   step_drawing_jobs.finish)
  returning id into jid;
  return jid;
end;
$$;

-- Popup save: store on the project and redraw its drawings with the new title block.
create or replace function public.set_project_material(p_project uuid, p_material text, p_finish text)
returns int language plpgsql security definer set search_path = public as $$
declare
  n int;
begin
  if not public.is_staff(auth.uid()) then
    raise exception 'not allowed';
  end if;
  update projects set material = nullif(trim(p_material), ''), finish = nullif(trim(p_finish), '')
   where id = p_project;
  update step_drawing_jobs
     set material = nullif(trim(p_material), ''), finish = nullif(trim(p_finish), ''),
         status = 'queued', error = null, started_at = null, finished_at = null
   where project_id = p_project and status <> 'running'
     and (material is distinct from nullif(trim(p_material), '') or finish is distinct from nullif(trim(p_finish), ''));
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke execute on function public.set_project_material(uuid, text, text) from public, anon;
grant execute on function public.set_project_material(uuid, text, text) to authenticated;
