-- Create contractor-hub-files storage bucket
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'contractor-hub-files',
  'contractor-hub-files',
  true,
  52428800, -- 50 MB
  array[
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain', 'text/csv',
    'application/zip',
    'model/stl', 'application/octet-stream'
  ]
)
on conflict (id) do nothing;

-- RLS: authenticated users can read all files (bucket is public)
create policy "Authenticated users can read hub files"
  on storage.objects for select to authenticated
  using (bucket_id = 'contractor-hub-files');

-- Staff and contractors can upload to {project_id}/* paths
create policy "Authenticated users can upload hub files"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'contractor-hub-files');

-- Only staff can delete
create policy "Staff can delete hub files"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'contractor-hub-files'
    and public.is_staff(auth.uid())
  );
