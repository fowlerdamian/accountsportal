// STEP → PNG thumbnail, entirely in Node: occt-import-js (OpenCascade wasm)
// tessellates the part, then a small software rasteriser draws an isometric,
// flat-shaded view with outlines. No GPU, no SolidWorks, no PC.

import zlib from 'node:zlib'
import occtimportjs from 'occt-import-js'

const BG = [255, 255, 255]
const BODY = [184, 188, 196]  // matches the browser viewer's fallback material
const EDGE = [70, 74, 82]

let occtPromise = null
const occt = () => (occtPromise ??= occtimportjs())

/** Triangles of a STEP file as a flat Float64Array [x0,y0,z0, x1,..., x2,...] per triangle. */
export async function stepTriangles(bytes) {
  const o = await occt()
  const res = o.ReadStepFile(bytes, null)
  if (!res?.success) throw new Error('STEP could not be read')
  const out = []
  for (const m of res.meshes) {
    const pos = m.attributes.position.array
    const idx = m.index?.array
    if (idx) for (const i of idx) out.push(pos[3 * i], pos[3 * i + 1], pos[3 * i + 2])
    else for (const v of pos) out.push(v)
  }
  if (!out.length) throw new Error('STEP has no geometry')
  return Float64Array.from(out)
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const norm = (a) => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l] }

/** Isometric corner (Y-up, as SolidWorks exports) that shows the most surface. */
function pickView(tri) {
  let best = null
  for (const sx of [1, -1]) for (const sz of [1, -1]) for (const sy of [1, -1]) {
    const d = norm([sx, sy, sz])
    let seen = 0
    for (let t = 0; t < tri.length; t += 9) {
      const a = [tri[t], tri[t + 1], tri[t + 2]]
      const n = cross(sub([tri[t + 3], tri[t + 4], tri[t + 5]], a), sub([tri[t + 6], tri[t + 7], tri[t + 8]], a))
      seen += Math.abs(dot(n, d))  // projected area; the part is viewed whole either way
      // favour views that face more upward-pointing surfaces (looking down on the part)
    }
    const score = seen * (sy > 0 ? 1.0 : 0.9)
    if (!best || score > best.score) best = { d, score }
  }
  return best.d
}

/** Render triangles to a PNG Buffer (width × height), isometric, fit with a margin. */
export function renderPng(tri, width = 800, height = 450) {
  const SS = 2, W = width * SS, H = height * SS
  const d = pickView(tri)                     // from the part towards the camera
  const right = norm(cross([0, 1, 0], d))
  const up = cross(d, right)

  // project all vertices
  const n = tri.length / 3
  const sx = new Float64Array(n), sy = new Float64Array(n), sz = new Float64Array(n)
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (let i = 0; i < n; i++) {
    const p = [tri[3 * i], tri[3 * i + 1], tri[3 * i + 2]]
    sx[i] = dot(p, right); sy[i] = dot(p, up); sz[i] = dot(p, d)
    if (sx[i] < minX) minX = sx[i]; if (sx[i] > maxX) maxX = sx[i]
    if (sy[i] < minY) minY = sy[i]; if (sy[i] > maxY) maxY = sy[i]
  }
  const margin = 0.08
  const scale = Math.min(W * (1 - 2 * margin) / Math.max(maxX - minX, 1e-9), H * (1 - 2 * margin) / Math.max(maxY - minY, 1e-9))
  const ox = W / 2 - scale * (minX + maxX) / 2, oy = H / 2 + scale * (minY + maxY) / 2
  for (let i = 0; i < n; i++) { sx[i] = ox + sx[i] * scale; sy[i] = oy - sy[i] * scale }

  const depth = new Float32Array(W * H).fill(-Infinity)
  const shade = new Float32Array(W * H).fill(-1)   // -1 = background
  const light = norm([d[0] + 0.3 * up[0] - 0.25 * right[0], d[1] + 0.3 * up[1] - 0.25 * right[1], d[2] + 0.3 * up[2] - 0.25 * right[2]])

  for (let t = 0; t < n; t += 3) {
    const a = [tri[3 * t], tri[3 * t + 1], tri[3 * t + 2]]
    const fn = norm(cross(sub([tri[3 * t + 3], tri[3 * t + 4], tri[3 * t + 5]], a), sub([tri[3 * t + 6], tri[3 * t + 7], tri[3 * t + 8]], a)))
    const s = 0.35 + 0.65 * Math.abs(dot(fn, light))
    const x0 = sx[t], y0 = sy[t], z0 = sz[t], x1 = sx[t + 1], y1 = sy[t + 1], z1 = sz[t + 1], x2 = sx[t + 2], y2 = sy[t + 2], z2 = sz[t + 2]
    const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0)
    if (Math.abs(area) < 1e-12) continue
    const bx0 = Math.max(0, Math.floor(Math.min(x0, x1, x2))), bx1 = Math.min(W - 1, Math.ceil(Math.max(x0, x1, x2)))
    const by0 = Math.max(0, Math.floor(Math.min(y0, y1, y2))), by1 = Math.min(H - 1, Math.ceil(Math.max(y0, y1, y2)))
    for (let y = by0; y <= by1; y++) {
      const py = y + 0.5
      for (let x = bx0; x <= bx1; x++) {
        const px = x + 0.5
        const w0 = ((x1 - px) * (y2 - py) - (x2 - px) * (y1 - py)) / area
        const w1 = ((x2 - px) * (y0 - py) - (x0 - px) * (y2 - py)) / area
        const w2 = 1 - w0 - w1
        if (w0 < 0 || w1 < 0 || w2 < 0) continue
        const z = w0 * z0 + w1 * z1 + w2 * z2
        const k = y * W + x
        if (z > depth[k]) { depth[k] = z; shade[k] = s }
      }
    }
  }

  // outlines: silhouette + creases where depth or shade jumps between neighbours
  const zRange = (() => { let lo = Infinity, hi = -Infinity; for (const v of sz) { if (v < lo) lo = v; if (v > hi) hi = v } return Math.max(hi - lo, 1e-9) })()
  const zTol = zRange * 0.02
  const big = Buffer.alloc(W * H * 3)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const k = y * W + x, s = shade[k]
    let c = BG
    if (s >= 0) {
      let edge = false
      for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
        const nx = x + dx, ny = y + dy
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
        const j = ny * W + nx
        if (shade[j] < 0 || Math.abs(depth[j] - depth[k]) > zTol || Math.abs(shade[j] - s) > 0.12) { edge = true; break }
      }
      c = edge ? EDGE : [BODY[0] * s + 40, BODY[1] * s + 40, BODY[2] * s + 40].map(v => Math.min(255, v))
    }
    big[3 * k] = c[0]; big[3 * k + 1] = c[1]; big[3 * k + 2] = c[2]
  }

  // 2× box downsample → antialiased RGB rows with PNG filter byte 0
  const raw = Buffer.alloc((width * 3 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0
    for (let x = 0; x < width; x++) for (let ch = 0; ch < 3; ch++) {
      let sum = 0
      for (let j = 0; j < SS; j++) for (let i = 0; i < SS; i++) sum += big[((y * SS + j) * W + (x * SS + i)) * 3 + ch]
      raw[y * (width * 3 + 1) + 1 + x * 3 + ch] = Math.round(sum / (SS * SS))
    }
  }
  return encodePng(width, height, raw)
}

function encodePng(w, h, raw) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0)
    return Buffer.concat([len, td, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ])
}
