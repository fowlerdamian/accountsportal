-- Email follow-up check: after a call is flagged (unresolved / callback promised /
-- complaint / low CSAT), the dialpad-followup edge function reads the agent's
-- mailbox via the Google service account and asks Claude whether the issue was
-- resolved by email afterwards.
ALTER TABLE public.dialpad_calls
  ADD COLUMN IF NOT EXISTS followup_status      text,        -- resolved | in_progress | awaiting_customer | no_follow_up | unclear
  ADD COLUMN IF NOT EXISTS followup_note        text,        -- one-line reasoning
  ADD COLUMN IF NOT EXISTS followup_next_action text,        -- what still needs doing, if anything
  ADD COLUMN IF NOT EXISTS followup_evidence    jsonb NOT NULL DEFAULT '[]'::jsonb, -- [{thread_id, subject, date, from, mailbox}]
  ADD COLUMN IF NOT EXISTS followup_mailbox     text,        -- mailbox searched
  ADD COLUMN IF NOT EXISTS followup_checked_at  timestamptz,
  ADD COLUMN IF NOT EXISTS followup_error       text;

CREATE INDEX IF NOT EXISTS idx_dialpad_calls_followup_due ON public.dialpad_calls (started_at DESC)
  WHERE ai_graded_at IS NOT NULL AND (followup_status IS NULL OR followup_status <> 'resolved');

COMMENT ON COLUMN public.dialpad_calls.followup_status IS 'Email follow-up verdict from dialpad-followup: resolved | in_progress | awaiting_customer | no_follow_up | unclear';
