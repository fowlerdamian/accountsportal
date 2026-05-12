-- Telemetry columns on the settings table.
ALTER TABLE public.chat_function_settings
  ADD COLUMN IF NOT EXISTS last_run_at      timestamptz,
  ADD COLUMN IF NOT EXISTS last_run_status  text,
  ADD COLUMN IF NOT EXISTS last_run_summary jsonb;

-- Default dedup window per function (hours). The realtime alert function
-- skips re-posting an identical alert within this window. 0 = no dedup.
UPDATE public.chat_function_settings
SET config = config || jsonb_build_object('dedup_window_hours', 12)
WHERE slug = 'cin7-realtime-alerts'
  AND NOT (config ? 'dedup_window_hours');

-- Posted-alert fingerprints for dedup.
CREATE TABLE IF NOT EXISTS public.chat_function_alerts (
  id           bigserial PRIMARY KEY,
  slug         text NOT NULL,
  fingerprint  text NOT NULL,
  posted_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_function_alerts_dedup_idx
  ON public.chat_function_alerts (slug, fingerprint, posted_at DESC);

CREATE OR REPLACE FUNCTION public.prune_chat_function_alerts()
RETURNS void
LANGUAGE sql
AS $$
  DELETE FROM public.chat_function_alerts WHERE posted_at < now() - interval '14 days';
$$;

ALTER TABLE public.chat_function_alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS chat_function_alerts_select ON public.chat_function_alerts;
CREATE POLICY chat_function_alerts_select
  ON public.chat_function_alerts
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
