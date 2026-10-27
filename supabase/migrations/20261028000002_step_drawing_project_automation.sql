-- R&D projects → automatic STEP drawings.
-- Once a project's active stage is Prototype or later (Prototype / Testing /
-- Complete), every STEP file in it gets a drawing job: new files as they land
-- (upload or Drive sync), and all existing STEP files the moment the project
-- reaches Prototype. A changed file (new size) is redrawn. The worker fetches
-- the STEP from the project file itself (public bucket URL or Drive), so
-- step_path is empty for these jobs.

alter table public.step_drawing_jobs
  add column if not exists project_id     uuid references public.projects(id) on delete cascade,
  add column if not exists source_file_id uuid references public.files(id) on delete set null,
  alter column step_path drop not null;

create unique index if not exists step_drawing_jobs_source_file_uidx
  on public.step_drawing_jobs (source_file_id) where source_file_id is not null;
create index if not exists step_drawing_jobs_project_idx on public.step_drawing_jobs (project_id, created_at desc);

create or replace function public.project_draws_steps(p_project uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from projects p join project_stages s on s.project_id = p.id and s.is_active
    where p.id = p_project and p.deleted_at is null and s.name in ('Prototype', 'Testing', 'Complete')
  );
$$;

-- Queue (or requeue) a drawing for one project file. Material / finish carry
-- over from the project's last drawing that had them; blank otherwise.
create or replace function public.queue_project_step_drawing(f public.files)
returns void language plpgsql security definer set search_path = public as $$
declare
  prev record;
begin
  if f.project_id is null or f.filename !~* '\.(step|stp)$' or not project_draws_steps(f.project_id) then
    return;
  end if;
  select material, finish into prev from step_drawing_jobs
   where project_id = f.project_id and material is not null
   order by created_at desc limit 1;
  insert into step_drawing_jobs (file_name, part_name, step_path, project_id, source_file_id, material, finish, created_by)
  values (f.filename, regexp_replace(f.filename, '\.(step|stp)$', '', 'i'), null, f.project_id, f.id,
          prev.material, prev.finish, null)
  on conflict (source_file_id) where source_file_id is not null do update
    set status = 'queued', error = null, started_at = null, finished_at = null,
        file_name = excluded.file_name, part_name = excluded.part_name;
end;
$$;

create or replace function public.files_queue_step_drawing()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Updates only matter when the file content changed.
  if tg_op = 'UPDATE' and new.file_size is not distinct from old.file_size
     and new.filename = old.filename and new.project_id is not distinct from old.project_id then
    return new;
  end if;
  perform queue_project_step_drawing(new);
  return new;
end;
$$;

drop trigger if exists files_queue_step_drawing on public.files;
create trigger files_queue_step_drawing
  after insert or update of file_size, filename, project_id on public.files
  for each row execute function public.files_queue_step_drawing();

-- Project reaches Prototype (or later): draw every STEP file it has that
-- hasn't been drawn yet.
create or replace function public.stage_queue_step_drawings()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  f public.files;
begin
  if not new.is_active or new.name not in ('Prototype', 'Testing', 'Complete') then
    return new;
  end if;
  for f in
    select * from files
     where project_id = new.project_id and filename ~* '\.(step|stp)$'
       and not exists (select 1 from step_drawing_jobs j where j.source_file_id = files.id)
  loop
    perform queue_project_step_drawing(f);
  end loop;
  return new;
end;
$$;

drop trigger if exists stage_queue_step_drawings on public.project_stages;
create trigger stage_queue_step_drawings
  after insert or update of is_active, name on public.project_stages
  for each row execute function public.stage_queue_step_drawings();

revoke execute on function public.queue_project_step_drawing(public.files) from public, anon, authenticated;
