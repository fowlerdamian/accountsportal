import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@portal/lib/supabase";

// Client side of the img2threejs pipeline (Marketing → 3D Model Builder).
// • stream()  — calls the `img2threejs` edge fn and streams Claude's output as it's written.
// • useRuntime() — postMessage bridge to the sandboxed viewer (public/img2three-runtime.html).

export interface Review {
  pass: number;
  fidelity: number;
  layerScores?: Record<string, number>;
  featureScores?: { feature: string; score: number; note?: string }[];
  issues?: string[];
  action: "continue" | "refine-code" | "refine-spec" | "stop" | "runtime-fix";
  summary: string;
  feedback?: string;
  at: string;
}

export interface Model3D {
  id: string;
  name: string;
  notes: string | null;
  reference: string;
  analysis: any | null;
  code: string | null;
  thumbnail: string | null;
  reviews: Review[];
  fidelity: number | null;
  status: string;
  created_at: string;
  updated_at: string;
}

const FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/img2threejs`;
const ANON = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY;

export async function stream(
  body: Record<string, unknown>,
  onDelta: (full: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(FN_URL, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json", apikey: ANON, Authorization: `Bearer ${session?.access_token ?? ANON}` },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    const t = await res.text().catch(() => "");
    let msg = t; try { msg = JSON.parse(t).error ?? t; } catch { /* plain */ }
    throw new Error(`img2threejs ${res.status}: ${msg.slice(0, 300)}`);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let full = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    full += dec.decode(value, { stream: true });
    onDelta(full);
  }
  const err = /\[\[ERROR:(.*?)\]\]/.exec(full);
  if (err) throw new Error(`Claude stream error: ${err[1]}`);
  if (full.includes("[[STOP:max_tokens]]")) throw new Error("Claude hit its output limit before finishing — try a simpler reference or add notes narrowing the scope.");
  return full;
}

/** Last fenced block of the given language (```json / ```js). Tolerates a missing closing fence. */
export function fenced(text: string, lang: "json" | "js"): string | null {
  const langs = lang === "js" ? "(?:js|javascript)" : "json";
  const all = [...text.matchAll(new RegExp("```" + langs + "\\s*\\n([\\s\\S]*?)(?:```|$)", "g"))];
  return all.length ? all[all.length - 1][1].trim() : null;
}

export function parseJson<T = any>(text: string): T {
  const block = fenced(text, "json") ?? text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  return JSON.parse(block) as T;
}

/** Downscale a user image to a JPEG data URL (max edge px) — keeps DB rows and Claude payloads small. */
export function fileToReference(file: File, maxEdge = 1280): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, maxEdge / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, c.width, c.height); // flatten transparency
      ctx.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/jpeg", 0.9));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not read that image")); };
    img.src = url;
  });
}

// ── viewer bridge ───────────────────────────────────────────────────────────
export type LoadResult = { ok: true; parts: string[]; triangles: number } | { ok: false; error: string };

export function useRuntime() {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const pending = useRef(new Map<string, (m: any) => void>());
  const loadWaiter = useRef<((r: LoadResult) => void) | null>(null);
  const readyWaiters = useRef<(() => void)[]>([]);

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.source !== frameRef.current?.contentWindow) return;
      const m = e.data || {};
      if (m.type === "ready") { setReady(true); readyWaiters.current.splice(0).forEach((f) => f()); }
      else if (m.type === "loaded") { loadWaiter.current?.({ ok: true, parts: m.parts, triangles: m.triangles }); loadWaiter.current = null; }
      else if (m.type === "error" && !m.id) { loadWaiter.current?.({ ok: false, error: [m.message, m.stack].filter(Boolean).join("\n") }); loadWaiter.current = null; }
      else if (m.type === "pick") setPicked(m.name);
      else if (m.id && pending.current.has(m.id)) { pending.current.get(m.id)!(m); pending.current.delete(m.id); }
    };
    addEventListener("message", onMsg);
    return () => removeEventListener("message", onMsg);
  }, []);

  const whenReady = useCallback(() => new Promise<void>((r) => (ready ? r() : readyWaiters.current.push(r))), [ready]);
  const send = (msg: any, transfer?: Transferable[]) => frameRef.current?.contentWindow?.postMessage(msg, "*", transfer ?? []);
  const request = <T,>(msg: any, timeout = 30_000) => new Promise<T>((resolve, reject) => {
    const id = crypto.randomUUID();
    const t = setTimeout(() => { pending.current.delete(id); reject(new Error(`viewer ${msg.type} timed out`)); }, timeout);
    pending.current.set(id, (m) => { clearTimeout(t); resolve(m); });
    send({ ...msg, id });
  });

  const load = useCallback(async (code: string): Promise<LoadResult> => {
    await whenReady();
    setPicked(null);
    return new Promise<LoadResult>((resolve) => {
      const t = setTimeout(() => { loadWaiter.current = null; resolve({ ok: false, error: "Model code did not finish within 20 s (infinite loop or huge geometry?)" }); }, 20_000);
      loadWaiter.current = (r) => { clearTimeout(t); resolve(r); };
      send({ type: "load", code });
    });
  }, [whenReady]);

  const capture = useCallback(async (views: { yaw: number; pitch: number }[], size = 768) =>
    (await request<{ images: string[] }>({ type: "capture", views, size })).images, []);

  const exportGlb = useCallback(async () => {
    const m = await request<{ buffer?: ArrayBuffer; error?: string }>({ type: "export" }, 60_000);
    if (!m.buffer) throw new Error(m.error ?? "export failed");
    return m.buffer;
  }, []);

  return { frameRef, ready, picked, load, capture, exportGlb, send };
}
