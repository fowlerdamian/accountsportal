-- AI-generated sales brief — 3 bullets summarising all raw signals on a lead
-- (website summary, tender context, key products, HubSpot notes, channel pitch).
-- Cached so we don't re-call Claude on every page view; refresh button in UI
-- overwrites.

ALTER TABLE public.sales_leads
  ADD COLUMN IF NOT EXISTS ai_brief_bullets      text[],
  ADD COLUMN IF NOT EXISTS ai_brief_generated_at timestamptz;
