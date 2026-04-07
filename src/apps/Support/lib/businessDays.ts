const PUBLIC_HOLIDAYS: string[] = [
  // 2025 Australian public holidays
  '2025-01-01', '2025-01-27', '2025-04-18', '2025-04-19',
  '2025-04-21', '2025-04-25', '2025-06-09', '2025-12-25', '2025-12-26',
  // 2026
  '2026-01-01', '2026-01-26', '2026-04-03', '2026-04-04',
  '2026-04-06', '2026-04-25', '2026-06-08', '2026-12-25', '2026-12-28',
];

const holidaySet = new Set(PUBLIC_HOLIDAYS);

function isBusinessDay(date: Date): boolean {
  const day = date.getDay();
  if (day === 0 || day === 6) return false;
  const iso = date.toISOString().slice(0, 10);
  return !holidaySet.has(iso);
}

export function calculateBusinessDaysOpen(createdAt: Date): number {
  const now = new Date();
  const start = new Date(createdAt);
  start.setHours(0, 0, 0, 0);

  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  let count = 0;
  const current = new Date(start);
  current.setDate(current.getDate() + 1); // skip creation day

  while (current < today) {
    if (isBusinessDay(current)) count++;
    current.setDate(current.getDate() + 1);
  }

  return count;
}
