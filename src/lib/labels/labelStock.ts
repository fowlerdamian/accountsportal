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

export interface LabelStock {
  /** Human name shown in settings / pickers. */
  name: string;
  /** Driver paper size in mm — becomes the @page size. */
  width: number;
  height: number;
  /**
   * Unprintable band the LabelWriter head cannot reach, in mm. The label
   * feeds left-edge first, so that side needs the most room.
   */
  inset: Inset;
  /** wide = text column on the left, QR on the right. square = QR with the code underneath. */
  layout: "wide" | "square";
  /** Font sizes in points. 0 = element not shown on this stock. */
  fonts: { scan: number; code: number; title: number };
}

export const LABEL_STOCK = {
  /** S0722400 Large Address. */
  "99012": {
    name: "99012 — Large Address (89×36mm)",
    width: 88.39, height: 35.81, // driver form "99012 Large Address"
    inset: { top: 2, right: 2, bottom: 2, left: 4 },
    layout: "wide",
    fonts: { scan: 9, code: 8, title: 5.5 },
  },
  /** S0722370 Standard Address. */
  "99010": {
    name: "99010 — Standard Address (89×28mm)",
    width: 88.9, height: 27.69, // driver form "99010 Standard Address"
    inset: { top: 1.5, right: 2, bottom: 1.5, left: 4 },
    layout: "wide",
    fonts: { scan: 8, code: 7, title: 0 },
  },
  /** S0722540 Multi-Purpose. */
  "11354": {
    name: "11354 — Multi-Purpose (57×32mm)",
    width: 57.15, height: 31.75, // driver form "11354 Multi-Purpose"
    inset: { top: 1.5, right: 1.5, bottom: 1.5, left: 3 },
    layout: "wide",
    fonts: { scan: 7, code: 6.5, title: 0 },
  },
  /** US part number for the same 57×32 roll — brands.dymo_label_size may hold either. */
  "30334": {
    name: "30334 — Multi-Purpose (57×32mm)",
    width: 57.15, height: 31.75, // driver form "30334 2-1/4 in x 1-1/4 in"
    inset: { top: 1.5, right: 1.5, bottom: 1.5, left: 3 },
    layout: "wide",
    fonts: { scan: 7, code: 6.5, title: 0 },
  },
  /** Square — QR with the code underneath. */
  "30332": {
    name: "30332 — Square (25×25mm)",
    width: 25.4, height: 25.4, // driver form "30332 1 in x 1 in"
    inset: { top: 1.5, right: 1.5, bottom: 1.5, left: 2.5 },
    layout: "square",
    fonts: { scan: 0, code: 5.5, title: 0 },
  },
} as const satisfies Record<string, LabelStock>;

export type LabelStockKey = keyof typeof LABEL_STOCK;

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
  if (t && spec.fonts.title > 0) lines.push({ text: t.length > 44 ? `${t.slice(0, 43)}…` : t, size: spec.fonts.title, bold: false });
  return lines;
}
