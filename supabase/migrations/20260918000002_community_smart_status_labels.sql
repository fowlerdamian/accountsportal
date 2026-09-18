-- Smart contact status: "angry" and "waiting" are derived from the timeline
-- rather than typed in by hand. See community_apply_labels() below.
--
--   angry    an unhappy signal (negative call sentiment, CSAT <= 2, a complaint /
--            escalation / churn flag, or a negative inbound email) that no later
--            positive contact has superseded, inside the last 45 days.
--   waiting  the customer is owed something — an inbound email, a call we missed,
--            or a promised callback / unresolved issue — and we have not replied
--            by email or connected call since, inside the last 30 days.
--   cold     everything else.
--
-- A status a person picks by hand sets status_source = 'manual' and is never
-- overwritten. "in-contract" is manual-only; automation never assigns it.
--
-- The full function body is applied in the remote migration of the same name.
alter table public.community_contacts
  add column if not exists status_source text not null default 'auto',
  add column if not exists status_reason text,
  add column if not exists status_set_at timestamptz;
