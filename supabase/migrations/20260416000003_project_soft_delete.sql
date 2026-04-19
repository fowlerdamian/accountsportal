-- Soft-delete support for projects (15-day recycle bin)
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- Index for efficient recycle bin queries
CREATE INDEX IF NOT EXISTS idx_projects_deleted_at ON public.projects (deleted_at)
  WHERE deleted_at IS NOT NULL;

-- Scheduled purge: permanently delete projects in recycle bin for > 15 days
-- Call this via a Supabase pg_cron job or edge function cron
CREATE OR REPLACE FUNCTION public.purge_deleted_projects()
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  DELETE FROM public.projects
  WHERE deleted_at IS NOT NULL
    AND deleted_at < now() - interval '15 days';
$$;
