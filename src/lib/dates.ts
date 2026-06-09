/**
 * Local-date helpers.
 *
 * `new Date().toISOString().split("T")[0]` returns the UTC calendar date —
 * in Australia (UTC+10/+11) that is YESTERDAY until 10–11am, which put call
 * lists, time entries, due dates and overdue checks on the wrong day.
 * Always use these helpers for "today" / date-only strings.
 */

/** Today's date in the user's LOCAL timezone as YYYY-MM-DD. */
export function localToday(): string {
  return localDateString(new Date());
}

/** A Date's LOCAL calendar date as YYYY-MM-DD (no UTC conversion). */
export function localDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
