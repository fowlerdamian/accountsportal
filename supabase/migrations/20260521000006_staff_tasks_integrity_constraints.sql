-- ─────────────────────────────────────────────────────────────────────────────
-- Data-integrity guards uncovered by the post-launch audit:
--   1. A task cannot block or parent itself (would loop the trigger /
--      orphan-cleanup logic).
--   2. Comment mentions array is capped at 50 — prevents a single comment
--      from fanning out a huge burst of Google Chat pings.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.staff_tasks
  drop constraint if exists staff_tasks_no_self_block,
  add  constraint staff_tasks_no_self_block check (id <> blocked_by_task_id);

alter table public.staff_tasks
  drop constraint if exists staff_tasks_no_self_parent,
  add  constraint staff_tasks_no_self_parent check (id <> parent_task_id);

alter table public.staff_task_comments
  drop constraint if exists staff_task_comments_mentions_capped,
  add  constraint staff_task_comments_mentions_capped check (coalesce(array_length(mentions, 1), 0) <= 50);
