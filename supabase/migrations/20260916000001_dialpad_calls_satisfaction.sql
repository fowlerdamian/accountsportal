-- Dialpad call records synced by api/dialpad-sync.js (Vercel) for the Support
-- Hub "Satisfaction" tab. One row per concluded call. AI columns are filled by
-- the dialpad-grade edge function (Claude) from the call transcript.
CREATE TABLE IF NOT EXISTS public.dialpad_calls (
  call_id            text PRIMARY KEY,
  started_at         timestamptz NOT NULL,
  connected_at       timestamptz,
  ended_at           timestamptz,
  direction          text NOT NULL,                 -- inbound | outbound
  status             text NOT NULL,                 -- answered | missed | voicemail
  duration_seconds   integer NOT NULL DEFAULT 0,
  ring_seconds       integer,                       -- started→connected
  external_number    text,
  internal_number    text,
  contact_id         text,
  contact_name       text,
  agent_id           text,                          -- Dialpad user id (target)
  agent_name         text,
  target_type        text,
  was_recorded       boolean NOT NULL DEFAULT false,
  is_transferred     boolean NOT NULL DEFAULT false,
  has_voicemail      boolean NOT NULL DEFAULT false,
  mos_score          numeric(4,2),                  -- Dialpad call-quality score 1–5
  -- Transcript + Dialpad AI moments
  transcript_lines   integer,
  transcript_text    text,
  transcript_fetched_at timestamptz,
  positive_moments   integer NOT NULL DEFAULT 0,    -- Dialpad "positive_sentiment" moments
  negative_moments   integer NOT NULL DEFAULT 0,    -- Dialpad "negative_sentiment" moments
  dialpad_purpose_category text,
  -- Claude grading
  ai_csat            smallint,                      -- 1–5 inferred customer satisfaction
  ai_sentiment       text,                          -- positive | neutral | negative
  ai_resolved        boolean,                       -- customer's need met on this call
  ai_purpose         text,                          -- short category e.g. Order status
  ai_summary         text,
  ai_flags           text[] NOT NULL DEFAULT '{}',  -- e.g. escalation_risk, complaint, churn_risk
  ai_graded_at       timestamptz,
  ai_model           text,
  ai_skip_reason     text,                          -- too_short | no_transcript | internal
  raw                jsonb,
  synced_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dialpad_calls_started ON public.dialpad_calls (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_dialpad_calls_agent   ON public.dialpad_calls (agent_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_dialpad_calls_ungraded ON public.dialpad_calls (started_at DESC)
  WHERE ai_graded_at IS NULL AND ai_skip_reason IS NULL AND status = 'answered';

ALTER TABLE public.dialpad_calls ENABLE ROW LEVEL SECURITY;

-- Signed-in staff can read (same predicate as the Support cases table); only the
-- service role (sync + grader) writes — no INSERT/UPDATE policy for users.
DROP POLICY IF EXISTS "staff read dialpad_calls" ON public.dialpad_calls;
CREATE POLICY "staff read dialpad_calls" ON public.dialpad_calls
  FOR SELECT TO authenticated USING (true);

COMMENT ON TABLE public.dialpad_calls IS 'Support Hub Satisfaction tab: Dialpad calls synced by api/dialpad-sync.js; ai_* columns graded from transcripts by the dialpad-grade edge function.';
