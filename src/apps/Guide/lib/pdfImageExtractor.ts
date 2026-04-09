/**
 * PDF image extraction — Path B (vision-based).
 *
 * Renders each PDF page at 2x resolution via pdf.js, then uses canvas-based
 * edge detection and contour finding to locate step images.
 *
 * Filter: right-hand column (x > 35%), size 3–45% of page area,
 * aspect ratio 0.5–2.5, minimum 150px dimension.
 * Merge overlapping regions, sort top-to-bottom, export JPEG 92%.
 */

import * as pdfjsLib from "pdfjs-dist";

export interface ExtractedImage {
  step: number;
  url: string;       // object URL (blob)
  page: number;
  method: "cv2";
}

export interface ExtractionResult {
  success: boolean;
  method: string | null;
  count: number;
  images: ExtractedImage[];
  error?: string;
  fallback?: boolean;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  page: number;
}

// ─── Core extraction ─────────────────────────────────────────────────────────

export async function extractImagesFromPdf(
  arrayBuffer: ArrayBuffer,
): Promise<ExtractionResult> {
  try {
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const pageCount = Math.min(pdf.numPages, 30);
    const allRects: Rect[] = [];

    for (let i = 1; i <= pageCount; i++) {
      const page = await pdf.getPage(i);
      const rects = await detectImageRegions(page, i);
      allRects.push(...rects);
    }

    if (allRects.length === 0) {
      return {
        success: false, method: null, count: 0, images: [],
        error: "No step images detected in this PDF",
        fallback: true,
      };
    }

    // Re-render and crop each detected region at full quality
    const images: ExtractedImage[] = [];
    let stepNum = 1;

    for (const rect of allRects) {
      try {
        const page = await pdf.getPage(rect.page);
        const blob = await extractRegion(page, rect);
        if (blob) {
          images.push({
            step: stepNum++,
            url: URL.createObjectURL(blob),
            page: rect.page,
            method: "cv2",
          });
        }
      } catch {
        // skip failed extractions
      }
    }

    return {
      success: images.length > 0,
      method: "cv2",
      count: images.length,
      images,
      fallback: images.length === 0,
      error: images.length === 0 ? "Failed to extract detected regions" : undefined,
    };
  } catch (err: any) {
    return {
      success: false, method: null, count: 0, images: [],
      error: err.message ?? "PDF image extraction failed",
      fallback: true,
    };
  }
}

// ─── Page analysis: detect image regions ─────────────────────────────────────

async function detectImageRegions(page: any, pageNum: number): Promise<Rect[]> {
  const scale = 2;
  const viewport = page.getViewport({ scale });
  const canvas = new OffscreenCanvas(viewport.width, viewport.height);
  const ctx = canvas.getContext("2d")!;

  await page.render({ canvasContext: ctx, viewport }).promise;

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { width, height, data } = imageData;

  const pageArea = width * height;
  const minArea = pageArea * 0.03;
  const maxArea = pageArea * 0.45;
  const minDim = 150 * scale; // 150px at 1x = 300px at 2x

  // Step 1: Convert to grayscale
  const gray = new Uint8Array(width * height);
  for (let i = 0; i < gray.length; i++) {
    const p = i * 4;
    gray[i] = Math.round(data[p] * 0.299 + data[p + 1] * 0.587 + data[p + 2] * 0.114);
  }

  // Step 2: Gaussian blur (3x3 approximation)
  const blurred = gaussianBlur(gray, width, height);

  // Step 3: Sobel edge detection
  const edges = sobelEdges(blurred, width, height);

  // Step 4: Threshold edges
  const threshold = 40;
  const binary = new Uint8Array(width * height);
  for (let i = 0; i < edges.length; i++) {
    binary[i] = edges[i] > threshold ? 255 : 0;
  }

  // Step 5: Dilate to connect nearby edges (5x5)
  const dilated = dilate(binary, width, height, 3);

  // Step 6: Find connected components and their bounding boxes
  const rects = findBoundingBoxes(dilated, width, height);

  // Step 7: Filter by size, position, and aspect ratio
  const filtered = rects.filter(r => {
    const area = r.w * r.h;
    if (area < minArea || area > maxArea) return false;
    if (r.w < minDim && r.h < minDim) return false;
    // Right-hand column: left edge must be > 35% of page width
    if (r.x < width * 0.35) return false;
    // Aspect ratio 0.5 to 2.5
    const aspect = r.w / r.h;
    if (aspect < 0.5 || aspect > 2.5) return false;
    // Check the region has image-like content (high color variance)
    if (!hasImageContent(data, width, r)) return false;
    return true;
  });

  // Step 8: Merge overlapping rectangles
  const merged = mergeOverlapping(filtered);

  // Step 9: Sort top-to-bottom
  merged.sort((a, b) => a.y - b.y);

  // Tag with page number and convert back to 1x coordinates
  return merged.map(r => ({
    x: Math.round(r.x / scale),
    y: Math.round(r.y / scale),
    w: Math.round(r.w / scale),
    h: Math.round(r.h / scale),
    page: pageNum,
  }));
}

// ─── Extract a region from a page as JPEG blob ──────────────────────────────

async function extractRegion(page: any, rect: Rect): Promise<Blob | null> {
  const scale = 2;
  const viewport = page.getViewport({ scale });
  const canvas = new OffscreenCanvas(viewport.width, viewport.height);
  const ctx = canvas.getContext("2d")!;
  await page.render({ canvasContext: ctx, viewport }).promise;

  // Crop to the detected region (coordinates are in 1x, render is 2x)
  const sx = rect.x * scale;
  const sy = rect.y * scale;
  const sw = rect.w * scale;
  const sh = rect.h * scale;

  const cropCanvas = new OffscreenCanvas(sw, sh);
  const cropCtx = cropCanvas.getContext("2d")!;
  cropCtx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);

  return cropCanvas.convertToBlob({ type: "image/jpeg", quality: 0.92 });
}

// ─── Image processing helpers ────────────────────────────────────────────────

function gaussianBlur(src: Uint8Array, w: number, h: number): Uint8Array {
  const dst = new Uint8Array(w * h);
  // 3x3 Gaussian kernel: [1 2 1; 2 4 2; 1 2 1] / 16
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      dst[i] = (
        src[i - w - 1] + 2 * src[i - w] + src[i - w + 1] +
        2 * src[i - 1] + 4 * src[i] + 2 * src[i + 1] +
        src[i + w - 1] + 2 * src[i + w] + src[i + w + 1]
      ) >> 4;
    }
  }
  return dst;
}

function sobelEdges(src: Uint8Array, w: number, h: number): Uint8Array {
  const dst = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      // Sobel X
      const gx =
        -src[i - w - 1] + src[i - w + 1] +
        -2 * src[i - 1] + 2 * src[i + 1] +
        -src[i + w - 1] + src[i + w + 1];
      // Sobel Y
      const gy =
        -src[i - w - 1] - 2 * src[i - w] - src[i - w + 1] +
        src[i + w - 1] + 2 * src[i + w] + src[i + w + 1];
      dst[i] = Math.min(255, Math.round(Math.sqrt(gx * gx + gy * gy)));
    }
  }
  return dst;
}

function dilate(src: Uint8Array, w: number, h: number, radius: number): Uint8Array {
  const dst = new Uint8Array(w * h);
  for (let y = radius; y < h - radius; y++) {
    for (let x = radius; x < w - radius; x++) {
      let max = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const v = src[(y + dy) * w + (x + dx)];
          if (v > max) max = v;
        }
      }
      dst[y * w + x] = max;
    }
  }
  return dst;
}

function findBoundingBoxes(binary: Uint8Array, w: number, h: number): Rect[] {
  const rects: Rect[] = [];

  // Downsample to speed up flood fill — work in 4x4 blocks
  const bw = Math.ceil(w / 4);
  const bh = Math.ceil(h / 4);
  const blocks = new Uint8Array(bw * bh);

  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      let count = 0;
      for (let dy = 0; dy < 4 && by * 4 + dy < h; dy++) {
        for (let dx = 0; dx < 4 && bx * 4 + dx < w; dx++) {
          if (binary[(by * 4 + dy) * w + (bx * 4 + dx)] > 0) count++;
        }
      }
      blocks[by * bw + bx] = count > 2 ? 1 : 0;
    }
  }

  const blockVisited = new Uint8Array(bw * bh);

  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      const bi = by * bw + bx;
      if (blocks[bi] === 0 || blockVisited[bi]) continue;

      // BFS flood fill
      let minX = bx, maxX = bx, minY = by, maxY = by;
      const queue = [bi];
      blockVisited[bi] = 1;

      while (queue.length > 0) {
        const ci = queue.pop()!;
        const cx = ci % bw;
        const cy = Math.floor(ci / bw);
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;

        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || nx >= bw || ny < 0 || ny >= bh) continue;
          const ni = ny * bw + nx;
          if (blocks[ni] && !blockVisited[ni]) {
            blockVisited[ni] = 1;
            queue.push(ni);
          }
        }
      }

      rects.push({
        x: minX * 4,
        y: minY * 4,
        w: (maxX - minX + 1) * 4,
        h: (maxY - minY + 1) * 4,
        page: 0,
      });
    }
  }

  return rects;
}

function hasImageContent(rgba: Uint8ClampedArray, stride: number, r: Rect): boolean {
  // Sample pixels in the region and check for color variance
  // Images have diverse colors; text regions are mostly black/white
  let totalVariance = 0;
  let samples = 0;
  const step = Math.max(4, Math.floor(Math.min(r.w, r.h) / 20));

  for (let y = r.y; y < r.y + r.h && y < stride; y += step) {
    for (let x = r.x; x < r.x + r.w; x += step) {
      const p = (y * stride + x) * 4;
      const r_ = rgba[p], g = rgba[p + 1], b = rgba[p + 2];
      // Color variance: distance from grayscale
      const gray = (r_ + g + b) / 3;
      totalVariance += Math.abs(r_ - gray) + Math.abs(g - gray) + Math.abs(b - gray);
      samples++;
    }
  }

  if (samples === 0) return false;
  const avgVariance = totalVariance / samples;
  // Images typically have color variance > 5; pure text/white space is ~0
  return avgVariance > 3;
}

function mergeOverlapping(rects: Rect[]): Rect[] {
  if (rects.length <= 1) return rects;

  const merged: Rect[] = [...rects];
  let changed = true;

  while (changed) {
    changed = false;
    for (let i = 0; i < merged.length; i++) {
      for (let j = i + 1; j < merged.length; j++) {
        const a = merged[i], b = merged[j];
        // Check overlap
        if (
          a.x < b.x + b.w && a.x + a.w > b.x &&
          a.y < b.y + b.h && a.y + a.h > b.y
        ) {
          // Merge
          const nx = Math.min(a.x, b.x);
          const ny = Math.min(a.y, b.y);
          merged[i] = {
            x: nx, y: ny,
            w: Math.max(a.x + a.w, b.x + b.w) - nx,
            h: Math.max(a.y + a.h, b.y + b.h) - ny,
            page: a.page,
          };
          merged.splice(j, 1);
          changed = true;
          break;
        }
      }
      if (changed) break;
    }
  }

  return merged;
}
