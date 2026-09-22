-- files.modified_at should track the file itself, not its derived artefacts.
-- Thumbnail / STL updates (thumbnail job, get_thumbnail, UI uploads) used to
-- bump modified_at via the touch trigger, making a re-rendered thumbnail look
-- like a newer part in the "latest SolidWorks file per project" logic.
create or replace function public.touch_files_modified_at()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  -- Only bump modified_at if the caller didn't set it explicitly AND a
  -- content column changed (derived columns excluded).
  if (new.modified_at is not distinct from old.modified_at)
     and (row(new.project_id, new.task_id, new.filename, new.file_url, new.file_size, new.mime_type, new.uploaded_by, new.source, new.drive_file_id)
          is distinct from
          row(old.project_id, old.task_id, old.filename, old.file_url, old.file_size, old.mime_type, old.uploaded_by, old.source, old.drive_file_id)) then
    new.modified_at := now();
  end if;
  return new;
end;
$function$;
