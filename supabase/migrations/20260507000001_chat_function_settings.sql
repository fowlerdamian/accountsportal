-- ─────────────────────────────────────────────────────────────────────────────
-- Chat Function Settings
-- Per-function on/off + webhook URLs + thresholds for the cin7 → Google Chat
-- functions ported from the standalone "Cin7 Chat Integration" project.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.chat_function_settings (
  slug          text PRIMARY KEY,
  display_name  text NOT NULL,
  description   text,
  enabled       boolean NOT NULL DEFAULT true,
  config        jsonb   NOT NULL DEFAULT '{}'::jsonb,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.chat_function_settings ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read (frontend reads to render the page).
DROP POLICY IF EXISTS chat_function_settings_select ON public.chat_function_settings;
CREATE POLICY chat_function_settings_select
  ON public.chat_function_settings
  FOR SELECT
  TO authenticated
  USING (true);

-- Only admins can update.
DROP POLICY IF EXISTS chat_function_settings_update ON public.chat_function_settings;
CREATE POLICY chat_function_settings_update
  ON public.chat_function_settings
  FOR UPDATE
  TO authenticated
  USING     (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Seed the three functions.
INSERT INTO public.chat_function_settings (slug, display_name, description, enabled, config)
VALUES
  (
    'cin7-daily-digest',
    'Daily Stock Digest',
    'Posts a stock warnings summary to the main office chat at 7:30am AEST each business day. Lists every SKU below its Cin7 reorder level, split into zero stock and low stock.',
    true,
    jsonb_build_object(
      'ops_webhook', '',
      'max_items_per_section', 15
    )
  ),
  (
    'cin7-realtime-alerts',
    'Real-Time Alerts',
    'Runs every 15 minutes. Posts ops alerts (stuck unauthorised orders, shipped-not-invoiced, low stock) to main office chat and management alerts (distributor $1k+ orders, low-margin orders) to the management chat.',
    true,
    jsonb_build_object(
      'ops_webhook', '',
      'mgmt_webhook', '',
      'unauthorised_stuck_days',  5,
      'shipped_not_invoiced_hours', 24,
      'distributor_order_threshold', 1000,
      'min_margin_percent', 20
    )
  ),
  (
    'cin7-diagnostic',
    'Diagnostic',
    'Manual debug endpoint. Tests each Cin7 API endpoint used by the alert functions and returns sample data so you can verify field names and connectivity.',
    true,
    '{}'::jsonb
  )
ON CONFLICT (slug) DO NOTHING;

-- Touch updated_at on changes.
CREATE OR REPLACE FUNCTION public.touch_chat_function_settings()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  NEW.updated_by := auth.uid();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_chat_function_settings ON public.chat_function_settings;
CREATE TRIGGER trg_touch_chat_function_settings
  BEFORE UPDATE ON public.chat_function_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_chat_function_settings();
