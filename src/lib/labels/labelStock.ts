/**
 * DYMO label stock for the browser print pipeline (/labels/print).
 *
 * The LabelWriter is a plain Windows print queue, so a label is just a page:
 * `@page { size: <w>mm <h>mm; margin: 0 }` with one label per page and every
 * coordinate in absolute millimetres. Add new stock here — the print route,
 * the layout and the on-screen preview all read from this map.
 *
 * Key = DYMO part number as printed on the roll.
 *
 * Sizes are the DYMO Windows driver's paper forms (inch-based), NOT the nominal
 * roll size: a CSS page even 0.2mm larger than the paper overflows at 100%
 * scale and Chrome pushes a blank second page onto the roll. Read them with
 * System.Drawing.Printing.PrinterSettings.PaperSizes on a PC that has the
 * queue installed.
 */

export interface Inset { top: number; right: number; bottom: number; left: number }

/**
 * The driver's printable rectangle for a form, in mm, in the landscape
 * orientation the @page uses (x runs along the long edge, from the leading
 * edge that feeds first). Read with PrinterSettings.DefaultPageSettings
 * .PrintableArea per PaperSize on the LabelWriter queue (2026-09-17).
 */
export interface Printable { x: number; y: number; w: number; h: number }

interface LabelStockDef {
  /** Human name shown in settings / pickers. */
  name: string;
  /** Driver paper size in mm — becomes the @page size. */
  width: number;
  height: number;
  printable: Printable;
  /** wide = text column on the left, QR on the right. square = QR with the code underneath. */
  layout: "wide" | "square";
  /** Font sizes in points. 0 = element not shown on this stock. */
  fonts: { scan: number; code: number; title: number };
}

export interface LabelStock extends LabelStockDef {
  /**
   * Keep-out band around the page, in mm, derived from the driver's
   * printable area — see `insetFor`.
   */
  inset: Inset;
}

/** Extra keep-out beyond the driver's figures: mm→px rounding. */
const INSET_SAFETY_MM = 0.4;
/** Quiet zone kept between the QR and the trailing edge of the printable area. */
const TRAIL_MARGIN_MM = 2;

/**
 * Keep the whole layout inside the driver's printable window IN PAGE
 * COORDINATES: x from `printable.x` to `printable.w`, y likewise.
 *
 * Which physical spot page (0,0) lands on depends on the queue's driver and
 * on the Chrome print dialog's margins setting, and prints from this office
 * have shown both: a 99012 label whose QR ran off the trailing edge (page
 * origin at the printable corner, everything 5.67mm further along) and
 * layouts that print exactly where the page says. This window is the
 * intersection of the two, so the label prints complete either way; the
 * only difference is a leading margin of ~6mm or ~11mm. Do not "reclaim"
 * the leading band without a ruler print proving which case a PC is in.
 */
function insetFor(width: number, height: number, p: Printable): Inset {
  return {
    left: p.x + INSET_SAFETY_MM,
    right: width - p.w + TRAIL_MARGIN_MM,
    top: p.y + INSET_SAFETY_MM,
    bottom: height - p.h + INSET_SAFETY_MM,
  };
}

const STOCK_DEFS = {
  /** S0722400 Large Address. */
  "99012": {
    name: "99012 — Large Address (89×36mm)",
    width: 88.39, height: 35.81, // driver form "99012 Large Address"
    printable: { x: 5.67, y: 1.02, w: 81.36, h: 33.19 },
    layout: "wide",
    fonts: { scan: 12, code: 11, title: 7 },
  },
  /** S0722370 Standard Address. */
  "99010": {
    name: "99010 — Standard Address (89×28mm)",
    width: 88.9, height: 27.69, // driver form "99010 Standard Address"
    printable: { x: 5.84, y: 1.02, w: 81.53, h: 25.32 },
    layout: "wide",
    fonts: { scan: 11, code: 10, title: 0 },
  },
  /** S0722540 Multi-Purpose. */
  "11354": {
    name: "11354 — Multi-Purpose (57×32mm)",
    width: 57.15, height: 31.75, // driver form "11354 Multi-Purpose"
    printable: { x: 1.52, y: 1.02, w: 55.12, h: 28.7 },
    layout: "wide",
    fonts: { scan: 9, code: 8.5, title: 0 },
  },
  /** US part number for the same 57×32 roll — brands.dymo_label_size may hold either. */
  "30334": {
    name: "30334 — Multi-Purpose (57×32mm)",
    width: 57.15, height: 31.75, // driver form "30334 2-1/4 in x 1-1/4 in"
    printable: { x: 1.52, y: 1.02, w: 55.12, h: 28.7 },
    layout: "wide",
    fonts: { scan: 9, code: 8.5, title: 0 },
  },
  /** Square — QR with the code underneath. */
  "30332": {
    name: "30332 — Square (25×25mm)",
    width: 25.4, height: 25.4, // driver form "30332 1 in x 1 in"
    printable: { x: 2.37, y: 1.02, w: 21.51, h: 22.94 },
    layout: "square",
    fonts: { scan: 0, code: 6.5, title: 0 },
  },
} as const satisfies Record<string, LabelStockDef>;

export type LabelStockKey = keyof typeof STOCK_DEFS;

export const LABEL_STOCK: Record<LabelStockKey, LabelStock> = Object.fromEntries(
  (Object.keys(STOCK_DEFS) as LabelStockKey[]).map(key => {
    const def = STOCK_DEFS[key];
    return [key, { ...def, inset: insetFor(def.width, def.height, def.printable) }];
  }),
) as Record<LabelStockKey, LabelStock>;

export const DEFAULT_LABEL_STOCK: LabelStockKey = "99012";

export const LABEL_STOCK_OPTIONS = (Object.keys(LABEL_STOCK) as LabelStockKey[]).map(value => ({ value, label: LABEL_STOCK[value].name }));

/** Normalise a stored / query-string stock key; unknown values fall back to 99012. */
export function resolveLabelStock(key: string | null | undefined): LabelStockKey {
  return key && key in LABEL_STOCK ? (key as LabelStockKey) : DEFAULT_LABEL_STOCK;
}

// ---------------------------------------------------------------------------
// Layout — millimetre boxes, origin top-left of the label.

export interface Box { x: number; y: number; w: number; h: number }

export interface LabelLayout {
  stock: LabelStockKey;
  spec: LabelStock;
  /** Logo box, absent when there is no logo or the stock has no room for one. */
  logo?: Box;
  /** "SCAN HERE FOR INSTRUCTIONS" box, absent on the square stock. */
  scan?: Box;
  /** Product code (+ title where the stock has a title font). */
  code: Box;
  qr: Box;
}

/** Gap between the text column and the QR, and between rows, in mm. */
const COL_GAP = 2;
const ROW_GAP = 0.6;

export function computeLabelLayout(stockIn: string | null | undefined, hasLogo: boolean): LabelLayout {
  const stock = resolveLabelStock(stockIn);
  const spec = LABEL_STOCK[stock];
  const { inset } = spec;
  const inner: Box = { x: inset.left, y: inset.top, w: spec.width - inset.left - inset.right, h: spec.height - inset.top - inset.bottom };

  if (spec.layout === "square") {
    const qrSide = inner.h * 0.76;
    return {
      stock, spec,
      qr: { x: inner.x + (inner.w - qrSide) / 2, y: inner.y, w: qrSide, h: qrSide },
      code: { x: inner.x, y: inner.y + qrSide + ROW_GAP, w: inner.w, h: inner.h - qrSide - ROW_GAP },
    };
  }

  // QR fills the height; the text column takes what is left.
  const qrSide = inner.h;
  const qr: Box = { x: inner.x + inner.w - qrSide, y: inner.y, w: qrSide, h: qrSide };
  const col = { x: inner.x, w: qr.x - COL_GAP - inner.x };
  const H = inner.h;

  // Row height shares of the column (same proportions as the .dymo builder).
  const shares = hasLogo
    ? { logo: 0.28, scan: 0.40, code: 0.32 }
    : { logo: 0, scan: 0.62, code: 0.38 };
  const rows = hasLogo ? 3 : 2;
  const usable = H - ROW_GAP * (rows - 1);

  let y = inner.y;
  const next = (share: number): Box => {
    const box = { x: col.x, y, w: col.w, h: usable * share };
    y += box.h + ROW_GAP;
    return box;
  };

  const out: LabelLayout = { stock, spec, qr, code: { x: 0, y: 0, w: 0, h: 0 } };
  if (hasLogo) out.logo = next(shares.logo);
  out.scan = next(shares.scan);
  out.code = next(shares.code);
  return out;
}

export const SCAN_LINES = ["SCAN HERE FOR", "INSTRUCTIONS"];

/** Text lines for the product-code block, given the stock's font budget. */
export function codeLines(stockIn: string | null | undefined, productCode: string, title?: string | null): { text: string; size: number; bold: boolean }[] {
  const spec = LABEL_STOCK[resolveLabelStock(stockIn)];
  const lines = [{ text: productCode.trim(), size: spec.fonts.code, bold: true }];
  const t = (title ?? "").trim();
  // The column is wide and `fitTexts` shrinks the line, so only cap runaway titles.
  if (t && spec.fonts.title > 0) lines.push({ text: t.length > 64 ? `${t.slice(0, 63)}…` : t, size: spec.fonts.title, bold: false });
  return lines;
}
