/**
 * Fire-and-forget Google Chat notifications for the Contractor Hub.
 * Never throws — silently logs errors so it never blocks the main action.
 */

const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY) as string;

async function post(payload: Record<string, unknown>): Promise<void> {
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/contractor-hub-notifications`, {
      method:  "POST",
      headers: {
        "Content-Type": "application/json",
        apikey:         SUPABASE_ANON,
        Authorization:  `Bearer ${SUPABASE_ANON}`,
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.warn("[hub-notify]", err);
  }
}

export function notifyTaskStatusChanged(opts: {
  task_title:   string;
  status:       string;
  author:       string;
  project_name: string;
  project_id:   string;
}): void {
  post({ type: "task_status_changed", ...opts });
}

export function notifyActivityPosted(opts: {
  author:       string;
  project_name: string;
  project_id:   string;
  content:      string;
}): void {
  post({ type: "activity_posted", ...opts });
}

export function notifyBudgetThreshold(opts: {
  project_name: string;
  project_id:   string;
  pct:          number;
}): void {
  post({ type: "budget_threshold", ...opts });
}

export function notifyUpworkMessage(opts: {
  contractor_name: string;
  project_name:    string;
  project_id:      string;
  content:         string;
}): void {
  post({ type: "upwork_message", ...opts });
}
