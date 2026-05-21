-- ─────────────────────────────────────────────────────────────────────────────
-- staff_task_comments.mentions — uuid[] of profile ids that were @-tagged
-- in the comment body. The client extracts these when it inserts the row;
-- the server uses them to fan out Chat pings via notify-task-assignee
-- (event='comment'). The body text remains the source of truth for display.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.staff_task_comments
  add column if not exists mentions uuid[] not null default '{}';

create index if not exists staff_task_comments_mentions_gin
  on public.staff_task_comments using gin (mentions);
