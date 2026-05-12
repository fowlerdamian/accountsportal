ALTER TABLE public.chat_function_settings
  ADD COLUMN IF NOT EXISTS consecutive_errors int NOT NULL DEFAULT 0;

UPDATE public.chat_function_settings
SET config = config
  || jsonb_build_object('escalation_webhook', '', 'escalation_threshold', 3)
WHERE NOT (config ? 'escalation_webhook');

DROP POLICY IF EXISTS chat_function_alerts_delete ON public.chat_function_alerts;
CREATE POLICY chat_function_alerts_delete
  ON public.chat_function_alerts
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.record_chat_function_run(
  p_slug    text,
  p_status  text,
  p_summary jsonb
)
RETURNS TABLE (consecutive_errors int, config jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.chat_function_settings s
  SET last_run_at        = now(),
      last_run_status    = p_status,
      last_run_summary   = p_summary,
      consecutive_errors = CASE WHEN p_status = 'error' THEN s.consecutive_errors + 1 ELSE 0 END
  WHERE s.slug = p_slug
  RETURNING s.consecutive_errors, s.config;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_chat_function_run(text, text, jsonb) TO service_role;
