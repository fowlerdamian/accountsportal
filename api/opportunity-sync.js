// Vercel cron route — fires the opportunity-sync HubSpot pull hourly.
// Same fire-and-forget pattern as api/sales-sync-list.js.
export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).end();
  }

  const supabaseUrl    = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

  if (!supabaseUrl || !serviceRoleKey) {
    console.error("[cron/opportunity-sync] Missing Supabase env vars");
    return res.status(500).json({ error: "Missing env vars" });
  }

  fetch(`${supabaseUrl}/functions/v1/opportunity-sync`, {
    method:  "POST",
    headers: {
      "Authorization": `Bearer ${serviceRoleKey}`,
      "Content-Type":  "application/json",
    },
    body: JSON.stringify({ action: "pull" }),
  }).catch((err) => console.error("[cron/opportunity-sync] invoke error:", err));

  res.status(200).json({ ok: true, triggered: "opportunity-sync", at: new Date().toISOString() });
}
