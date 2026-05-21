-- ─────────────────────────────────────────────────────────────────────────────
-- staff_tasks.ai_summary — short AI-generated label that fits the bottom dock
-- pill width (~22 chars) so titles never need to be ellipsis-truncated mid-word.
-- Populated fire-and-forget by the generate-task-summary edge function from
-- the client after task insert / update of title / description.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.staff_tasks
  add column if not exists ai_summary text;
