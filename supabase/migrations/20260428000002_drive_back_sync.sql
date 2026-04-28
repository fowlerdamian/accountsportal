alter type file_source add value if not exists 'drive';
alter table public.files alter column file_size drop not null;
alter table public.files alter column uploaded_by drop not null;
