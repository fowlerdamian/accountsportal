ALTER TABLE public.files
  ADD COLUMN IF NOT EXISTS modified_at timestamptz NOT NULL DEFAULT now();

-- Seed existing rows so ordering reflects their actual age.
UPDATE public.files SET modified_at = GREATEST(modified_at, created_at);

CREATE OR REPLACE FUNCTION public.touch_files_modified_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (NEW IS DISTINCT FROM OLD) THEN
    NEW.modified_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_files_modified_at ON public.files;
CREATE TRIGGER trg_touch_files_modified_at
  BEFORE UPDATE ON public.files
  FOR EACH ROW EXECUTE FUNCTION public.touch_files_modified_at();

CREATE INDEX IF NOT EXISTS files_modified_at_idx ON public.files (modified_at DESC);
