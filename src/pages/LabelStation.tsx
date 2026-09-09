/**
 * /labels/station — the print station for DYMO guide labels.
 *
 * Runs in Chrome on the office host PC next to the LabelWriter 550, launched
 * with --kiosk-printing (tools/label-station.cmd) so print() goes straight to
 * the Windows default printer with no dialog. Jobs land in label_print_jobs
 * at ship time (ShipStation SHIP_NOTIFY → guide-delivery queue-labels) and
 * this page prints them in order through the hidden-iframe pipeline
 * (printLabels → /labels/print), one label per copy = shipped quantity.
 *
 * Missed jobs (station closed) print when it reopens. Realtime is the wake-up;
 * a 60s poll is the backup. Failed jobs retry up to MAX_ATTEMPTS then wait for
 * a manual Reprint.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@portal/lib/supabase";
import { useAuth } from "@portal/context/AuthContext.jsx";
import { printLabels } from "@portal/lib/labels/printLabels";

interface Job {
  id: string;
  created_at: string;
  source: string;
  order_number: string | null;
  sku: string | null;
  guide_id: string;
  brand_key: string | null;
  copies: number;
  status: "queued" | "printing" | "printed" | "failed" | "cancelled";
  attempts: number;
  error: string | null;
  printed_at: string | null;
  station: string | null;
  instruction_sets?: { title: string; product_code: string | null } | null;
}

const AUTO_KEY = "label-station:auto";
const STATION_KEY = "label-station:name";
const POLL_MS = 60_000;
const MAX_ATTEMPTS = 3;
const HISTORY = 100;

const readLs = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const writeLs = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private window */ } };

const fmtTime = (iso: string | null) => iso ? new Date(iso).toLocaleString("en-AU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "";

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
  const [auto, setAuto] = useState(() => readLs(AUTO_KEY) !== "off");
  const [station, setStation] = useState(() => readLs(STATION_KEY) || "Office LabelWriter");
  const [current, setCurrent] = useState<Job | null>(null);
  const [live, setLive] = useState(false);
  const [testing, setTesting] = useState(false);
  const busy = useRef(false);
  const autoRef = useRef(auto);
  const stationRef = useRef(station);

  useEffect(() => { autoRef.current = auto; writeLs(AUTO_KEY, auto ? "on" : "off"); }, [auto]);
  useEffect(() => { stationRef.current = station; writeLs(STATION_KEY, station); }, [station]);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("label_print_jobs")
      .select("*, instruction_sets(title, product_code)")
      .order("created_at", { ascending: false })
      .limit(HISTORY);
    if (data) setJobs(data as Job[]);
  }, []);

  const printJob = useCallback(async (job: Job) => {
    // Claim atomically so a second open station can't print the same job.
    const { data: claimed } = await supabase
      .from("label_print_jobs")
      .update({ status: "printing", station: stationRef.current, claimed_at: new Date().toISOString(), attempts: job.attempts + 1 })
      .eq("id", job.id)
      .eq("status", "queued")
      .select("id")
      .maybeSingle();
    if (!claimed) return;
    setCurrent(job);
    try {
      await printLabels({ ids: [job.guide_id], brand: job.brand_key, copies: job.copies });
      await supabase.from("label_print_jobs")
        .update({ status: "printed", printed_at: new Date().toISOString(), printed_by: user?.id ?? null, error: null })
        .eq("id", job.id);
    } catch (e: any) {
      const retry = job.attempts + 1 < MAX_ATTEMPTS;
      await supabase.from("label_print_jobs")
        .update({ status: retry ? "queued" : "failed", error: e?.message ?? String(e) })
        .eq("id", job.id);
    } finally {
      setCurrent(null);
    }
  }, [user?.id]);

  // Print every queued job, oldest first, one at a time.
  const drain = useCallback(async () => {
    if (busy.current || !autoRef.current) return;
    busy.current = true;
    try {
      for (let guard = 0; guard < 200; guard++) {
        const { data } = await supabase.from("label_print_jobs").select("*").eq("status", "queued").order("created_at").limit(1);
        const job = data?.[0] as Job | undefined;
        if (!job) break;
        await printJob(job);
      }
    } finally {
      busy.current = false;
      await load();
    }
  }, [printJob, load]);

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

  useEffect(() => { if (auto) drain(); }, [auto, drain]);

  const reprint = async (job: Job) => {
    await supabase.from("label_print_jobs").update({ status: "queued", error: null, attempts: 0, printed_at: null, claimed_at: null }).eq("id", job.id);
    load(); drain();
  };
  const cancel = async (job: Job) => {
    await supabase.from("label_print_jobs").update({ status: "cancelled" }).eq("id", job.id).in("status", ["queued", "failed"]);
    load();
  };
  const testPrint = async () => {
    setTesting(true);
    try {
      const { data: g } = await supabase.from("instruction_sets").select("id, product_code").order("updated_at", { ascending: false }).limit(1).maybeSingle();
      if (!g) return;
      await supabase.from("label_print_jobs").insert({ source: "manual", order_number: "TEST", sku: g.product_code, guide_id: g.id, copies: 1 });
      load(); drain();
    } finally {
      setTesting(false);
    }
  };

  const queued = jobs.filter(j => j.status === "queued").length;
  const failed = jobs.filter(j => j.status === "failed").length;

  return (
    <div className="min-h-screen bg-background text-foreground p-6 font-sans">
      <header className="flex flex-wrap items-center gap-4 mb-6">
        <div className="mr-auto">
          <h1 className="text-xl font-semibold">Label Print Station</h1>
          <p className="text-sm text-muted-foreground">
            <span className={`inline-block w-2 h-2 rounded-full mr-1.5 ${live ? "bg-emerald-500" : "bg-red-500"}`} />
            {live ? "Live" : "Reconnecting…"} · {queued} queued{failed ? ` · ${failed} failed` : ""} · signed in as {user?.email ?? "—"}
          </p>
        </div>
        <label className="text-sm flex items-center gap-2">
          Station
          <input
            value={station}
            onChange={e => setStation(e.target.value)}
            className="bg-card border rounded px-2 py-1 text-sm w-44"
            aria-label="Station name"
          />
        </label>
        <button
          onClick={() => setAuto(a => !a)}
          className={`px-3 py-1.5 rounded text-sm font-medium ${auto ? "bg-emerald-600 text-white" : "bg-amber-600 text-white"}`}
        >
          Auto-print {auto ? "ON" : "PAUSED"}
        </button>
        <button onClick={testPrint} disabled={testing} className="px-3 py-1.5 rounded text-sm border bg-card disabled:opacity-50">
          Test print
        </button>
      </header>

      {current && (
        <div className="mb-4 p-3 rounded border border-sky-500/40 bg-sky-500/10 text-sm">
          Printing {current.copies}× {current.sku ?? current.guide_id}{current.order_number ? ` for ${current.order_number}` : ""}…
        </div>
      )}
      {!auto && (
        <div className="mb-4 p-3 rounded border border-amber-500/40 bg-amber-500/10 text-sm">
          Auto-print is paused. Queued labels will wait here until it is switched back on.
        </div>
      )}

      <div className="overflow-x-auto rounded border bg-card">
        <table className="w-full text-sm">
          <thead className="text-left text-muted-foreground border-b">
            <tr>
              <th className="p-2 font-medium">Time</th>
              <th className="p-2 font-medium">Order</th>
              <th className="p-2 font-medium">SKU</th>
              <th className="p-2 font-medium">Guide</th>
              <th className="p-2 font-medium text-right">Copies</th>
              <th className="p-2 font-medium">Status</th>
              <th className="p-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {jobs.length === 0 && (
              <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">No label jobs yet. They appear here as orders ship.</td></tr>
            )}
            {jobs.map(j => (
              <tr key={j.id} className="border-b last:border-0 align-top">
                <td className="p-2 whitespace-nowrap">{fmtTime(j.created_at)}</td>
                <td className="p-2 whitespace-nowrap">{j.order_number ?? "—"}<span className="block text-xs text-muted-foreground">{j.source}</span></td>
                <td className="p-2 font-mono whitespace-nowrap">{j.sku ?? "—"}</td>
                <td className="p-2">{j.instruction_sets?.title ?? j.guide_id}</td>
                <td className="p-2 text-right">{j.copies}</td>
                <td className="p-2">
                  <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${STATUS_CLASS[j.status]}`}>{j.status}</span>
                  {j.status === "printed" && <span className="block text-xs text-muted-foreground">{fmtTime(j.printed_at)}{j.station ? ` · ${j.station}` : ""}</span>}
                  {j.error && <span className="block text-xs text-red-500 max-w-xs">{j.error}</span>}
                </td>
                <td className="p-2 whitespace-nowrap text-right">
                  {(j.status === "printed" || j.status === "failed" || j.status === "cancelled") && (
                    <button onClick={() => reprint(j)} className="text-xs underline mr-3">Reprint</button>
                  )}
                  {(j.status === "queued" || j.status === "failed") && (
                    <button onClick={() => cancel(j)} className="text-xs underline text-muted-foreground">Cancel</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        Keep this window open on the PC connected to the LabelWriter. Launch it with tools/label-station.cmd so Chrome prints without a dialog
        (the LabelWriter must be the Windows default printer on that PC).
      </p>
    </div>
  );
}
