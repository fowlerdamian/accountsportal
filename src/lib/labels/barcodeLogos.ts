/**
 * Logos selectable on the warehouse barcode label. Default is no logo.
 *
 * The PNGs are the same files the Guide labels use (public/label-logos, black
 * on transparent, same origin). The PDF builder needs pixel data, so
 * `loadBarcodeLogo` fetches the file once, re-encodes it through a canvas
 * (guarantees a PNG jsPDF can embed) and caches the result; the HTML print
 * route just uses the URL in an <img>.
 */

export interface BarcodeLogo {
  key: string;
  name: string;
  url: string;
  /** Very wide wordmarks (≈12:1) get the wide-logo framing: a full-width band instead of a box. */
  wide?: boolean;
  /** Fraction of the logo box the image may fill (default 1). Heavier marks sit better with some air around them. */
  scale?: number;
}

export const NO_BARCODE_LOGO = "none";
export const DEFAULT_BARCODE_LOGO = NO_BARCODE_LOGO;

export const BARCODE_LOGOS: BarcodeLogo[] = [
  { key: "trailbait",   name: "TrailBait",    url: "/label-logos/trailbait.png" },
  { key: "fleetcraft",  name: "FleetCraft",   url: "/label-logos/fleetcraft.png", wide: true },
  { key: "ultravision", name: "Ultra Vision", url: "/label-logos/ultravision.png", scale: 0.72 },
];

export const BARCODE_LOGO_OPTIONS = [
  { value: NO_BARCODE_LOGO, label: "No logo" },
  ...BARCODE_LOGOS.map(l => ({ value: l.key, label: l.name })),
];

/** Normalise a stored / query-string logo key; unknown values mean no logo. */
export function resolveBarcodeLogo(key: string | null | undefined): string {
  return key && BARCODE_LOGOS.some(l => l.key === key) ? key : NO_BARCODE_LOGO;
}

export function barcodeLogoUrl(key: string | null | undefined): string | null {
  return BARCODE_LOGOS.find(l => l.key === key)?.url ?? null;
}

/** How much of its box a logo may fill (1 = edge to edge). */
export function barcodeLogoScale(key: string | null | undefined): number {
  return BARCODE_LOGOS.find(l => l.key === key)?.scale ?? 1;
}

/** True for long, skinny wordmarks that need the wide-logo layout. */
export function isWideBarcodeLogo(key: string | null | undefined): boolean {
  return !!BARCODE_LOGOS.find(l => l.key === key)?.wide;
}

/** PNG data URI plus pixel size, ready for jsPDF addImage. */
export interface LoadedLogo { dataUri: string; w: number; h: number }

const cache = new Map<string, Promise<LoadedLogo | null>>();

/** Resolves null for "none" / unknown keys or when the image cannot be loaded (the label is then built without a logo). */
export function loadBarcodeLogo(key: string | null | undefined): Promise<LoadedLogo | null> {
  const url = barcodeLogoUrl(resolveBarcodeLogo(key));
  if (!url || typeof document === "undefined") return Promise.resolve(null);
  let p = cache.get(url);
  if (!p) {
    p = (async () => {
      try {
        const img = new Image();
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error(`Logo failed to load: ${url}`));
          img.src = url;
        });
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, img.naturalWidth);
        canvas.height = Math.max(1, img.naturalHeight);
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;
        ctx.drawImage(img, 0, 0);
        return { dataUri: canvas.toDataURL("image/png"), w: canvas.width, h: canvas.height };
      } catch {
        cache.delete(url);
        return null;
      }
    })();
    cache.set(url, p);
  }
  return p;
}
