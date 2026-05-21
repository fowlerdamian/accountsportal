-- ─────────────────────────────────────────────────────────────────────────────
-- staff_tasks.status_notes — short free-text describing why this task is in
-- its current stage. Surfaced in the drawer beside the stage selector so
-- assignees/creators can capture context like "Waiting on supplier reply"
-- or "Blocked pending sign-off from accounts" without writing a full
-- comment thread entry.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.staff_tasks
  add column if not exists status_notes text;
