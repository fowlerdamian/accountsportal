// Vercel cron route — fires sales-research-run at 13:00 UTC (midnight AEDT) on weekdays
export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).end();
  }

  const supabaseUrl      = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
  const serviceRoleKey   = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

  if (!supabaseUrl || !serviceRoleKey) {
    console.error("[cron/research] Missing Supabase env vars");
    return res.status(500).json({ error: "Missing env vars" });
  }

  // Fire-and-forget — return 200 immediately so Vercel doesn't time out
  fetch(`${supabaseUrl}/functions/v1/sales-research-run`, {
    method:  "POST",
    headers: {
      "Authorization": `Bearer ${serviceRoleKey}`,
      "Content-Type":  "application/json",
    },
    body: JSON.stringify({}),
  }).catch((err) => console.error("[cron/research] invoke error:", err));

  res.status(200).json({ ok: true, triggered: "sales-research-run", at: new Date().toISOString() });
}
