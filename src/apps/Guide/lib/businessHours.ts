// Business hours for guide support: 8:00–17:00, Monday–Friday, Brisbane time
// (AEST, no daylight saving). Used by the customer help sheet to set the right
// expectation about when a reply will come.

export const SUPPORT_TZ = "Australia/Brisbane";
export const OPEN_HOUR = 8;
export const CLOSE_HOUR = 17;

interface LocalParts { weekday: number; hour: number; minute: number }

/** Weekday (0 = Sunday), hour and minute of `now` in the support time zone. */
function localParts(now: Date): LocalParts {
  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone: SUPPORT_TZ, weekday: "short", hour: "numeric", minute: "numeric", hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday").slice(0, 3));
  return { weekday, hour: Number(get("hour")) % 24, minute: Number(get("minute")) };
}

export function isBusinessHours(now: Date = new Date()): boolean {
  const { weekday, hour } = localParts(now);
  return weekday >= 1 && weekday <= 5 && hour >= OPEN_HOUR && hour < CLOSE_HOUR;
}

/**
 * Human label for the next opening time, e.g. "8am tomorrow", "8am Monday",
 * or "8am this morning" (before opening on a business day). Null when open.
 */
export function nextOpenLabel(now: Date = new Date()): string | null {
  if (isBusinessHours(now)) return null;
  const { weekday, hour } = localParts(now);
  const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  if (weekday >= 1 && weekday <= 5 && hour < OPEN_HOUR) return `${OPEN_HOUR}am this morning`;
  // After close (or weekend): find the next weekday.
  let d = weekday;
  let daysAhead = 0;
  do { d = (d + 1) % 7; daysAhead++; } while (d === 0 || d === 6);
  return daysAhead === 1 ? `${OPEN_HOUR}am tomorrow` : `${OPEN_HOUR}am ${names[d]}`;
}

/** Short "Mon–Fri, 8am–5pm AEST" string for copy. */
export const HOURS_LABEL = `Mon–Fri, ${OPEN_HOUR}am–${CLOSE_HOUR - 12}pm AEST`;
