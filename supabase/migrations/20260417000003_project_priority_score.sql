-- Add priority score (1–10) to projects for ranking / prioritisation
alter table public.projects
  add column if not exists priority_score smallint
    check (priority_score between 1 and 10);
