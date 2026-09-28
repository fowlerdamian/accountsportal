// img2threejs — Marketing 3D Model Builder backend.
//
// A server-side port of the img2threejs skill (~/.claude/skills/img2threejs): reference image →
// procedural, code-only Three.js model, built in stages and gated by a vision self-correction loop.
// The skill's Python forge (state gates, Divine Eye, etc.) can't run in an edge function, so the
// stage contracts are distilled into the prompts below and the browser does the rendering.
//
// Actions (POST JSON, response is a text/plain STREAM of the model's output):
//   analyze { image, name?, notes? }                         → ```json analysis+spec```
//   build   { image, analysis, notes? }                      → ```js build(THREE, helpers) body```
//   refine  { image, renders[], code, analysis, pass, feedback? }
//                                                             → ```json review``` + optional ```js code```
// `image` / `renders[]` are data URLs (jpeg/png/webp). Streaming keeps the gateway from timing out
// on long Opus generations; the client parses the fenced blocks when the stream ends.
import { resolveModel } from "../_shared/model.ts";
import { requireStaff, isStaffUser, forbidden } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// ── shared contract ─────────────────────────────────────────────────────────
const CODE_CONTRACT = `CODE CONTRACT (the browser runtime executes your code exactly like this):
  const group = new Function("THREE", "helpers", YOUR_CODE)(THREE, helpers);
So YOUR_CODE is a plain JavaScript FUNCTION BODY (no imports, no exports, no TypeScript, no async) that ends with \`return root;\` where root is a THREE.Group.
Available:
  - THREE: the full three.js r170+ namespace (MeshPhysicalMaterial, LatheGeometry, ExtrudeGeometry, TubeGeometry, CatmullRomCurve3, Shape, InstancedMesh, CanvasTexture, …).
  - helpers.rng(seed) → deterministic () => number in [0,1). Use it for ALL noise/jitter — never Math.random.
  - helpers.canvasTexture(w, h, (ctx, w, h) => void, { repeat?: [u,v], colorSpace?: "srgb"|"linear" }) → THREE.CanvasTexture (wrap = Repeat). Use for grain, roughness variation, decals, labels, painted linework.
  - helpers.RoundedBoxGeometry(width, height, depth, segments, radius) — bevelled box.
  - helpers.mergeVertices(geometry, tolerance?) and helpers.mergeGeometries(geometries[]) from BufferGeometryUtils.
Conventions (hard rules):
  - Y up, the object's front faces +Z, right-handed. A character's own left is +X. Left/right pairs are MIRRORS (negate x), never rotations.
  - Real-world proportions, then the whole model is scaled so its largest dimension ≈ 2 units, sitting on y = 0, centred on x/z. Do this at the end with a Box3.
  - root.transform scale stays 1 — never hide anything with scale.
  - Every mesh gets a meaningful \`name\` (e.g. "blade", "grip-band-3", "wheel-front") and \`userData.part\` (the component id from the spec) so the viewer can list, click and explode parts. Group sub-assemblies in named THREE.Group nodes following the spec hierarchy.
  - castShadow/receiveShadow true on meshes. Do NOT add lights, cameras, renderers, scenes, controls, ground planes or environment — the viewer owns those (studio 3-point light + neutral PMREM environment).
  - Parts that touch must physically overlap at the seam (0.5–2% of object size) — no floating parts.
  - Use MeshPhysicalMaterial/MeshStandardMaterial with sampled hex colours (comment the sampled RGB), sensible roughness/metalness, clearcoat for lacquer, and canvas-texture roughness/colour variation so no material is one flat colour.
  - Budget: ≤ 150k triangles total. Prefer InstancedMesh for repeated parts (fasteners, treads, rivets, teeth).
  - No DOM access other than document.createElement("canvas") inside helpers, no network, no timers, no globals, no eval.`;

const METHOD = `You are the img2threejs reconstruction engine: you rebuild the object in a reference photo as a CODE-ONLY procedural Three.js model. This is reconstruction-by-code — not photogrammetry, not a downloaded mesh. Sculpt in order, never one-shot a mesh.

Discipline (from the img2threejs skill):
- Observation before inference. Describe what is THERE in controlled 3D vocabulary (cuboid, lathe profile, extruded profile, swept tube, tapered sweep, chamfer, bevel radius, metalness, roughness, clearcoat, albedo). Never "nice/sleek/shiny".
- 3D object-space, not image-space: front/back/lateral/proximal/distal. A single photo is a projection — state what it hides and what you are inferring.
- Decompose macro → meso → micro. The blockout must contain every silhouette-defining macro part.
- Pick primitives by TOPOLOGY: continuous organic forms are lathes/lofts/sculpted BufferGeometry, not boxes. Revolved parts → LatheGeometry. Flat profiled plates → Shape + ExtrudeGeometry with bevel. Tubular frames → a network of straight oriented cylinders per member, not one sweep. Anything that tapers to a point → tapered sweep, not a constant-radius tube.
- Avoid the 2.5D trap: an extruded silhouette with a bevel is a slab. Parts that have a real cross-section (handles, bodies, housings, blades with a grind) need varying thickness/profile along depth.
- Trace proportions from the image with a fixed image→world mapping (e.g. X = (nx − 0.5)·SX, Y = (CY − ny)·SY) instead of eyeballing; sample colours as RGB medians of regions, never guess.
- Identity-defining details (fasteners, seams, grooves, grip ridges, logos/decals, edge wear, gloss hotspots) must be implemented — real geometry when they cast shadow or change silhouette, canvas-texture overrides when they are colour-only.
- Be honest: say when output is approximate/stylised and what a single view cannot reveal.`;

const ANALYZE_SYSTEM = `${METHOD}

STAGE 1–2: IMAGE ANALYSIS + PRE-SPEC ASSESSMENT + SCULPT SPEC. Do not write any Three.js code in this stage.

Return ONE fenced \`\`\`json block (and nothing after it) with this shape:
{
  "suitability": { "verdict": "suitable" | "suitable-with-stylisation" | "unsuitable", "reason": "…", "hiddenRegions": ["…"] },
  "identification": { "workType": "specific noun", "classification": "…", "primaryDomain": "object" | "character" | "hybrid", "confidence": 0-1 },
  "complexity": "simple" | "moderate" | "complex" | "ultra-complex",
  "referenceCamera": { "yawDeg": "photo camera azimuth around the object: 0 = looking at its front (+Z), 90 = looking at its right side (from +X), 180 = rear", "pitchDeg": "elevation: 0 = level, positive = looking down" },
  "form": { "symmetry": "bilateral|radial|asymmetric", "boundingProportions": { "width": n, "height": n, "depth": n, "unit": "relative to height=1" }, "realWorldSizeGuess": "e.g. 0.3 m long", "silhouette": "…" },
  "qualityContract": { "targetFidelity": 0-1, "mustMatch": ["identity-defining features, ≤5"], "acceptableApproximations": ["…"] },
  "components": [
    { "id": "kebab-id", "parent": "id|null", "level": "macro|meso|micro", "description": "…",
      "topologyClass": "revolved|extruded-profile|swept|tube-network|organic-continuous|boxy|instanced-repeat",
      "primitive": "LatheGeometry|ExtrudeGeometry|RoundedBox|TubeGeometry|tapered-sweep|SphereGeometry|custom BufferGeometry|InstancedMesh …",
      "dimensions": "relative sizes/positions in object space (height = 1)",
      "attachment": "<this, predicate, other> + contact type (butt|overlap|socket|embed)",
      "material": "material id", "localFeatures": ["…"] }
  ],
  "materials": [
    { "id": "…", "substance": "…", "baseColorHex": "#rrggbb", "sampledRgb": [r,g,b], "metalness": 0-1, "roughness": 0-1,
      "clearcoat": 0-1, "finish": "matte|satin|gloss|metallic|anodized|…", "variation": "texture/roughness variation to fake with canvas textures", "localOverrides": ["…"] }
  ],
  "detailInventory": [ { "detail": "…", "kind": "fastener|bevel|gloss|linework|decal|stain|groove|ridge|…", "component": "id", "implementation": "geometry|canvas-texture|material-override" } ],
  "buildPlan": ["blockout: …", "structure: …", "form: …", "material: …", "detail: …"],
  "risks": ["what will probably look wrong and why"]
}
Be thorough: a complex object should have 10–40 components across all three levels and a detail inventory scaled to its complexity.`;

const BUILD_SYSTEM = `${METHOD}

STAGE 3: BUILD. Implement the sculpt spec you are given as a single procedural Three.js factory, covering every pass in one go (blockout → structure → form → material → detail). Follow the spec's component ids, hierarchy and materials exactly; where the spec is shallow, go back to the reference image.

${CODE_CONTRACT}

Output format: first 3–8 short bullet lines of implementation notes (what primitive each macro part uses, what you approximated), then ONE fenced \`\`\`js block containing the full function body. Nothing after the block. The code must run without errors on the first try — double-check every constructor signature and every variable you reference.`;

const REFINE_SYSTEM = `${METHOD}

STAGE 4: REVIEW + SELF-CORRECTION. You get the reference photo, fresh renders of the current model from several orbit angles (the first render uses the camera angle estimated from the photo, so compare it most directly), the current code and the spec.

1. Compare render vs reference like a strict art director. Score honestly — a passing global score never excuses a wrong identity feature. Check: silhouette & proportions, part presence & placement, cross-section depth (2.5D slab trap — check the side/¾ renders), attachment (floating parts / gaps), materials & colour, identity details.
2. Decide exactly one action: "continue" (good enough — fidelity ≥ 0.85 and every must-match feature ≥ 0.8), "refine-code" (spec is sound, geometry/material implementation is wrong), "refine-spec" (a component is missing/wrong primitive/wrong proportions — fix the approach in code and say what spec decision changed), "stop" (the image cannot support more fidelity).
3. If the action is refine-*, rewrite the WHOLE function body fixing the named issues — keep what already works, change what doesn't. Never claim "done" when only "improved".

${CODE_CONTRACT}

Output format: ONE fenced \`\`\`json block:
{ "fidelity": 0-1, "layerScores": { "silhouette": 0-1, "proportion": 0-1, "structure": 0-1, "material": 0-1, "detail": 0-1 },
  "featureScores": [ { "feature": "…", "score": 0-1, "note": "…" } ],
  "issues": ["specific, with object-space location and the fix"], "action": "continue|refine-code|refine-spec|stop",
  "summary": "one or two sentences: what changed this pass and what still does not match" }
then, only if action is refine-code or refine-spec, ONE fenced \`\`\`js block with the complete revised function body. Nothing after it.`;

// ── helpers ─────────────────────────────────────────────────────────────────
type Img = { type: "image"; source: { type: "base64"; media_type: string; data: string } };

function imageBlock(dataUrl: unknown): Img {
  const m = /^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/s.exec(String(dataUrl ?? ""));
  if (!m) throw new Error("image must be a base64 data URL (jpeg/png/webp)");
  if (m[2].length > 7_000_000) throw new Error("image too large (max ~5 MB)");
  return { type: "image", source: { type: "base64", media_type: m[1], data: m[2] } };
}

const clip = (s: unknown, n: number) => String(s ?? "").slice(0, n);

// Pipe Anthropic's SSE stream to the client as plain text deltas.
function relay(upstream: Response): Response {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buf = "";
  const stream = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, ctrl) {
      buf += decoder.decode(chunk, { stream: true });
      let i: number;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const evt = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const line = evt.split("\n").find((l) => l.startsWith("data: "));
        if (!line) continue;
        try {
          const d = JSON.parse(line.slice(6));
          if (d.type === "content_block_delta" && d.delta?.type === "text_delta") ctrl.enqueue(encoder.encode(d.delta.text));
          else if (d.type === "message_delta" && d.delta?.stop_reason === "max_tokens") ctrl.enqueue(encoder.encode("\n\n[[STOP:max_tokens]]"));
          else if (d.type === "error") ctrl.enqueue(encoder.encode(`\n\n[[ERROR:${d.error?.message ?? "stream error"}]]`));
        } catch { /* partial / keep-alive */ }
      }
    },
  });
  return new Response(upstream.body!.pipeThrough(stream), {
    headers: { ...corsHeaders, "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache", "X-Accel-Buffering": "no" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const auth = await requireStaff(req, corsHeaders);
  if (!auth.ok) return auth.response;
  if (!(await isStaffUser(auth.userId))) return forbidden(corsHeaders);

  try {
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "ANTHROPIC_API_KEY not configured" }, 500);

    const body = await req.json();
    const action = String(body.action ?? "");
    let system: string;
    let content: unknown[];
    let maxTokens: number;

    if (action === "analyze") {
      system = ANALYZE_SYSTEM;
      maxTokens = 12000;
      content = [
        imageBlock(body.image),
        { type: "text", text:
          `Reference image above.${body.name ? ` Working name: ${clip(body.name, 120)}.` : ""}` +
          (body.notes ? `\nUser notes / intended use: ${clip(body.notes, 1500)}` : "\nIntended use: real-time browser marketing render (hero product view).") +
          `\n\nRun stages 1–2 and return the JSON.` },
      ];
    } else if (action === "build") {
      system = BUILD_SYSTEM;
      maxTokens = 32000;
      content = [
        imageBlock(body.image),
        { type: "text", text:
          `Sculpt spec:\n\`\`\`json\n${clip(JSON.stringify(body.analysis ?? {}), 60000)}\n\`\`\`` +
          (body.notes ? `\nUser notes: ${clip(body.notes, 1500)}` : "") +
          `\n\nWrite the factory.` },
      ];
    } else if (action === "refine") {
      const renders: unknown[] = Array.isArray(body.renders) ? body.renders.slice(0, 4) : [];
      if (!renders.length) return json({ error: "renders[] required" }, 400);
      system = REFINE_SYSTEM;
      maxTokens = 32000;
      content = [
        { type: "text", text: "REFERENCE photo:" },
        imageBlock(body.image),
        ...renders.flatMap((r, i) => [
          { type: "text", text: `RENDER ${i + 1} (${["reference-matched camera", "front (+Z)", "side (from +X)", "rear three-quarter"][i] ?? "orbit"}):` },
          imageBlock(r),
        ]),
        { type: "text", text:
          `Pass ${Number(body.pass) || 1}.\nSpec:\n\`\`\`json\n${clip(JSON.stringify(body.analysis ?? {}), 40000)}\n\`\`\`\n` +
          `Current code:\n\`\`\`js\n${clip(body.code, 120000)}\n\`\`\`` +
          (body.runtimeError ? `\nThe current code THREW at runtime: ${clip(body.runtimeError, 2000)} — fix that first.` : "") +
          (body.feedback ? `\nUser feedback for this pass (highest priority): ${clip(body.feedback, 2000)}` : "") +
          `\n\nReview and correct.` },
      ];
    } else {
      return json({ error: "action must be analyze | build | refine" }, 400);
    }

    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: await resolveModel(apiKey, "opus"),
        max_tokens: maxTokens,
        stream: true,
        system,
        messages: [{ role: "user", content }],
      }),
    });
    if (!upstream.ok || !upstream.body) {
      const t = await upstream.text().catch(() => "");
      return json({ error: `Anthropic ${upstream.status}: ${t.slice(0, 500)}` }, 502);
    }
    return relay(upstream);
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }
});
