-- Wiring-break divider — a step row that signifies the end of bracket-only
-- instructions and the start of the wiring section. Rendered as an
-- interstitial "Continue" screen in the viewer, excluded from step count
-- and progress bar.

ALTER TABLE public.instruction_steps
  ADD COLUMN IF NOT EXISTS is_divider boolean NOT NULL DEFAULT false;
