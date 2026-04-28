import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { X, Download, RotateCcw } from "lucide-react";

// ─── Supported formats ────────────────────────────────────────────────────────
const STL_EXTS  = ["stl"];
const OBJ_EXTS  = ["obj"];
const GLTF_EXTS = ["gltf", "glb"];
const ALL_3D    = [...STL_EXTS, ...OBJ_EXTS, ...GLTF_EXTS];

export function isCadFile(filename: string) {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return ["sldprt", "sldasm", "step", "stp", "iges", "igs", "dxf", "dwg", ...ALL_3D].includes(ext);
}

export function canPreview3D(filename: string) {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return ALL_3D.includes(ext);
}

// ─── Three.js scene helpers ───────────────────────────────────────────────────

function buildScene(canvas: HTMLCanvasElement) {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(w, h, false);
  renderer.shadowMap.enabled = true;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x111111);

  const camera = new THREE.PerspectiveCamera(45, w / h, 0.01, 10000);
  camera.position.set(0, 0, 5);

  // Lights
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const dir = new THREE.DirectionalLight(0xffffff, 1.2);
  dir.position.set(5, 10, 7);
  dir.castShadow = true;
  scene.add(dir);
  const fill = new THREE.DirectionalLight(0x8888ff, 0.4);
  fill.position.set(-5, -3, -5);
  scene.add(fill);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 0.01;
  controls.maxDistance = 5000;

  return { renderer, scene, camera, controls };
}

function fitCameraToObject(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  object: THREE.Object3D,
) {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  object.position.sub(center); // centre on origin

  const maxDim = Math.max(size.x, size.y, size.z);
  const fov = camera.fov * (Math.PI / 180);
  const dist = Math.abs(maxDim / (2 * Math.tan(fov / 2))) * 1.8;

  camera.position.set(dist * 0.6, dist * 0.4, dist);
  camera.near = dist / 100;
  camera.far  = dist * 100;
  camera.updateProjectionMatrix();

  controls.target.set(0, 0, 0);
  controls.update();
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  fileUrl:  string;
  filename: string;
  onClose:  () => void;
}

export default function CadViewer({ fileUrl, filename, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef  = useRef<ReturnType<typeof buildScene> | null>(null);
  const rafRef    = useRef<number>(0);
  const [status, setStatus] = useState<"loading" | "ready" | "error" | "unsupported">("loading");
  const [errorMsg, setErrorMsg] = useState("");

  const ext = filename.split(".").pop()?.toLowerCase() ?? "";

  useEffect(() => {
    if (!canPreview3D(filename)) { setStatus("unsupported"); return; }
    const canvas = canvasRef.current;
    if (!canvas) return;

    const s = buildScene(canvas);
    sceneRef.current = s;
    const { renderer, scene, camera, controls } = s;

    const material = new THREE.MeshPhongMaterial({
      color: 0xf3ca0f,
      specular: 0x333333,
      shininess: 40,
      side: THREE.DoubleSide,
    });

    let cancelled = false;

    async function load() {
      try {
        const resp = await fetch(fileUrl);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

        let object: THREE.Object3D | null = null;

        if (STL_EXTS.includes(ext)) {
          const buffer = await resp.arrayBuffer();
          const loader = new STLLoader();
          const geo = loader.parse(buffer);
          geo.computeVertexNormals();
          object = new THREE.Mesh(geo, material);

        } else if (OBJ_EXTS.includes(ext)) {
          const text = await resp.text();
          const loader = new OBJLoader();
          object = loader.parse(text);
          object.traverse(child => {
            if ((child as THREE.Mesh).isMesh) (child as THREE.Mesh).material = material;
          });

        } else if (GLTF_EXTS.includes(ext)) {
          const buffer = await resp.arrayBuffer();
          const loader = new GLTFLoader();
          const gltf = await new Promise<any>((res, rej) => {
            loader.parse(buffer, "", res, rej);
          });
          object = gltf.scene;
        }

        if (cancelled || !object) return;

        scene.add(object);
        fitCameraToObject(camera, controls, object);
        setStatus("ready");

        // Render loop
        const animate = () => {
          rafRef.current = requestAnimationFrame(animate);
          controls.update();
          renderer.render(scene, camera);
        };
        animate();

      } catch (err: any) {
        if (!cancelled) { setErrorMsg(err.message); setStatus("error"); }
      }
    }

    load();

    // Resize observer
    const ro = new ResizeObserver(() => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    });
    ro.observe(canvas);

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      renderer.dispose();
    };
  }, [fileUrl, filename]);

  const resetCamera = () => {
    const s = sceneRef.current;
    if (!s) return;
    const obj = s.scene.children.find(c => (c as THREE.Mesh).isMesh || c.type === "Group");
    if (obj) fitCameraToObject(s.camera, s.controls, obj);
  };

  const isUnsupported = !canPreview3D(filename);
  const isSolidworks  = ["sldprt", "sldasm"].includes(ext);

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }}
      onClick={onClose}
    >
      <div
        style={{ background: "#0a0a0a", border: "1px solid #222", borderRadius: "12px", width: "100%", maxWidth: "860px", overflow: "hidden", display: "flex", flexDirection: "column" }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", borderBottom: "1px solid #1e1e1e" }}>
          <span style={{ fontSize: "13px", fontWeight: 600, color: "#fff", fontFamily: '"JetBrains Mono", monospace', maxWidth: "60%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {filename}
          </span>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            {status === "ready" && (
              <button onClick={resetCamera} title="Reset camera" style={{ background: "none", border: "1px solid #333", borderRadius: "6px", color: "#888", cursor: "pointer", padding: "5px 8px", display: "flex", alignItems: "center" }}>
                <RotateCcw size={14} />
              </button>
            )}
            <a href={fileUrl} download={filename} style={{ background: "none", border: "1px solid #333", borderRadius: "6px", color: "#888", cursor: "pointer", padding: "5px 8px", display: "flex", alignItems: "center", textDecoration: "none" }}>
              <Download size={14} />
            </a>
            <button onClick={onClose} style={{ background: "none", border: "none", color: "#666", cursor: "pointer", padding: "4px", display: "flex", alignItems: "center" }}>
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Viewport */}
        <div style={{ position: "relative", height: "520px", background: "#111" }}>
          <canvas
            ref={canvasRef}
            style={{ width: "100%", height: "100%", display: isUnsupported ? "none" : "block", outline: "none" }}
          />

          {status === "loading" && !isUnsupported && (
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: "12px" }}>
              <div style={{ width: "28px", height: "28px", borderRadius: "50%", border: "2px solid #f3ca0f", borderTopColor: "transparent", animation: "spin 0.8s linear infinite" }} />
              <span style={{ fontSize: "12px", color: "#666", fontFamily: '"JetBrains Mono", monospace' }}>Loading model…</span>
            </div>
          )}

          {status === "error" && (
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: "8px" }}>
              <span style={{ fontSize: "13px", color: "#ff1744", fontFamily: '"JetBrains Mono", monospace' }}>Failed to load model</span>
              <span style={{ fontSize: "11px", color: "#555", fontFamily: '"JetBrains Mono", monospace' }}>{errorMsg}</span>
            </div>
          )}

          {isUnsupported && (
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: "12px", padding: "32px" }}>
              <div style={{ fontSize: "40px" }}>📐</div>
              <p style={{ fontSize: "14px", fontWeight: 600, color: "#fff", margin: 0 }}>
                {isSolidworks ? "SolidWorks file" : "Preview not available"}
              </p>
              <p style={{ fontSize: "12px", color: "#666", textAlign: "center", maxWidth: "360px", fontFamily: '"JetBrains Mono", monospace', lineHeight: 1.6, margin: 0 }}>
                {isSolidworks
                  ? "SLDPRT/SLDASM files can't be rendered natively in the browser.\nIn SolidWorks: File → Save As → STL to generate a previewable file."
                  : `${ext.toUpperCase()} files aren't supported for preview.\nSTL, OBJ, GLTF and GLB files can be previewed.`}
              </p>
              <a
                href={fileUrl}
                download={filename}
                style={{ marginTop: "8px", fontSize: "12px", fontWeight: 500, padding: "7px 16px", borderRadius: "6px", color: "#f3ca0f", border: "1px solid rgba(243,202,15,0.35)", background: "transparent", textDecoration: "none", transition: "background 120ms" }}
              >
                Download file
              </a>
            </div>
          )}

          {status === "ready" && (
            <div style={{ position: "absolute", bottom: "12px", left: "12px", fontSize: "10px", color: "#333", fontFamily: '"JetBrains Mono", monospace', pointerEvents: "none" }}>
              drag to rotate · scroll to zoom · right-drag to pan
            </div>
          )}
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
