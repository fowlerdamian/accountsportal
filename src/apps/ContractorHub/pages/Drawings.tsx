import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileDown, FileText, Loader2, RotateCcw, Upload } from "lucide-react";
import { toast } from "sonner";
import { HubLayout } from "@hub/components/HubLayout";
import { TrashIcon } from "@portal/components/icons";
import { supabase } from "@guide/integrations/supabase/client";
import { useAuth } from "@guide/contexts/AuthContext";
import { cn } from "@guide/lib/utils";

// STEP → A3 third-angle PDF drawings. The portal only queues jobs; the
// geometry work runs in tools/step2drawing/worker.py on the R&D PC.

const BUCKET = "step-drawings";
const STEP_EXTS = [".step", ".stp"];
const DRAWN_BY_KEY = "rd-drawings-drawn-by";
const MATERIAL_KEY = "rd-drawings-material";
const FINISH_KEY   = "rd-drawings-finish";
const MATERIAL_SUGGESTIONS = ["3mm Mild Steel", "2mm Mild Steel", "5mm Mild Steel", "3mm Aluminium", "2mm Stainless Steel"];
const FINISH_SUGGESTIONS   = ["Black Textured PC", "Black Satin PC", "Zinc Plated", "Galvanised", "Raw"];
const INPUT_CLS = "h-8 rounded border border-[#333] bg-transparent px-2 text-sm text-white focus:border-[var(--brand-accent)] focus:outline-none";
const WORKER_LATE_MS = 2 * 60_000;

type Status = "queued" | "running" | "done" | "error";

interface DrawingJob {
  id:          string;
  created_at:  string;
  file_name:   string;
  part_name:   string;
  step_path:   string;
  drawn_by:    string | null;
  rev:         string;
  material:    string | null;
  finish:      string | null;
  status:      Status;
  started_at:  string | null;
  finished_at: string | null;
  pdf_path:    string | null;
  png_path:    string | null;
  scale:       string | null;
  envelope:    string | null;
  holes:       string | null;
  error:       string | null;
}

const isStep = (name: string) => STEP_EXTS.some((e) => name.toLowerCase().endsWith(e));
const stem   = (name: string) => name.replace(/\.(step|stp)$/i, "");

function useJobs() {
  return useQuery({
    queryKey: ["step_drawing_jobs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("step_drawing_jobs" as any)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as unknown as DrawingJob[];
    },
    // Poll only while something is in flight.
    refetchInterval: (q) =>
      (q.state.data as DrawingJob[] | undefined)?.some((j) => j.status === "queued" || j.status === "running") ? 3000 : false,
  });
}

function usePreviewUrls(jobs: DrawingJob[]) {
  const paths = jobs.map((j) => j.png_path).filter(Boolean) as string[];
  return useQuery({
    queryKey: ["step_drawing_previews", paths],
    enabled: paths.length > 0,
    staleTime: 50 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 3600);
      if (error) throw error;
      return Object.fromEntries((data ?? []).map((d) => [d.path, d.signedUrl])) as Record<string, string>;
    },
  });
}

async function signedUrl(path: string, download?: string) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 300, download ? { download } : undefined);
  if (error || !data) throw error ?? new Error("No URL");
  return data.signedUrl;
}

function StatusPill({ status }: { status: Status }) {
  const styles: Record<Status, string> = {
    queued:  "text-[#888] border-[#333]",
    running: "text-[var(--brand-accent)] border-[rgba(var(--brand-accent-rgb),0.4)]",
    done:    "text-emerald-400 border-emerald-900",
    error:   "text-red-400 border-red-900",
  };
  return (
    <span className={cn("inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider", styles[status])}>
      {status === "running" && <Loader2 className="h-3 w-3 animate-spin" />}
      {status === "running" ? "Drawing" : status === "error" ? "Failed" : status}
    </span>
  );
}

export default function Drawings() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { data: jobs = [], isLoading } = useJobs();
  const { data: previews = {} } = usePreviewUrls(jobs);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [rev, setRev] = useState("A");
  const [drawnBy, setDrawnBy] = useState("");
  const [material, setMaterial] = useState(() => { try { return localStorage.getItem(MATERIAL_KEY) ?? ""; } catch { return ""; } });
  const [finish, setFinish]     = useState(() => { try { return localStorage.getItem(FINISH_KEY) ?? ""; } catch { return ""; } });

  useEffect(() => {
    let saved = "";
    try { saved = localStorage.getItem(DRAWN_BY_KEY) ?? ""; } catch { /* storage blocked */ }
    const meta = (user?.user_metadata ?? {}) as Record<string, string>;
    setDrawnBy(saved || meta.full_name || meta.name || user?.email?.split("@")[0] || "");
  }, [user]);

  const refresh = useCallback(() => qc.invalidateQueries({ queryKey: ["step_drawing_jobs"] }), [qc]);

  const queueFiles = useCallback(async (files: File[]) => {
    const steps = files.filter((f) => isStep(f.name));
    const skipped = files.length - steps.length;
    if (skipped) toast.error(`${skipped} file${skipped > 1 ? "s" : ""} skipped — only .step and .stp files can be drawn`);
    if (!steps.length) return;
    // Material + finish go in the title block, so they're required.
    if (!material.trim() || !finish.trim()) {
      toast.error("Enter the material and finish first — they go in the title block");
      return;
    }
    try {
      localStorage.setItem(DRAWN_BY_KEY, drawnBy);
      localStorage.setItem(MATERIAL_KEY, material.trim());
      localStorage.setItem(FINISH_KEY, finish.trim());
    } catch { /* storage blocked */ }

    setUploading((n) => n + steps.length);
    let queued = 0;
    for (const file of steps) {
      const id = crypto.randomUUID();
      const path = `step/${id}/${file.name.replace(/[^\w.\- ]+/g, "_")}`;
      try {
        const up = await supabase.storage.from(BUCKET).upload(path, file, { contentType: "application/step" });
        if (up.error) throw up.error;
        const { error } = await supabase.from("step_drawing_jobs" as any).insert({
          id, file_name: file.name, part_name: stem(file.name), step_path: path,
          drawn_by: drawnBy.trim() || null, rev: rev.trim() || "A",
          material: material.trim(), finish: finish.trim(),
        });
        if (error) throw error;
        queued++;
      } catch (e: any) {
        toast.error(`${file.name}: ${e?.message ?? "upload failed"}`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
    if (queued) toast.success(`${queued} drawing${queued > 1 ? "s" : ""} queued`);
    refresh();
  }, [drawnBy, rev, material, finish, refresh]);

  const openPdf = async (job: DrawingJob) => {
    try { window.open(await signedUrl(job.pdf_path!), "_blank", "noopener"); }
    catch (e: any) { toast.error(e?.message ?? "Could not open the PDF"); }
  };

  const downloadPdf = async (job: DrawingJob) => {
    try { window.location.href = await signedUrl(job.pdf_path!, `${job.part_name}.pdf`); }
    catch (e: any) { toast.error(e?.message ?? "Could not download the PDF"); }
  };

  const retry = async (job: DrawingJob) => {
    const { error } = await supabase.from("step_drawing_jobs" as any)
      .update({ status: "queued", error: null, started_at: null, finished_at: null }).eq("id", job.id);
    if (error) toast.error(error.message); else refresh();
  };

  const remove = async (job: DrawingJob) => {
    if (!window.confirm(`Delete the drawing for ${job.part_name}?`)) return;
    const paths = [job.step_path, job.pdf_path, job.png_path].filter(Boolean) as string[];
    await supabase.storage.from(BUCKET).remove(paths);
    const { error } = await supabase.from("step_drawing_jobs" as any).delete().eq("id", job.id);
    if (error) toast.error(error.message); else refresh();
  };

  const oldestQueued = jobs.filter((j) => j.status === "queued").map((j) => Date.parse(j.created_at)).sort()[0];
  const workerLate = oldestQueued !== undefined && Date.now() - oldestQueued > WORKER_LATE_MS;

  return (
    <HubLayout>
      <div className="space-y-6">
        <div className="space-y-1">
          <h1 className="text-lg font-semibold text-white">STEP to drawing</h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Drop STEP files to get an A3 third-angle PDF per part: front, top, right and iso views, hidden lines dashed,
            overall dimensions and hole callouts, scaled to fit, with the AGA title block.
          </p>
        </div>

        {/* Drop zone — data-local-dropzone stops the portal-wide freight importer grabbing drops */}
        <div
          data-local-dropzone
          role="button"
          tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); inputRef.current?.click(); } }}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); queueFiles(Array.from(e.dataTransfer.files)); }}
          className={cn(
            "flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 py-10 text-center cursor-pointer transition-colors",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-accent)]",
            dragOver ? "border-[var(--brand-accent)] bg-[rgba(var(--brand-accent-rgb),0.06)]" : "border-[#333] hover:border-[#555]",
          )}
        >
          {uploading > 0 ? <Loader2 className="h-6 w-6 animate-spin text-[var(--brand-accent)]" /> : <Upload className="h-6 w-6 text-[#666]" />}
          <p className="text-sm text-white">{uploading > 0 ? `Uploading ${uploading}…` : "Drop .step / .stp files here, or click to choose"}</p>
          <p className="text-xs text-muted-foreground">One drawing per file. The file name is the drawing number; the part number is that less its 6-digit date.</p>
          <input
            ref={inputRef}
            id="rd-drawings-files"
            type="file"
            multiple
            accept=".step,.stp,.STEP,.STP"
            className="hidden"
            onChange={(e) => { queueFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }}
          />
        </div>

        <div className="flex flex-wrap items-end gap-4">
          <label className="grid gap-1 text-xs text-muted-foreground" htmlFor="rd-drawings-material">
            Material
            <input
              id="rd-drawings-material"
              list="rd-drawings-material-list"
              value={material}
              placeholder="e.g. 3mm Mild Steel"
              onChange={(e) => setMaterial(e.target.value)}
              className={cn(INPUT_CLS, "w-56", !material.trim() && "border-amber-800")}
            />
            <datalist id="rd-drawings-material-list">{MATERIAL_SUGGESTIONS.map((m) => <option key={m} value={m} />)}</datalist>
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground" htmlFor="rd-drawings-finish">
            Finish
            <input
              id="rd-drawings-finish"
              list="rd-drawings-finish-list"
              value={finish}
              placeholder="e.g. Black Textured PC"
              onChange={(e) => setFinish(e.target.value)}
              className={cn(INPUT_CLS, "w-56", !finish.trim() && "border-amber-800")}
            />
            <datalist id="rd-drawings-finish-list">{FINISH_SUGGESTIONS.map((f) => <option key={f} value={f} />)}</datalist>
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground" htmlFor="rd-drawings-drawn-by">
            Drawn by
            <input
              id="rd-drawings-drawn-by"
              value={drawnBy}
              onChange={(e) => setDrawnBy(e.target.value)}
              className="h-8 w-56 rounded border border-[#333] bg-transparent px-2 text-sm text-white focus:border-[var(--brand-accent)] focus:outline-none"
            />
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground" htmlFor="rd-drawings-rev">
            Rev
            <input
              id="rd-drawings-rev"
              value={rev}
              maxLength={4}
              onChange={(e) => setRev(e.target.value.toUpperCase())}
              className="h-8 w-16 rounded border border-[#333] bg-transparent px-2 text-sm text-white focus:border-[var(--brand-accent)] focus:outline-none"
            />
          </label>
          <p className="text-xs text-muted-foreground pb-2">Applied to the next files you drop.</p>
        </div>

        {workerLate && (
          <div className="rounded border border-amber-900 bg-amber-950/30 px-4 py-3 text-sm text-amber-300">
            Drawings are waiting for the drawing worker. It runs on the R&D PC, so check that PC is on and signed in
            (task <code className="text-xs">AGA-STEP-Drawings-Worker</code>).
          </div>
        )}

        {/* Jobs */}
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading drawings…</div>
        ) : jobs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No drawings yet. Drop a STEP file above to make the first one.</p>
        ) : (
          <div className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(300px,1fr))]">
            {jobs.map((job) => {
              const preview = job.png_path ? previews[job.png_path] : undefined;
              return (
                <div key={job.id} className="flex flex-col rounded-lg border border-[#222] bg-[#0a0a0a] overflow-hidden">
                  <button
                    type="button"
                    disabled={job.status !== "done"}
                    onClick={() => openPdf(job)}
                    className="block aspect-[420/297] w-full bg-white disabled:cursor-default disabled:bg-[#111]"
                    title={job.status === "done" ? "Open PDF" : undefined}
                  >
                    {preview ? (
                      <img src={preview} alt={`Drawing of ${job.part_name}`} className="h-full w-full object-contain" />
                    ) : (
                      <span className="flex h-full items-center justify-center text-[#444]">
                        {job.status === "error" ? <FileText className="h-8 w-8" /> : <Loader2 className={cn("h-6 w-6", job.status === "running" && "animate-spin")} />}
                      </span>
                    )}
                  </button>
                  <div className="flex flex-1 flex-col gap-2 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 truncate text-sm font-medium text-white" title={job.file_name}>{job.part_name}</p>
                      <StatusPill status={job.status} />
                    </div>
                    {job.status === "done" && (
                      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs tabular-nums">
                        <dt className="text-muted-foreground">Scale</dt><dd className="text-white">{job.scale}</dd>
                        <dt className="text-muted-foreground">Envelope</dt><dd className="text-white">{job.envelope} mm</dd>
                        <dt className="text-muted-foreground">Holes</dt><dd className="text-white">{job.holes ?? "None"}</dd>
                      </dl>
                    )}
                    {job.status === "error" && <p className="text-xs text-red-400 break-words">{job.error}</p>}
                    <div className="mt-auto flex items-center justify-between pt-1 text-[11px] text-muted-foreground">
                      <span>Rev {job.rev}{job.material ? ` · ${job.material}` : ""}{job.finish ? ` · ${job.finish}` : ""}{job.drawn_by ? ` · ${job.drawn_by}` : ""} · {new Date(job.created_at).toLocaleDateString("en-AU")}</span>
                      <span className="flex items-center gap-1">
                        {job.status === "done" && (
                          <button type="button" onClick={() => downloadPdf(job)} className="rounded p-1 hover:text-white" title="Download PDF">
                            <FileDown className="h-4 w-4" />
                          </button>
                        )}
                        {job.status === "error" && (
                          <button type="button" onClick={() => retry(job)} className="rounded p-1 hover:text-white" title="Try again">
                            <RotateCcw className="h-4 w-4" />
                          </button>
                        )}
                        <button type="button" onClick={() => remove(job)} className="rounded p-1 hover:text-red-400" title="Delete">
                          <TrashIcon size={16} />
                        </button>
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </HubLayout>
  );
}
