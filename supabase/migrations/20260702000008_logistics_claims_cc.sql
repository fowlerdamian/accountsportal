-- Multiple dispute recipients: claims_email and claims_cc both accept
-- multiple addresses separated by ";".
alter table public.carriers add column if not exists claims_cc text;
