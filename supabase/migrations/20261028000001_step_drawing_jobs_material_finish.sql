-- Title block Material + Finish, asked for in the Drawings tab when queueing.
alter table public.step_drawing_jobs
  add column if not exists material text,
  add column if not exists finish   text;
