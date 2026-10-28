// Vercel cron route for the Sales nightly jobs (one function so the project stays
// within the Hobby plan's 12-function limit). The old paths still work via
// rewrites in vercel.json: /api/sales-sync-cin7 → ?job=cin7, -research, -list.
//   cin7     → sales-cin7-sync     12:00 UTC (11pm AEDT) weekdays
//   research → sales-research-run  13:00 UTC (midnight AEDT) weekdays
//   list     → sales-list-run      14:00 UTC (1am AEDT) weekdays
const JOBS = { cin7: "sales-cin7-sync", research: "sales-research-run", list: "sales-list-run" };

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).end();
  }
  const job = String(req.query?.job ?? "");
  const fn = JOBS[job];
  if (!fn) return res.status(400).json({ error: `unknown job "${job}"` });

  const supabaseUrl    = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

  if (!supabaseUrl || !serviceRoleKey) {
    console.error(`[cron/${job}] Missing Supabase env vars`);
    return res.status(500).json({ error: "Missing env vars" });
  }

  // Fire-and-forget — return 200 immediately so Vercel doesn't time out
  fetch(`${supabaseUrl}/functions/v1/${fn}`, {
    method:  "POST",
    headers: {
      "Authorization": `Bearer ${serviceRoleKey}`,
      "Content-Type":  "application/json",
    },
    body: JSON.stringify({}),
  }).catch((err) => console.error(`[cron/${job}] invoke error:`, err));

  res.status(200).json({ ok: true, triggered: fn, at: new Date().toISOString() });
}
