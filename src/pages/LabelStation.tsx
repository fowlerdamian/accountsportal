/**
 * /labels/station — the print station for DYMO guide labels.
 *
 * Runs in Chrome on the office host PC next to the LabelWriter 550, launched
 * with --kiosk-printing (tools/label-station.cmd) so print() goes straight to
 * the Windows default printer with no dialog. Jobs land in label_print_jobs
 * at ship time (ShipStation SHIP_NOTIFY → guide-delivery queue-labels).
 *
 * Nothing prints unattended: each shipment's labels are grouped into one
 * "Print instruction labels?" dialog showing the order, who it is for and
 * every label line (qty × guide / SKU). Yes prints them in order through the
 * hidden-iframe pipeline (printLabels → /labels/print); No cancels the group.
 * Missed jobs (station closed) are asked about when it reopens. Realtime is
 * the wake-up; a 60s poll is the backup. Failed prints retry up to
 * MAX_ATTEMPTS then wait for a manual Reprint.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@portal/lib/supabase";
import { useAuth } from "@portal/context/AuthContext.jsx";
import { printLabels } from "@portal/lib/labels/printLabels";

interface Job {
  id: string;
  created_at: string;
  source: string;
  order_number: string | null;
  shipstation_shipment_id: string | null;
  customer_name: string | null;
  ship_to: string | null;
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

/** One confirm dialog = one shipment (or one manual job). */
interface Group { key: string; jobs: Job[] }

const STATION_KEY = "label-station:name";
const POLL_MS = 60_000;
const MAX_ATTEMPTS = 3;
const HISTORY = 100;
const SELECT = "*, instruction_sets(title, product_code)";

const readLs = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const writeLs = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private window */ } };

const fmtTime = (iso: string | null) => iso ? new Date(iso).toLocaleString("en-AU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
const groupKey = (j: Job) => j.shipstation_shipment_id ? `ss:${j.shipstation_shipment_id}` : j.order_number ? `order:${j.order_number}` : `job:${j.id}`;
const guideName = (j: Job) => j.instruction_sets?.title ?? j.guide_id;

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
  const [prompt, setPrompt] = useState<Group | null>(null);
  const [printing, setPrinting] = useState<Job | null>(null);
  const [live, setLive] = useState(false);
  const [testing, setTesting] = useState(false);
  const busy = useRef(false);
  const promptRef = useRef<Group | null>(null);
  const stationRef = useRef(station);

  useEffect(() => { stationRef.current = station; writeLs(STATION_KEY, station); }, [station]);
  useEffect(() => { promptRef.current = prompt; }, [prompt]);

  const load = useCallback(async () => {
    const { data } = await supabase.from("label_print_jobs").select(SELECT).order("created_at", { ascending: false }).limit(HISTORY);
    if (data) setJobs(data as Job[]);
  }, []);

  // Surface the oldest queued shipment as a dialog (only one at a time).
  const askNext = useCallback(async () => {
    if (promptRef.current || busy.current) return;
    const { data } = await supabase.from("label_print_jobs").select(SELECT).eq("status", "queued").order("created_at").limit(200);
    const queued = (data ?? []) as Job[];
    if (!queued.length) return;
    const key = groupKey(queued[0]);
    const group = { key, jobs: queued.filter(j => groupKey(j) === key) };
    promptRef.current = group;
    setPrompt(group);
  }, []);

  const printJob = useCallback(async (job: Job) => {
    // Claim atomically so a second open station can't print the same job.
    const { data: claimed } = await supabase
      .from("label_print_jobs")
      .update({ status: "printing", station: stationRef.current, claimed_at: new Date().toISOString(), attempts: job.attempts + 1, decided_by: user?.id ?? null, decided_at: new Date().toISOString() })
      .eq("id", job.id)
      .eq("status", "queued")
      .select("id")
      .maybeSingle();
    if (!claimed) return;
    setPrinting(job);
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
      setPrinting(null);
    }
  }, [user?.id]);

  const confirmYes = useCallback(async () => {
    const group = promptRef.current;
    if (!group || busy.current) return;
    busy.current = true;
    setPrompt(null); promptRef.current = null;
    try {
      for (const job of group.jobs) await printJob(job);
    } finally {
      busy.current = false;
      await load();
      askNext();
    }
  }, [printJob, load, askNext]);

  const confirmNo = useCallback(async () => {
    const group = promptRef.current;
    if (!group) return;
    setPrompt(null); promptRef.current = null;
    await supabase.from("label_print_jobs")
      .update({ status: "cancelled", error: "Declined at station", decided_by: user?.id ?? null, decided_at: new Date().toISOString() })
      .in("id", group.jobs.map(j => j.id))
      .eq("status", "queued");
    await load();
    askNext();
  }, [user?.id, load, askNext]);

  useEffect(() => {
    load();
    askNext();
    const ch = supabase
      .channel("label-print-station")
      .on("postgres_changes", { event: "*", schema: "public", table: "label_print_jobs" }, () => { load(); askNext(); })
      .subscribe((s) => setLive(s === "SUBSCRIBED"));
    const t = window.setInterval(askNext, POLL_MS);
    return () => { supabase.removeChannel(ch); window.clearInterval(t); };
  }, [load, askNext]);

  // Keyboard: Enter = Yes, Escape = No while the dialog is up.
  useEffect(() => {
    if (!prompt) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") { e.preventDefault(); confirmYes(); }
      if (e.key === "Escape") { e.preventDefault(); confirmNo(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prompt, confirmYes, confirmNo]);

  const reprint = async (job: Job) => {
    await supabase.from("label_print_jobs").update({ status: "queued", error: null, attempts: 0, printed_at: null, claimed_at: null }).eq("id", job.id);
    load(); askNext();
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
      await supabase.from("label_print_jobs").insert({ source: "manual", order_number: "TEST", customer_name: user?.email ?? "Station test", sku: g.product_code, guide_id: g.id, copies: 1 });
      load(); askNext();
    } finally {
      setTesting(false);
    }
  };

  const queued = jobs.filter(j => j.status === "queued").length;
  const failed = jobs.filter(j => j.status === "failed").length;
  const first = prompt?.jobs[0];
  const totalCopies = useMemo(() => prompt?.jobs.reduce((n, j) => n + j.copies, 0) ?? 0, [prompt]);

  return (
    <div className="min-h-screen bg-background text-foreground p-6 font-sans">
      <header className="flex flex-wrap items-center gap-4 mb-6">
        <div className="mr-auto">
          <h1 className="text-xl font-semibold">Label Print Station</h1>
          <p className="text-sm text-muted-foreground">
            <span className={`inline-block w-2 h-2 rounded-full mr-1.5 ${live ? "bg-emerald-500" : "bg-red-500"}`} />
            {live ? "Live" : "Reconnecting…"} · {queued} waiting{failed ? ` · ${failed} failed` : ""} · signed in as {user?.email ?? "—"}
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
              <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">No label jobs yet. They appear here as orders ship.</td></tr>
            )}
            {jobs.map(j => (
              <tr key={j.id} className="border-b last:border-0 align-top">
                <td className="p-2 whitespace-nowrap">{fmtTime(j.created_at)}</td>
                <td className="p-2 whitespace-nowrap">{j.order_number ?? "—"}<span className="block text-xs text-muted-foreground">{j.source}</span></td>
                <td className="p-2">{j.customer_name ?? "—"}{j.ship_to && <span className="block text-xs text-muted-foreground">{j.ship_to}</span>}</td>
                <td className="p-2 font-mono whitespace-nowrap">{j.sku ?? "—"}</td>
                <td className="p-2">{guideName(j)}</td>
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

      {prompt && first && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby="print-q">
          <div className="w-full max-w-lg rounded-lg border bg-card shadow-xl">
            <div className="p-5 border-b">
              <h2 id="print-q" className="text-lg font-semibold">Print instruction labels?</h2>
              <p className="text-sm text-muted-foreground mt-1">
                {first.source === "manual" ? "Manual job" : "Order shipped in ShipStation"} · {fmtTime(first.created_at)}
              </p>
            </div>
            <div className="p-5 space-y-3 text-sm">
              <div className="grid grid-cols-[110px_1fr] gap-y-1.5">
                <span className="text-muted-foreground">Order</span><span className="font-medium">{first.order_number ?? "—"}</span>
                <span className="text-muted-foreground">Customer</span><span className="font-medium">{first.customer_name ?? "—"}</span>
                <span className="text-muted-foreground">Ship to</span><span>{first.ship_to ?? "—"}</span>
                {first.brand_key && (<><span className="text-muted-foreground">Brand</span><span className="capitalize">{first.brand_key}</span></>)}
              </div>
              <div className="rounded border">
                <div className="px-3 py-1.5 text-xs text-muted-foreground border-b">Labels to print — {totalCopies} in total</div>
                <ul className="divide-y">
                  {prompt.jobs.map(j => (
                    <li key={j.id} className="px-3 py-2 flex items-baseline gap-3">
                      <span className="font-semibold tabular-nums w-10 shrink-0">{j.copies}×</span>
                      <span className="flex-1">
                        <span className="font-medium">{guideName(j)}</span>
                        <span className="block text-xs text-muted-foreground font-mono">{j.sku ?? "—"}{j.instruction_sets?.product_code && j.instruction_sets.product_code !== j.sku ? ` · guide ${j.instruction_sets.product_code}` : ""}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              {prompt.jobs.some(j => j.attempts > 0) && <p className="text-xs text-amber-500">Some of these labels failed earlier and are being retried.</p>}
            </div>
            <div className="p-4 border-t flex justify-end gap-2">
              <button onClick={confirmNo} className="px-4 py-2 rounded text-sm border bg-card hover:bg-muted">No, don't print</button>
              <button onClick={confirmYes} autoFocus className="px-4 py-2 rounded text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-700">Yes, print {totalCopies} label{totalCopies === 1 ? "" : "s"}</button>
            </div>
            <p className="px-4 pb-3 text-[11px] text-muted-foreground">Enter = Yes · Esc = No. Declined labels stay in the list and can be reprinted later.</p>
          </div>
        </div>
      )}
    </div>
  );
}
