/**
 * /labels/station — the print station for DYMO guide labels.
 *
 * Runs in Chrome on the office host PC next to the LabelWriter 550, launched
 * with --kiosk-printing (tools/label-station.cmd) so print() goes straight to
 * the Windows default printer with no dialog. Jobs land in label_print_jobs
 * when an order's pick is authorised in Cin7 (shipstation-webhook poll-orders,
 * every minute → guide-delivery queue-labels, source "picked") and
 * from the Guide portal Print buttons (queueLabelPrint, source "manual").
 *
 * No confirm dialog (removed 2026-11-17 at Damian's request): queued jobs
 * print automatically, oldest first, one at a time through the hidden-iframe
 * pipeline (printLabels → /labels/print). Only jobs younger than
 * AUTO_PRINT_MS auto-print, so a backlog that built up while the station was
 * closed is listed with a Print button instead of all printing at once.
 * Realtime is the wake-up; a 60s poll is the backup. Failed prints retry up
 * to MAX_ATTEMPTS then wait for a manual Reprint.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@portal/lib/supabase";
import { useAuth } from "@portal/context/AuthContext.jsx";
import { printBarcodeLabel, printLabels } from "@portal/lib/labels/printLabels";
import type { BarcodeLabelInput } from "@portal/lib/labels/barcodeLabelPdf";

interface Job {
  id: string;
  created_at: string;
  source: string;
  order_number: string | null;
  shipstation_shipment_id: string | null;
  customer_name: string | null;
  ship_to: string | null;
  sku: string | null;
  kind: "guide" | "barcode";
  guide_id: string | null;
  payload: BarcodeLabelInput | null;
  brand_key: string | null;
  copies: number;
  status: "queued" | "printing" | "printed" | "failed" | "cancelled";
  attempts: number;
  error: string | null;
  printed_at: string | null;
  station: string | null;
  instruction_sets?: { title: string; product_code: string | null } | null;
}

const STATION_KEY = "label-station:name";
const POLL_MS = 60_000;
const MAX_ATTEMPTS = 3;
const HISTORY = 100;
/** Queued jobs older than this are a backlog: listed with a Print button, not auto-printed. */
export const AUTO_PRINT_MS = 15 * 60_000;
/**
 * A "printing" job claimed longer ago than this is from a station that stopped
 * mid-print. Longer than printLabelRoute can take (15s render + 5 min dialog
 * timeout), so a print that is still running is never handed out twice.
 */
const STUCK_MS = 6 * 60_000;
const SELECT = "*, instruction_sets(title, product_code)";
/** How often the station checks whether a newer build has been deployed. */
const VERSION_POLL_MS = 2 * 60_000;
/** The hashed entry bundle named in an index.html — changes on every deploy. */
const entryScript = (html: string) => html.match(/\/assets\/index-[\w-]+\.js/)?.[0] ?? null;

/**
 * Short id for this window, kept across reloads. Stamped on every claim so two
 * station windows open at once (one of them hidden and stalling) show up in
 * label_print_jobs.station instead of looking like one flaky station.
 */
const INSTANCE = (() => {
  try {
    let id = sessionStorage.getItem("label-station:instance");
    if (!id) { id = Math.random().toString(36).slice(2, 6); sessionStorage.setItem("label-station:instance", id); }
    return id;
  } catch { return Math.random().toString(36).slice(2, 6); }
})();
/** After a failed print this window leaves the queue alone this long, so another open station can take the retry. */
const BACKOFF_MS = 45_000;

const readLs = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const writeLs = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private window */ } };

const fmtTime = (iso: string | null) => iso ? new Date(iso).toLocaleString("en-AU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
const guideName = (j: Job) => j.kind === "barcode"
  ? `Barcode: ${[j.payload?.title, j.payload?.subtitle].filter(Boolean).join(" ") || j.payload?.barcode || "label"}`
  : j.instruction_sets?.title ?? j.guide_id ?? "—";
const isStale = (j: Job) => j.status === "queued" && Date.now() - new Date(j.created_at).getTime() > AUTO_PRINT_MS;

const STATUS_CLASS: Record<Job["status"], string> = {
  queued: "bg-amber-500/15 text-amber-500",
  printing: "bg-sky-500/15 text-sky-500",
  printed: "bg-emerald-500/15 text-emerald-500",
  failed: "bg-red-500/15 text-red-500",
  cancelled: "bg-muted text-muted-foreground",
};

export default function LabelStation() {
  const { user } = useAuth() as { user: { id: string; email?: string } | null };
  const [jobs, setJobs] = useState<Job[]>([]);
  const [station, setStation] = useState(() => readLs(STATION_KEY) || "Office LabelWriter");
  const [printing, setPrinting] = useState<Job | null>(null);
  const [live, setLive] = useState(false);
  const [testing, setTesting] = useState(false);
  const draining = useRef(false);
  const again = useRef(false);
  /** Serialises every print so two hidden iframes never print at once. */
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const stationRef = useRef(station);
  const backoffUntil = useRef(0);
  const backoffTimer = useRef(0);
  const drainRef = useRef<() => void>(() => undefined);

  useEffect(() => { stationRef.current = station; writeLs(STATION_KEY, station); }, [station]);

  const load = useCallback(async () => {
    const { data } = await supabase.from("label_print_jobs").select(SELECT).order("created_at", { ascending: false }).limit(HISTORY);
    if (data) setJobs(data as Job[]);
  }, []);

  const exclusive = useCallback(<T,>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.current.then(fn, fn);
    chain.current = next.catch(() => undefined);
    return next;
  }, []);

  /** Resolves false when the job couldn't be claimed (another station has it, or the update failed). */
  const printJob = useCallback(async (job: Job): Promise<boolean> => {
    // Claim atomically so a second open station can't print the same job.
    const { data: claimed } = await supabase
      .from("label_print_jobs")
      .update({ status: "printing", station: `${stationRef.current} #${INSTANCE}`, claimed_at: new Date().toISOString(), attempts: job.attempts + 1, decided_by: user?.id ?? null, decided_at: new Date().toISOString() })
      .eq("id", job.id)
      .eq("status", "queued")
      .select("id")
      .maybeSingle();
    if (!claimed) return false;
    setPrinting(job);
    try {
      if (job.kind === "barcode") {
        if (!job.payload) throw new Error("Barcode job has no label data");
        await printBarcodeLabel(job.payload, { copies: job.copies });
      } else {
        if (!job.guide_id) throw new Error("Guide job has no guide");
        await printLabels({ ids: [job.guide_id], brand: job.brand_key, copies: job.copies });
      }
      await supabase.from("label_print_jobs")
        .update({ status: "printed", printed_at: new Date().toISOString(), printed_by: user?.id ?? null })
        .eq("id", job.id);
    } catch (e: any) {
      const retry = job.attempts + 1 < MAX_ATTEMPTS;
      backoffUntil.current = Date.now() + BACKOFF_MS;
      await supabase.from("label_print_jobs")
        .update({ status: retry ? "queued" : "failed", error: `${e?.message ?? String(e)} [#${INSTANCE}, try ${job.attempts + 1}]` })
        .eq("id", job.id);
    } finally {
      setPrinting(null);
    }
    return true;
  }, [user?.id]);

  // A job left in "printing" (station tab closed or reloaded mid-print) would
  // otherwise never print again: hand it back to the queue, or fail it once
  // it has used up its attempts.
  const recoverStuck = useCallback(async () => {
    const cutoff = new Date(Date.now() - STUCK_MS).toISOString();
    await supabase.from("label_print_jobs")
      .update({ status: "failed", error: "Print station stopped mid-print" })
      .eq("status", "printing").lt("claimed_at", cutoff).gte("attempts", MAX_ATTEMPTS);
    await supabase.from("label_print_jobs")
      .update({ status: "queued", error: "Print station stopped mid-print — retrying" })
      .eq("status", "printing").lt("claimed_at", cutoff).lt("attempts", MAX_ATTEMPTS);
  }, []);

  // Print every recent queued job, oldest first, until none are left.
  const drain = useCallback(async () => {
    if (draining.current) { again.current = true; return; }
    const wait = backoffUntil.current - Date.now();
    if (wait > 0) {
      // Come back by itself once the back-off is over rather than waiting for the next poll.
      if (!backoffTimer.current) backoffTimer.current = window.setTimeout(() => { backoffTimer.current = 0; drainRef.current(); }, wait + 250);
      return;
    }
    draining.current = true;
    try {
      await recoverStuck();
      do {
        again.current = false;
        for (;;) {
          const since = new Date(Date.now() - AUTO_PRINT_MS).toISOString();
          const { data } = await supabase.from("label_print_jobs").select(SELECT)
            .eq("status", "queued").gte("created_at", since).order("created_at").limit(1);
          const job = (data?.[0] ?? null) as Job | null;
          if (!job) break;
          // Not claimed: stop instead of re-fetching the same row in a tight
          // loop. The next Realtime event or the 60s poll tries again.
          if (!(await exclusive(() => printJob(job)))) break;
        }
      } while (again.current);
    } finally {
      draining.current = false;
      load();
    }
  }, [exclusive, printJob, load, recoverStuck]);
  useEffect(() => { drainRef.current = drain; }, [drain]);

  useEffect(() => {
    load();
    drain();
    const ch = supabase
      .channel("label-print-station")
      .on("postgres_changes", { event: "*", schema: "public", table: "label_print_jobs" }, () => { load(); drain(); })
      .subscribe((s) => setLive(s === "SUBSCRIBED"));
    const t = window.setInterval(drain, POLL_MS);
    return () => { supabase.removeChannel(ch); window.clearInterval(t); };
  }, [load, drain]);

  // The station window stays open for days, so it would keep running an old
  // build after a deploy. Compare the entry script in the live index.html
  // with the one this page loaded, and reload when it changes. The reload
  // goes through the print chain, so it never interrupts a label mid-print.
  useEffect(() => {
    const current = entryScript(document.documentElement.innerHTML);
    if (!current) return; // dev server: no hashed bundle to compare
    let reloading = false;
    const check = async () => {
      if (reloading) return;
      try {
        const res = await fetch(`/index.html?nc=${Date.now()}`, { cache: "no-store" });
        if (!res.ok) return;
        const latest = entryScript(await res.text());
        if (!latest || latest === current) return;
        reloading = true;
        // Never reload a hidden window: a page reloaded while the station is
        // minimised sat on "loading" until someone restored it, and printed
        // nothing meanwhile (2026-11-17). The old build keeps printing; the
        // reload happens the moment the window is next shown.
        const reload = () => exclusive(async () => { window.location.reload(); });
        if (document.visibilityState === "visible") { reload(); return; }
        const onShow = () => {
          if (document.visibilityState !== "visible") return;
          document.removeEventListener("visibilitychange", onShow);
          reload();
        };
        document.addEventListener("visibilitychange", onShow);
      } catch { /* offline: try again next time */ }
    };
    const t = window.setInterval(check, VERSION_POLL_MS);
    return () => window.clearInterval(t);
  }, [exclusive]);

  // Print / Reprint one job now (also how a backlog job gets printed).
  const printNow = async (job: Job) => {
    await supabase.from("label_print_jobs").update({ status: "queued", error: null, attempts: 0, printed_at: null, claimed_at: null }).eq("id", job.id);
    await exclusive(() => printJob({ ...job, status: "queued", attempts: 0 }));
    load();
  };
  const cancel = async (job: Job) => {
    await supabase.from("label_print_jobs").update({ status: "cancelled", error: "Cancelled at station" }).eq("id", job.id).in("status", ["queued", "failed"]);
    load();
  };
  const testPrint = async () => {
    setTesting(true);
    try {
      const { data: g } = await supabase.from("instruction_sets").select("id, product_code").order("updated_at", { ascending: false }).limit(1).maybeSingle();
      if (!g) return;
      await supabase.from("label_print_jobs").insert({ source: "manual", kind: "guide", order_number: "TEST", customer_name: user?.email ?? "Station test", sku: g.product_code, guide_id: g.id, copies: 1 });
      load(); drain();
    } finally {
      setTesting(false);
    }
  };

  const waiting = jobs.filter(isStale).length;
  const failed = jobs.filter(j => j.status === "failed").length;

  return (
    <div className="min-h-screen bg-background text-foreground p-6 font-sans">
      <header className="flex flex-wrap items-center gap-4 mb-6">
        <div className="mr-auto">
          <h1 className="text-xl font-semibold">Label Print Station</h1>
          <p className="text-sm text-muted-foreground">
            <span className={`inline-block w-2 h-2 rounded-full mr-1.5 ${live ? "bg-emerald-500" : "bg-red-500"}`} />
            {live ? "Live" : "Reconnecting…"} · prints automatically{waiting ? ` · ${waiting} older waiting` : ""}{failed ? ` · ${failed} failed` : ""} · signed in as {user?.email ?? "—"}
          </p>
        </div>
        <label className="text-sm flex items-center gap-2">
          Station
          <input value={station} onChange={e => setStation(e.target.value)} className="bg-card border rounded px-2 py-1 text-sm w-44" aria-label="Station name" />
        </label>
        <button onClick={testPrint} disabled={testing} className="px-3 py-1.5 rounded text-sm border bg-card disabled:opacity-50">Test print</button>
      </header>

      {printing && (
        <div className="mb-4 p-3 rounded border border-sky-500/40 bg-sky-500/10 text-sm">
          Printing {printing.copies}× {guideName(printing)}{printing.order_number ? ` for ${printing.order_number}` : ""}…
        </div>
      )}

      <div className="overflow-x-auto rounded border bg-card">
        <table className="w-full text-sm">
          <thead className="text-left text-muted-foreground border-b">
            <tr>
              <th className="p-2 font-medium">Time</th>
              <th className="p-2 font-medium">Order</th>
              <th className="p-2 font-medium">Customer</th>
              <th className="p-2 font-medium">SKU</th>
              <th className="p-2 font-medium">Guide</th>
              <th className="p-2 font-medium text-right">Labels</th>
              <th className="p-2 font-medium">Status</th>
              <th className="p-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {jobs.length === 0 && (
              <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">No label jobs yet. They appear here when an order is picked, or when Print is pressed in the Guide portal or the warehouse barcode tool.</td></tr>
            )}
            {jobs.map(j => {
              const stale = isStale(j);
              return (
                <tr key={j.id} className="border-b last:border-0 align-top">
                  <td className="p-2 whitespace-nowrap">{fmtTime(j.created_at)}</td>
                  <td className="p-2 whitespace-nowrap">{j.order_number ?? "—"}<span className="block text-xs text-muted-foreground">{j.source}</span></td>
                  <td className="p-2">{j.customer_name ?? "—"}{j.ship_to && <span className="block text-xs text-muted-foreground">{j.ship_to}</span>}</td>
                  <td className="p-2 font-mono whitespace-nowrap">{j.sku ?? "—"}</td>
                  <td className="p-2">{guideName(j)}</td>
                  <td className="p-2 text-right">{j.copies}</td>
                  <td className="p-2">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${stale ? STATUS_CLASS.cancelled : STATUS_CLASS[j.status]}`}>{stale ? "waiting" : j.status}</span>
                    {j.status === "printed" && <span className="block text-xs text-muted-foreground">{fmtTime(j.printed_at)}{j.station ? ` · ${j.station}` : ""}</span>}
                    {j.error && <span className={`block text-xs max-w-xs ${j.status === "printed" ? "text-muted-foreground" : "text-red-500"}`}>{j.status === "printed" ? `Earlier try: ${j.error}` : j.error}</span>}
                  </td>
                  <td className="p-2 whitespace-nowrap text-right">
                    {stale && <button onClick={() => printNow(j)} className="text-xs underline mr-3">Print</button>}
                    {(j.status === "printed" || j.status === "failed" || j.status === "cancelled") && (
                      <button onClick={() => printNow(j)} className="text-xs underline mr-3">Reprint</button>
                    )}
                    {(j.status === "queued" || j.status === "failed") && (
                      <button onClick={() => cancel(j)} className="text-xs underline text-muted-foreground">Cancel</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        Keep this window open on the PC connected to the LabelWriter. Launch it with tools/label-station.cmd so Chrome prints without a dialog
        (the LabelWriter must be the Windows default printer on that PC). Jobs older than 15 minutes wait for a manual Print.
      </p>
    </div>
  );
}
