// site-monitor — hourly content-integrity check for fleetcraft.com.au.
//
// Fetches each page uncached, counts structural markers in the HTML and emails an
// alert (Resend) when a page loses its content. Built after 2026-08-31, when the
// homepage's inner blocks were wiped by a lossy content write-back and nobody
// noticed for two days. Alert dedup + history live in public.site_monitor_state.
//
// Invoke (POST JSON, or GET ?action=…):
//   { action: "run" }                       default — check every page, alert on change
//   { action: "run", force_alert: true }    alert even if already alerted
//   { action: "status" }                    current state rows
//   { action: "test" }                      send a test email to confirm delivery
//
// pg_cron: site-monitor-hourly  20 * * * *  (created directly, see migration header)
// Env: RESEND_API_KEY (shared), SITE_MONITOR_TO (optional, default damianf@…)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Marker = { name: string; pattern: string; min?: number; max?: number };
type Check = { key: string; label: string; url: string; minBytes: number; markers: Marker[]; recovery: string };

const WP_REVISIONS = "https://fleetcraft.com.au/wp-admin/revision.php?revision=3219";
const HOME_RECOVERY =
  `Restore the last good revision: wp-admin > Pages > Home > Revisions (known-good 27 Aug 2026: ${WP_REVISIONS}), ` +
  `click "Restore This Revision", then leave the editor WITHOUT saving. Never rewrite post_content from a prose/reconstructed read.`;
const PAGE_RECOVERY =
  "Restore the page's last good revision from wp-admin > Pages > (page) > Revisions, then leave the editor without saving.";

const CHECKS: Check[] = [
  {
    key: "fleetcraft-home", label: "fleetcraft.com.au homepage", url: "https://fleetcraft.com.au/", minBytes: 40_000,
    markers: [
      { name: "featured product cards", pattern: 'class="showcase-item showcase-item--featured', min: 4 },
      { name: "product info panels", pattern: 'class="console-info"', min: 4 },
      { name: "empty showcase grid", pattern: '<div class="showcase-grid"></div>', max: 0 },
      { name: "industry cards", pattern: "wp-block-fleetcraft-industry-card", min: 5 },
      { name: "bento cards", pattern: "wp-block-fleetcraft-bento-card", min: 4 },
      { name: "process steps", pattern: "wp-block-fleetcraft-process-step", min: 4 },
      { name: "hero badge", pattern: "Australian Engineered", min: 1 },
    ],
    recovery: HOME_RECOVERY,
  },
  {
    key: "fleetcraft-emergency", label: "fleetcraft.com.au /emergency-services/", url: "https://fleetcraft.com.au/emergency-services/", minBytes: 40_000,
    markers: [
      { name: "hero image", pattern: "hero-bg-media", min: 1 },
      { name: "capability cards", pattern: "services-grid-card", min: 6 },
      { name: "vehicle program cards", pattern: "industry-card-content", min: 5 },
    ],
    recovery: PAGE_RECOVERY,
  },
  {
    key: "fleetcraft-utilities", label: "fleetcraft.com.au /utilities-telco/", url: "https://fleetcraft.com.au/utilities-telco/", minBytes: 40_000,
    markers: [
      { name: "hero image", pattern: "hero-bg-media", min: 1 },
      { name: "capability cards", pattern: "services-grid-card", min: 5 },
      { name: "vehicle program cards", pattern: "industry-card-content", min: 5 },
    ],
    recovery: PAGE_RECOVERY,
  },
];

const REALERT_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TO = "damianf@automotivegroup.com.au";
const FROM = "FleetCraft Site Monitor <alerts@updates.automotivegroup.com.au>";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

function count(haystack: string, needle: string): number {
  let n = 0, i = 0;
  while ((i = haystack.indexOf(needle, i)) !== -1) { n++; i += needle.length; }
  return n;
}

type Result = { ok: boolean; transient: boolean; problems: string[]; counts: Record<string, number>; http_status?: number; bytes?: number };

async function runCheck(c: Check): Promise<Result> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 25_000);
  try {
    const res = await fetch(`${c.url}?nc=${Date.now()}`, {
      signal: ctrl.signal,
      headers: { "Cache-Control": "no-cache", Pragma: "no-cache", "User-Agent": "AGA-SiteMonitor/1.0 (+https://app.automotivegroup.com.au)" },
    });
    const html = await res.text();
    const counts: Record<string, number> = {};
    for (const m of c.markers) counts[m.name] = count(html, m.pattern);
    if (!res.ok) {
      return { ok: false, transient: res.status >= 500 || res.status === 429, problems: [`HTTP ${res.status}`], counts, http_status: res.status, bytes: html.length };
    }
    const problems: string[] = [];
    if (html.length < c.minBytes) problems.push(`page is only ${html.length} bytes (expected at least ${c.minBytes})`);
    for (const m of c.markers) {
      const n = counts[m.name];
      if (m.min !== undefined && n < m.min) problems.push(`${m.name}: found ${n}, expected at least ${m.min}`);
      if (m.max !== undefined && n > m.max) problems.push(`${m.name}: found ${n}, expected at most ${m.max}`);
    }
    return { ok: problems.length === 0, transient: false, problems, counts, http_status: res.status, bytes: html.length };
  } catch (e) {
    return { ok: false, transient: true, problems: [`fetch failed: ${(e as Error).message}`], counts: {} };
  } finally {
    clearTimeout(t);
  }
}

async function sendEmail(subject: string, html: string, text: string) {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) throw new Error("RESEND_API_KEY not configured");
  const to = (Deno.env.get("SITE_MONITOR_TO") ?? DEFAULT_TO).split(",").map((s) => s.trim()).filter(Boolean);
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to, subject, html, text }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Resend ${res.status}: ${JSON.stringify(out)}`);
  return out?.id as string | undefined;
}

const esc = (s: string) => s.replace(/[&<>]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[ch]!));
const aest = () => new Date().toLocaleString("en-AU", { timeZone: "Australia/Sydney", dateStyle: "medium", timeStyle: "short" });

function alertMessage(c: Check, r: Result, kind: "problem" | "recovered") {
  const when = aest();
  if (kind === "recovered") {
    const subject = `[Site monitor] RECOVERED - ${c.label}`;
    const text = `${c.label} is rendering correctly again as of ${when} AEST.\n${c.url}`;
    return { subject, text, html: `<p><strong>${esc(c.label)}</strong> is rendering correctly again as of ${when} AEST.</p><p><a href="${c.url}">${c.url}</a></p>` };
  }
  const subject = `[Site monitor] ${c.label}: ${r.problems.length} problem${r.problems.length === 1 ? "" : "s"}`;
  const countLines = Object.entries(r.counts).map(([k, v]) => `${k}: ${v}`).join("\n");
  const text = [
    `${c.label} failed its content check at ${when} AEST.`, "", "Problems:", ...r.problems.map((p) => ` - ${p}`), "",
    "Marker counts:", countLines, "", "Recovery:", c.recovery, "", c.url,
  ].join("\n");
  const html = `
    <p><strong>${esc(c.label)}</strong> failed its content check at ${when} AEST.</p>
    <p><strong>Problems</strong></p><ul>${r.problems.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>
    <p><strong>Marker counts</strong></p>
    <table cellpadding="4" style="border-collapse:collapse;font-size:13px">${Object.entries(r.counts).map(([k, v]) => `<tr><td style="border:1px solid #ddd">${esc(k)}</td><td style="border:1px solid #ddd">${v}</td></tr>`).join("")}</table>
    <p><strong>Recovery</strong><br>${esc(c.recovery).replace(/(https?:\/\/[^\s),]+)/g, '<a href="$1">$1</a>')}</p>
    <p><a href="${c.url}">${c.url}</a></p>`;
  return { subject, text, html };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const url = new URL(req.url);
  let body: Record<string, unknown> = {};
  if (req.method === "POST") { try { body = await req.json(); } catch { /* empty body */ } }
  const action = String(body.action ?? url.searchParams.get("action") ?? "run");
  const force = body.force_alert === true || url.searchParams.get("force_alert") === "1";

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  if (action === "status") {
    const { data, error } = await db.from("site_monitor_state").select("*").order("check_key");
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, checks: data });
  }

  if (action === "test") {
    const id = await sendEmail("[Site monitor] Test alert", `<p>Site monitor test at ${aest()} AEST. Delivery works.</p>`, `Site monitor test at ${aest()} AEST. Delivery works.`);
    return json({ ok: true, resend_id: id });
  }

  const now = new Date();
  const summary: Record<string, unknown>[] = [];

  for (const c of CHECKS) {
    const r = await runCheck(c);
    const { data: prev } = await db.from("site_monitor_state").select("*").eq("check_key", c.key).maybeSingle();
    const prevStatus: string = prev?.status ?? "unknown";
    const failures = r.ok ? 0 : (prev?.consecutive_failures ?? 0) + 1;
    // Transient errors (timeouts, 5xx) need two strikes; content failures are deterministic.
    const confirmedFail = !r.ok && (!r.transient || failures >= 2);
    const status = r.ok ? "ok" : confirmedFail ? "fail" : prevStatus;

    let alerted: string | null = null;
    try {
      if (r.ok && prevStatus === "fail") {
        const m = alertMessage(c, r, "recovered");
        await sendEmail(m.subject, m.html, m.text);
        alerted = "recovered";
      } else if (confirmedFail) {
        const lastAlert = prev?.last_alert_at ? new Date(prev.last_alert_at).getTime() : 0;
        const due = prevStatus !== "fail" || now.getTime() - lastAlert > REALERT_MS;
        if (force || due) {
          const m = alertMessage(c, r, "problem");
          await sendEmail(m.subject, m.html, m.text);
          alerted = "problem";
        }
      }
    } catch (e) {
      console.error(`alert failed for ${c.key}:`, (e as Error).message);
      r.problems.push(`alert email failed: ${(e as Error).message}`);
    }

    const row = {
      check_key: c.key, label: c.label, status, consecutive_failures: failures,
      last_checked_at: now.toISOString(),
      last_ok_at: r.ok ? now.toISOString() : prev?.last_ok_at ?? null,
      last_fail_at: r.ok ? prev?.last_fail_at ?? null : now.toISOString(),
      last_alert_at: alerted ? now.toISOString() : prev?.last_alert_at ?? null,
      last_error: r.ok ? null : r.problems.join("; "),
      detail: { counts: r.counts, http_status: r.http_status ?? null, bytes: r.bytes ?? null, transient: r.transient },
    };
    const { error } = await db.from("site_monitor_state").upsert(row, { onConflict: "check_key" });
    if (error) console.error("state upsert failed:", error.message);

    summary.push({ key: c.key, ok: r.ok, status, problems: r.problems, counts: r.counts, alerted });
  }

  return json({ ok: summary.every((s) => s.ok), checked_at: now.toISOString(), results: summary });
});
