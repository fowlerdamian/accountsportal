-- Add metadata column to project_stages for stage-specific fields
-- (e.g. Prototype stage stores { ordered: true/false })
ALTER TABLE public.project_stages ADD COLUMN IF NOT EXISTS metadata jsonb;
