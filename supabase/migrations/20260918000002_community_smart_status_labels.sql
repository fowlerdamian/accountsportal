-- Smart contact status: "angry" and "waiting" are derived from the timeline
-- rather than typed in by hand.
--
--   angry    an unhappy signal (negative call sentiment, CSAT <= 2, a complaint /
--            escalation / churn flag, or a negative inbound email) that no later
--            positive contact has superseded, inside the last 45 days.
--   waiting  the customer is owed something - an inbound email, a call we missed,
--            or a promised callback / unresolved issue - and we have not replied
--            by email or connected call since, inside the last 30 days.
--   cold     everything else.
--
-- A status a person picks by hand sets status_source = 'manual' and is never
-- overwritten. "in-contract" is manual-only; automation never assigns it.

alter table public.community_contacts
  add column if not exists status_source text not null default 'auto',
  add column if not exists status_reason text,
  add column if not exists status_set_at timestamptz;

comment on column public.community_contacts.status_source is
  'auto = maintained by community_apply_labels(); manual = a person chose it and automation leaves it alone.';
comment on column public.community_contacts.status_reason is
  'Plain-English justification for an auto status, shown in the UI.';

create or replace function public.community_apply_labels(p_contact uuid default null)
returns integer
language plpgsql security definer set search_path = public as $$
declare changed integer;
begin
  with sig as (
    select c.id,
      -- the customer is owed something
      (select max(n.date) from community_notes n
        where n.contact_id = c.id
          and n.kind = 'email' and n.meta->>'direction' = 'inbound')            as in_email,
      (select max(n.date) from community_notes n
        where n.contact_id = c.id and n.kind = 'call'
          and n.meta->>'direction' = 'inbound'
          and coalesce(n.meta->>'status', '') <> 'answered')                    as missed_call,
      (select max(n.date) from community_notes n
        where n.contact_id = c.id and n.kind = 'call'
          and coalesce(n.meta->>'followup_status', '') <> 'resolved'
          and ( jsonb_exists(coalesce(n.meta->'flags', '[]'::jsonb), 'callback_promised')
             or jsonb_exists(coalesce(n.meta->'flags', '[]'::jsonb), 'unresolved')
             or n.meta->>'resolved' = 'false' ))                                as open_promise,
      -- we got back to them: an email we sent, or a call that connected
      (select max(n.date) from community_notes n
        where n.contact_id = c.id
          and ( (n.kind = 'email' and n.meta->>'direction' = 'outbound')
             or (n.kind = 'call'  and n.meta->>'status'    = 'answered') ))     as replied,
      -- unhappiness, from call grading or a negative inbound email
      (select max(n.date) from community_notes n
        where n.contact_id = c.id
          and coalesce(n.meta->>'followup_status', '') <> 'resolved'
          and ( (n.kind = 'call' and (
                   n.meta->>'sentiment' = 'negative'
                or (n.meta->>'csat' ~ '^[0-9]+$' and (n.meta->>'csat')::int <= 2)
                or jsonb_exists_any(coalesce(n.meta->'flags', '[]'::jsonb),
                                    array['complaint','escalation_risk','churn_risk'])))
             or (n.kind = 'email' and n.meta->>'direction' = 'inbound'
                 and n.meta->>'sentiment' = 'negative') ))                      as upset,
      -- things going well again
      (select max(n.date) from community_notes n
        where n.contact_id = c.id
          and ( (n.kind = 'call' and (
                   n.meta->>'sentiment' = 'positive'
                or (n.meta->>'csat' ~ '^[0-9]+$' and (n.meta->>'csat')::int >= 4)))
             or (n.kind = 'email' and n.meta->>'direction' = 'inbound'
                 and n.meta->>'sentiment' = 'positive') ))                      as happy
    from community_contacts c
    where p_contact is null or c.id = p_contact
  ),
  owed as (
    select s.*, greatest(s.in_email, s.missed_call, s.open_promise) as owed_at from sig s
  ),
  verdict as (
    select o.*,
      case
        when o.upset is not null and o.upset > now() - interval '45 days'
             and (o.happy is null or o.happy < o.upset)                      then 'angry'
        when o.owed_at is not null and o.owed_at > now() - interval '30 days'
             and (o.replied is null or o.replied <= o.owed_at)               then 'waiting'
        else 'cold'
      end as new_status
    from owed o
  ),
  final as (
    select v.*,
      case v.new_status
        when 'angry' then
          'Unhappy on ' || to_char(v.upset at time zone 'Australia/Brisbane', 'DD Mon')
          || case when v.replied is null or v.replied <= v.upset
                  then ' - no reply since' else ' - replied, but nothing positive since' end
        when 'waiting' then
          'Owed a reply since ' || to_char(v.owed_at at time zone 'Australia/Brisbane', 'DD Mon')
          || case when v.replied is null then ' - never replied to'
                  else ' - last contact ' || to_char(v.replied at time zone 'Australia/Brisbane', 'DD Mon') end
        else null
      end as new_reason
    from verdict v
  )
  update community_contacts c
     set status        = f.new_status,
         status_reason = f.new_reason,
         status_set_at = now()
    from final f
   where c.id = f.id
     and c.status_source = 'auto'
     and (c.status is distinct from f.new_status or c.status_reason is distinct from f.new_reason);
  get diagnostics changed = row_count;
  return changed;
end $$;

comment on function public.community_apply_labels(uuid) is
  'Recomputes angry/waiting/cold for auto-managed contacts from their call and email timeline. Returns the number of contacts changed.';

grant execute on function public.community_apply_labels(uuid) to authenticated;
