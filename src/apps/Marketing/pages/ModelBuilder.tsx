import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Box, ArrowLeft, Upload, Loader2, Play, Download, Image as ImageIcon, RotateCw, Maximize2,
  Trash2, Code2, CheckCircle2, AlertCircle, Circle, Wand2, Plus, Copy, Square,
} from "lucide-react";
import { palette } from "@portal/lib/palette";
import { supabase } from "@portal/lib/supabase";
import {
  stream, fenced, parseJson, fileToReference, useRuntime, type Model3D, type Review,
} from "../hooks/useImg2Three";

// Marketing → 3D Model Builder. Reference image → img2threejs pipeline (analyse → build →
// render → vision review/refine loop) → procedural Three.js model, viewable and exportable as GLB.

type StepState = "pending" | "running" | "done" | "error";
interface Step { key: string; label: string; state: StepState; detail?: string }

const LIST_COLS = "id,name,thumbnail,fidelity,status,updated_at";

function useModels() {
  return useQuery({
    queryKey: ["marketing-3d-models"],
    queryFn: async () => {
      const { data, error } = await supabase.from("marketing_3d_models").select(LIST_COLS).order("updated_at", { ascending: false }).limit(60);
      if (error) throw error;
      return data as Pick<Model3D, "id" | "name" | "thumbnail" | "fidelity" | "status" | "updated_at">[];
    },
  });
}

const pct = (n?: number | null) => (n == null ? "—" : `${Math.round(n * 100)}%`);
const scoreColour = (n?: number | null) => (n == null ? "#8a8a8a" : n >= 0.85 ? "#5fb87a" : n >= 0.65 ? palette.accent : "#d9534f");

function download(name: string, blob: Blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "model";

export default function ModelBuilder() {
  const qc = useQueryClient();
  const list = useModels();
  const rt = useRuntime();

  const [model, setModel] = useState<Model3D | null>(null);
  const [draft, setDraft] = useState<{ reference: string | null; name: string; notes: string }>({ reference: null, name: "", notes: "" });
  const [passes, setPasses] = useState(2);
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<Step[]>([]);
  const [live, setLive] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [stats, setStats] = useState<{ parts: string[]; triangles: number } | null>(null);
  const [viewerError, setViewerError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const [autoRotate, setAutoRotate] = useState(true);
  const [explode, setExplode] = useState(0);
  const [showCode, setShowCode] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // ── persistence ───────────────────────────────────────────────────────────
  const save = useCallback(async (id: string, patch: Partial<Model3D>) => {
    const { error } = await supabase.from("marketing_3d_models").update(patch).eq("id", id);
    if (error) throw error;
    setModel((m) => (m && m.id === id ? { ...m, ...patch } : m));
    qc.invalidateQueries({ queryKey: ["marketing-3d-models"] });
  }, [qc]);

  const open = useCallback(async (id: string) => {
    if (running) return;
    const { data, error } = await supabase.from("marketing_3d_models").select("*").eq("id", id).single();
    if (error) { setErr(error.message); return; }
    const m = data as Model3D;
    setModel(m); setSteps([]); setLive(""); setErr(null); setStats(null); setViewerError(null); setExplode(0);
    if (m.code) {
      const r = await rt.load(m.code);
      if (r.ok) setStats({ parts: r.parts, triangles: r.triangles }); else setViewerError(r.error);
    }
  }, [running, rt]);

  useEffect(() => { rt.send({ type: "autorotate", on: autoRotate }); }, [autoRotate, rt.ready]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { rt.send({ type: "explode", amount: explode }); }, [explode]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── pipeline ──────────────────────────────────────────────────────────────
  const setStep = (key: string, patch: Partial<Step>) => setSteps((s) => s.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const addStep = (step: Step) => setSteps((s) => [...s.filter((x) => x.key !== step.key), step]);

  const viewsFor = (analysis: any) => {
    const yaw = Number(analysis?.referenceCamera?.yawDeg);
    const pitch = Number(analysis?.referenceCamera?.pitchDeg);
    const ref = { yaw: Number.isFinite(yaw) ? yaw : 30, pitch: Number.isFinite(pitch) ? Math.max(-30, Math.min(60, pitch)) : 12 };
    return [ref, { yaw: 0, pitch: 8 }, { yaw: 90, pitch: 8 }, { yaw: 215, pitch: 18 }];
  };

  /** One review/refine pass. Returns the review so the caller can decide whether to continue. */
  const refinePass = async (m: Model3D, pass: number, signal: AbortSignal, opts: { runtimeError?: string; feedback?: string }) => {
    const key = `pass-${pass}`;
    addStep({ key, label: opts.runtimeError ? `Pass ${pass} · fix runtime error` : `Pass ${pass} · render + vision review`, state: "running" });
    const renders = opts.runtimeError ? [m.reference] : await rt.capture(viewsFor(m.analysis));
    const out = await stream({
      action: "refine", image: m.reference, renders, code: m.code, analysis: m.analysis, pass,
      runtimeError: opts.runtimeError, feedback: opts.feedback,
    }, setLive, signal);
    const rv = parseJson<Omit<Review, "pass" | "at">>(out);
    const review: Review = { ...rv, pass, at: new Date().toISOString(), ...(opts.feedback ? { feedback: opts.feedback } : {}) };
    const code = fenced(out, "js");
    const patch: Partial<Model3D> = {
      reviews: [...(m.reviews ?? []), review],
      fidelity: rv.fidelity,
      thumbnail: opts.runtimeError ? m.thumbnail : renders[0],
      status: "refined",
    };
    if (code && rv.action !== "continue" && rv.action !== "stop") patch.code = code;
    await save(m.id, patch);
    Object.assign(m, patch);
    setStep(key, { state: "done", detail: `${pct(rv.fidelity)} · ${rv.action}` });
    return { review, newCode: !!patch.code && patch.code === code };
  };

  /** Load code into the viewer; if it throws, run fix passes (each counts against the budget). */
  const loadOrFix = async (m: Model3D, passRef: { n: number; max: number }, signal: AbortSignal) => {
    for (;;) {
      const r = await rt.load(m.code!);
      if (r.ok) { setStats({ parts: r.parts, triangles: r.triangles }); setViewerError(null); return true; }
      setViewerError(r.error);
      if (passRef.n >= passRef.max) return false;
      passRef.n++;
      await refinePass(m, passRef.n, signal, { runtimeError: r.error });
    }
  };

  const run = async (m: Model3D, opts: { feedback?: string; extraPasses?: number } = {}) => {
    const ac = new AbortController(); abortRef.current = ac;
    setRunning(true); setErr(null); setLive("");
    const priorPasses = (m.reviews ?? []).reduce((a, r) => Math.max(a, r.pass), 0);
    const passRef = { n: priorPasses, max: priorPasses + (opts.extraPasses ?? passes) + 1 };
    setSteps([
      ...(!m.analysis ? [{ key: "analyze", label: "Analyse image · sculpt spec", state: "pending" as StepState }] : []),
      ...(!m.code ? [{ key: "build", label: "Build procedural factory", state: "pending" as StepState }] : []),
    ]);
    try {
      if (!m.analysis) {
        setStep("analyze", { state: "running" });
        const out = await stream({ action: "analyze", image: m.reference, name: m.name, notes: m.notes }, setLive, ac.signal);
        const analysis = parseJson(out);
        if (analysis?.suitability?.verdict === "unsuitable") {
          await save(m.id, { analysis, status: "failed" });
          throw new Error(`Image judged unsuitable for 3D reconstruction: ${analysis.suitability.reason}`);
        }
        await save(m.id, { analysis, status: "analyzed" }); m.analysis = analysis;
        setStep("analyze", { state: "done", detail: `${analysis?.identification?.workType ?? "object"} · ${analysis?.complexity ?? "?"} · ${analysis?.components?.length ?? 0} parts` });
      }
      if (!m.code) {
        setStep("build", { state: "running" });
        const out = await stream({ action: "build", image: m.reference, analysis: m.analysis, notes: m.notes }, setLive, ac.signal);
        const code = fenced(out, "js");
        if (!code) throw new Error("Build returned no code block");
        await save(m.id, { code, status: "built" }); m.code = code;
        setStep("build", { state: "done", detail: `${code.split("\n").length} lines` });
      }
      if (!(await loadOrFix(m, passRef, ac.signal))) throw new Error("Model still fails to run after the fix budget — see the viewer error.");

      let fb = opts.feedback;
      const budget = opts.extraPasses ?? passes;
      for (let i = 0; i < budget && passRef.n < passRef.max; i++) {
        passRef.n++;
        const { review, newCode } = await refinePass(m, passRef.n, ac.signal, { feedback: fb });
        fb = undefined;
        if (!newCode) break; // continue / stop
        if (!(await loadOrFix(m, passRef, ac.signal))) throw new Error("Refined model fails to run — see the viewer error.");
        if (review.action === "continue") break;
      }
      // fresh thumbnail of the final model
      const [thumb] = await rt.capture([viewsFor(m.analysis)[0]], 512);
      if (thumb) await save(m.id, { thumbnail: thumb });
    } catch (e: any) {
      if (e?.name !== "AbortError") setErr(e?.message ?? String(e));
      setSteps((s) => s.map((x) => (x.state === "running" ? { ...x, state: "error" } : x)));
    } finally {
      setRunning(false); abortRef.current = null;
    }
  };

  const create = async () => {
    if (!draft.reference) return;
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase.from("marketing_3d_models").insert({
      name: draft.name.trim() || "Untitled model", notes: draft.notes.trim() || null, reference: draft.reference, created_by: user?.id,
    }).select("*").single();
    if (error) { setErr(error.message); return; }
    const m = data as Model3D;
    setModel(m); setStats(null); setViewerError(null); setDraft({ reference: null, name: "", notes: "" });
    qc.invalidateQueries({ queryKey: ["marketing-3d-models"] });
    run({ ...m, reviews: [] });
  };

  const remove = async (id: string) => {
    if (!window.confirm("Delete this model?")) return;
    await supabase.from("marketing_3d_models").delete().eq("id", id);
    if (model?.id === id) setModel(null);
    qc.invalidateQueries({ queryKey: ["marketing-3d-models"] });
  };

  const onFile = async (f?: File | null) => {
    if (!f || !f.type.startsWith("image/")) return;
    try {
      const reference = await fileToReference(f);
      setModel(null);
      setDraft((d) => ({ ...d, reference, name: d.name || f.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ") }));
    } catch (e: any) { setErr(e.message); }
  };

  const exportGlb = async () => {
    try { download(`${slug(model!.name)}.glb`, new Blob([await rt.exportGlb()], { type: "model/gltf-binary" })); }
    catch (e: any) { setErr(e.message); }
  };
  const exportPng = async () => {
    const [img] = await rt.capture([viewsFor(model?.analysis)[0]], 2048);
    if (img) download(`${slug(model!.name)}.jpg`, await (await fetch(img)).blob());
  };

  const reviews = model?.reviews ?? [];
  const lastReview = reviews[reviews.length - 1];

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <div className="p-4 sm:p-6 max-w-[1500px] mx-auto animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <Link to="/marketing" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-1">
            <ArrowLeft className="w-3 h-3" /> Marketing
          </Link>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Box className="w-5 h-5" style={{ color: palette.accent }} /> 3D Model Builder
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Image → img2threejs → procedural Three.js model. Approximate from a single view; hidden sides are inferred.
          </p>
        </div>
        <button
          onClick={() => { if (!running) { setModel(null); setSteps([]); setErr(null); fileRef.current?.click(); } }}
          disabled={running}
          className="flex items-center gap-2 text-xs bg-primary text-primary-foreground rounded-lg px-3 py-2 hover:bg-primary/90 disabled:opacity-50"
        >
          <Plus className="w-3.5 h-3.5" /> New model
        </button>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)_340px] gap-4">
        {/* library */}
        <div className="rounded-xl border border-border bg-card/50 p-3 lg:max-h-[calc(100vh-180px)] overflow-y-auto">
          <div className="text-xs uppercase tracking-wider font-semibold text-muted-foreground mb-2">Library</div>
          {list.isLoading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
          {list.data?.length === 0 && <div className="text-xs text-muted-foreground">No models yet.</div>}
          <div className="flex lg:flex-col gap-2 overflow-x-auto">
            {list.data?.map((m) => (
              <button
                key={m.id}
                onClick={() => open(m.id)}
                className={`group relative shrink-0 w-40 lg:w-full text-left rounded-lg border p-1.5 transition-colors ${
                  model?.id === m.id ? "border-primary bg-primary/10" : "border-border hover:border-muted-foreground/40"
                }`}
              >
                <div className="aspect-square rounded-md bg-muted/30 overflow-hidden mb-1.5 flex items-center justify-center">
                  {m.thumbnail ? <img src={m.thumbnail} alt="" className="w-full h-full object-cover" /> : <Box className="w-6 h-6 text-muted-foreground" />}
                </div>
                <div className="text-xs font-medium truncate">{m.name}</div>
                <div className="text-[11px] text-muted-foreground flex justify-between">
                  <span>{m.status}</span>
                  <span style={{ color: scoreColour(m.fidelity) }}>{pct(m.fidelity)}</span>
                </div>
                <span
                  role="button"
                  onClick={(e) => { e.stopPropagation(); remove(m.id); }}
                  className="absolute top-2 right-2 p-1 rounded bg-black/60 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-400"
                >
                  <Trash2 className="w-3 h-3" />
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* viewer */}
        <div className="rounded-xl border border-border bg-card/50 overflow-hidden flex flex-col min-h-[480px] lg:h-[calc(100vh-180px)]">
          <div className="relative flex-1 min-h-[420px]">
            <iframe
              ref={rt.frameRef}
              src="/img2three-runtime.html"
              sandbox="allow-scripts"
              title="3D viewer"
              className="absolute inset-0 w-full h-full border-0"
            />
            {!model && (
              <div
                data-local-dropzone
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setDragOver(false); onFile(e.dataTransfer.files?.[0]); }}
                className={`absolute inset-0 flex items-center justify-center p-6 bg-background/85 backdrop-blur-sm transition-colors ${dragOver ? "bg-primary/10" : ""}`}
              >
                {draft.reference ? (
                  <div className="w-full max-w-md flex flex-col gap-3">
                    <img src={draft.reference} alt="reference" className="max-h-64 object-contain rounded-lg border border-border bg-white" />
                    <input
                      value={draft.name}
                      onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                      placeholder="Model name"
                      className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
                    />
                    <textarea
                      value={draft.notes}
                      onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                      placeholder="Notes (optional) — what the object is, real size, what matters most, what to ignore"
                      rows={3}
                      className="rounded-lg border border-border bg-background px-3 py-2 text-sm resize-none"
                    />
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-muted-foreground">Refine passes</span>
                      {[0, 1, 2, 3].map((n) => (
                        <button key={n} onClick={() => setPasses(n)}
                          className={`w-7 h-7 rounded-md border ${passes === n ? "border-primary bg-primary/15 text-foreground" : "border-border text-muted-foreground"}`}>
                          {n}
                        </button>
                      ))}
                      <span className="ml-auto flex gap-2">
                        <button onClick={() => setDraft({ reference: null, name: "", notes: "" })} className="px-3 py-2 rounded-lg text-muted-foreground hover:text-foreground">Cancel</button>
                        <button onClick={create} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90">
                          <Play className="w-3.5 h-3.5" /> Build model
                        </button>
                      </span>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => fileRef.current?.click()} className="flex flex-col items-center gap-3 text-muted-foreground hover:text-foreground">
                    <div className="w-16 h-16 rounded-2xl border-2 border-dashed border-current flex items-center justify-center"><Upload className="w-7 h-7" /></div>
                    <div className="text-sm font-medium">Drop a product photo or click to upload</div>
                    <div className="text-xs max-w-xs text-center">One clear object, plain background, ¾ view works best. Each build takes a few minutes.</div>
                  </button>
                )}
              </div>
            )}
            {viewerError && (
              <div className="absolute left-3 right-3 bottom-3 rounded-lg bg-red-950/90 border border-red-800 p-3 text-xs text-red-200 whitespace-pre-wrap max-h-32 overflow-auto">
                <strong>Model code error:</strong> {viewerError}
              </div>
            )}
            {rt.picked && !viewerError && (
              <div className="absolute right-3 top-3 rounded-md bg-black/70 px-2 py-1 text-xs text-white">{rt.picked}</div>
            )}
          </div>
          {model && (
            <div className="flex flex-wrap items-center gap-2 border-t border-border p-2 text-xs">
              <button onClick={() => setAutoRotate((v) => !v)} className={`flex items-center gap-1 px-2 py-1.5 rounded-md ${autoRotate ? "bg-primary/15 text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                <RotateCw className="w-3.5 h-3.5" /> Spin
              </button>
              <button onClick={() => rt.send({ type: "reset" })} className="flex items-center gap-1 px-2 py-1.5 rounded-md text-muted-foreground hover:text-foreground">
                <Maximize2 className="w-3.5 h-3.5" /> Reset view
              </button>
              <label className="flex items-center gap-2 px-2 text-muted-foreground">
                Explode
                <input type="range" min={0} max={1} step={0.01} value={explode} onChange={(e) => setExplode(+e.target.value)} className="w-24" />
              </label>
              {stats && <span className="text-muted-foreground">{stats.parts.length} meshes · {stats.triangles.toLocaleString()} tris</span>}
              <span className="ml-auto flex gap-1">
                <button onClick={() => setShowCode((v) => !v)} disabled={!model.code} className="flex items-center gap-1 px-2 py-1.5 rounded-md text-muted-foreground hover:text-foreground disabled:opacity-40">
                  <Code2 className="w-3.5 h-3.5" /> Code
                </button>
                <button onClick={exportPng} disabled={!stats} className="flex items-center gap-1 px-2 py-1.5 rounded-md text-muted-foreground hover:text-foreground disabled:opacity-40">
                  <ImageIcon className="w-3.5 h-3.5" /> Render
                </button>
                <button onClick={exportGlb} disabled={!stats} className="flex items-center gap-1 px-2 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40">
                  <Download className="w-3.5 h-3.5" /> GLB
                </button>
              </span>
            </div>
          )}
        </div>

        {/* pipeline panel */}
        <div className="flex flex-col gap-4 lg:max-h-[calc(100vh-180px)] overflow-y-auto">
          {err && (
            <div className="rounded-xl border border-red-800 bg-red-950/40 p-3 text-xs text-red-200 flex gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" /> <span className="whitespace-pre-wrap">{err}</span>
            </div>
          )}

          {model && (
            <div className="rounded-xl border border-border bg-card/50 p-4">
              <div className="flex gap-3">
                <img src={model.reference} alt="" className="w-20 h-20 object-contain rounded-md border border-border bg-white shrink-0" />
                <div className="min-w-0">
                  <div className="font-semibold text-sm truncate">{model.name}</div>
                  {model.analysis?.identification && (
                    <div className="text-xs text-muted-foreground">
                      {model.analysis.identification.workType} · {model.analysis.complexity} · {model.analysis.components?.length ?? 0} components
                    </div>
                  )}
                  <div className="text-2xl font-bold tabular-nums mt-1" style={{ color: scoreColour(model.fidelity) }}>{pct(model.fidelity)}</div>
                  <div className="text-[11px] text-muted-foreground -mt-0.5">vision fidelity (Claude-judged)</div>
                </div>
              </div>
              {model.analysis?.suitability?.hiddenRegions?.length > 0 && (
                <div className="text-[11px] text-muted-foreground mt-3">
                  <span className="font-semibold">Inferred (not visible):</span> {model.analysis.suitability.hiddenRegions.join(", ")}
                </div>
              )}
            </div>
          )}

          {steps.length > 0 && (
            <div className="rounded-xl border border-border bg-card/50 p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs uppercase tracking-wider font-semibold text-muted-foreground">Pipeline</div>
                {running && (
                  <button onClick={() => abortRef.current?.abort()} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-red-400">
                    <Square className="w-3 h-3" /> Stop
                  </button>
                )}
              </div>
              <ul className="space-y-1.5">
                {steps.map((s) => (
                  <li key={s.key} className="flex items-start gap-2 text-xs">
                    {s.state === "done" ? <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 text-green-500" />
                      : s.state === "running" ? <Loader2 className="w-3.5 h-3.5 mt-0.5 animate-spin" style={{ color: palette.accent }} />
                      : s.state === "error" ? <AlertCircle className="w-3.5 h-3.5 mt-0.5 text-red-400" />
                      : <Circle className="w-3.5 h-3.5 mt-0.5 text-muted-foreground" />}
                    <div className="min-w-0">
                      <div>{s.label}</div>
                      {s.detail && <div className="text-muted-foreground">{s.detail}</div>}
                    </div>
                  </li>
                ))}
              </ul>
              {running && live && (
                <pre className="mt-3 max-h-40 overflow-auto rounded-md bg-black/40 p-2 text-[10px] leading-snug text-muted-foreground whitespace-pre-wrap">
                  {live.slice(-1800)}
                </pre>
              )}
            </div>
          )}

          {model?.code && (
            <div className="rounded-xl border border-border bg-card/50 p-4">
              <div className="text-xs uppercase tracking-wider font-semibold text-muted-foreground mb-2">Refine</div>
              <textarea
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder="Optional art direction — e.g. 'handle is too thin', 'logo plate should be brushed aluminium'"
                rows={3}
                disabled={running}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs resize-none"
              />
              <button
                onClick={() => { const f = feedback.trim() || undefined; setFeedback(""); run({ ...model, reviews: [...reviews] }, { feedback: f, extraPasses: 1 }); }}
                disabled={running}
                className="mt-2 w-full flex items-center justify-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />} Run a refine pass
              </button>
            </div>
          )}

          {model && !model.code && !running && (
            <button onClick={() => run({ ...model, reviews: [...reviews] })} className="flex items-center justify-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-primary text-primary-foreground">
              <Play className="w-3.5 h-3.5" /> Resume build
            </button>
          )}

          {lastReview && (
            <div className="rounded-xl border border-border bg-card/50 p-4">
              <div className="text-xs uppercase tracking-wider font-semibold text-muted-foreground mb-2">Latest review · pass {lastReview.pass}</div>
              <p className="text-xs mb-2">{lastReview.summary}</p>
              {lastReview.layerScores && (
                <div className="grid grid-cols-5 gap-1 mb-2">
                  {Object.entries(lastReview.layerScores).map(([k, v]) => (
                    <div key={k} className="text-center">
                      <div className="text-xs font-semibold tabular-nums" style={{ color: scoreColour(v) }}>{pct(v)}</div>
                      <div className="text-[10px] text-muted-foreground truncate">{k}</div>
                    </div>
                  ))}
                </div>
              )}
              {lastReview.issues && lastReview.issues.length > 0 && (
                <ul className="list-disc pl-4 space-y-1 text-[11px] text-muted-foreground">
                  {lastReview.issues.slice(0, 8).map((i, n) => <li key={n}>{i}</li>)}
                </ul>
              )}
              {reviews.length > 1 && (
                <div className="flex gap-1 mt-3 text-[10px] text-muted-foreground">
                  History: {reviews.map((r) => <span key={r.pass + r.at} style={{ color: scoreColour(r.fidelity) }}>{pct(r.fidelity)}</span>)}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {showCode && model?.code && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setShowCode(false)}>
          <div className="w-full max-w-4xl max-h-[85vh] rounded-xl border border-border bg-card flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-3 border-b border-border text-sm font-semibold">
              build(THREE, helpers) — {model.code.split("\n").length} lines
              <span className="flex gap-2">
                <button onClick={() => navigator.clipboard.writeText(model.code!)} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><Copy className="w-3.5 h-3.5" /> Copy</button>
                <button onClick={() => download(`${slug(model.name)}.js`, new Blob([model.code!], { type: "text/javascript" }))} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><Download className="w-3.5 h-3.5" /> .js</button>
              </span>
            </div>
            <pre className="flex-1 overflow-auto p-3 text-[11px] leading-snug">{model.code}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
