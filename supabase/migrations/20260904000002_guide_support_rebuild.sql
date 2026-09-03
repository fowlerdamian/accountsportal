-- Guide support rebuild (2026-09-04).
--
-- Before: a customer question was inserted and nothing else happened — no staff
-- notification, no contact details, and the "answer" staff typed was stored but
-- never delivered. After: the customer can leave a name/email/phone, staff are
-- pinged in Google Chat with a deep link, an answer can be emailed back via
-- Resend (guide-support edge fn), and the row carries a real lifecycle
-- (answered_at / reply_sent_at / resolved_at) for the Support page.

alter table public.support_questions
  add column if not exists customer_name   text,
  add column if not exists customer_email  text,
  add column if not exists customer_phone  text,
  add column if not exists step_title      text,
  add column if not exists answered_at     timestamptz,
  add column if not exists answered_by     uuid references auth.users(id) on delete set null,
  add column if not exists reply_sent_at   timestamptz,
  add column if not exists reply_resend_id text,
  add column if not exists resolved_at     timestamptz,
  add column if not exists ai_draft        text,
  add column if not exists notified_at     timestamptz,
  add column if not exists updated_at      timestamptz not null default now();

create index if not exists support_questions_open_idx
  on public.support_questions (resolved, created_at desc);

-- Lifecycle timestamps maintained in the DB so every writer agrees.
create or replace function public.support_questions_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if new.resolved and not coalesce(old.resolved, false) then new.resolved_at := coalesce(new.resolved_at, now()); end if;
  if not new.resolved then new.resolved_at := null; end if;
  if new.answer is not null and (old.answer is distinct from new.answer) then new.answered_at := coalesce(new.answered_at, now()); end if;
  return new;
end $$;

drop trigger if exists support_questions_touch on public.support_questions;
create trigger support_questions_touch
  before update on public.support_questions
  for each row execute function public.support_questions_touch();

-- Anonymous customers may create a question with optional contact details;
-- they can never pre-set staff-side fields.
drop policy if exists "public insert support questions" on public.support_questions;
create policy "public insert support questions" on public.support_questions
  for insert to anon
  with check (
    resolved = false and escalated = false and answer is null
    and answered_at is null and answered_by is null and reply_sent_at is null and ai_draft is null
    and length(question) between 1 and 2000
    and length(coalesce(customer_name, ''))  <= 120
    and length(coalesce(customer_email, '')) <= 200
    and length(coalesce(customer_phone, '')) <= 40
    and length(coalesce(step_title, ''))     <= 200
    and exists (select 1 from public.guide_publications p
                where p.instruction_set_id = support_questions.instruction_set_id and p.status = 'published')
  );

comment on column public.support_questions.customer_email is 'Optional — when present the guide-support fn can email the answer back';
comment on column public.support_questions.step_title is 'Snapshot of the step heading the customer was on when they asked';
comment on column public.support_questions.notified_at is 'When the Google Chat ping for this question went out';
