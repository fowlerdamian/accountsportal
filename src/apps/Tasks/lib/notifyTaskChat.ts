// Fire-and-forget Google Chat notifications for the Tasks app.
// Calls a Vercel function (api/notify-task-assignee) — the function looks
// up the recipient's profiles.google_chat_webhook_url and posts to it.
// Never throws — silently logs errors so it never blocks the main action.

export type TaskNotifyEvent =
  | "assigned"
  | "dependency_assigned"
  | "blocker_done"
  | "comment";

interface NotifyArgs {
  task_id:      string;
  recipient_id: string;
  event:        TaskNotifyEvent;
  // Optional extras included in the card body.
  task_title?:  string;
  actor_name?:  string;
}

export function notifyTaskAssignee(args: NotifyArgs): void {
  fetch("/api/notify-task-assignee", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(args),
  }).catch((err) => console.warn("[tasks-notify]", err));
}
