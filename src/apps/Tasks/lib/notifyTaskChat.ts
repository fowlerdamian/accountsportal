// Fire-and-forget Google Chat notifications for the Tasks app.
// Calls a Vercel function (api/notify-task-assignee) — the function looks
// up the recipient's profiles.google_chat_webhook_url and posts to it.
// Never throws — silently logs errors so it never blocks the main action.
//
// Auth: the user's Supabase access_token is attached as Authorization so
// the public Vercel endpoint can verify the caller is a real signed-in
// staff member, not a random script hitting the URL.

import { supabase } from "@guide/integrations/supabase/client";

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
  /** Body of the comment, used when event === 'comment'. */
  comment_body?: string;
}

export async function notifyTaskAssignee(args: NotifyArgs): Promise<void> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) return; // not signed in — bail silently
    await fetch("/api/notify-task-assignee", {
      method:  "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization:  `Bearer ${token}`,
      },
      body: JSON.stringify(args),
    });
  } catch (err) {
    console.warn("[tasks-notify]", err);
  }
}
