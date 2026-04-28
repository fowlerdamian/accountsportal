-- Add Google Drive folder/file references
alter table public.projects add column if not exists drive_folder_id text;
alter table public.files    add column if not exists drive_file_id   text;
