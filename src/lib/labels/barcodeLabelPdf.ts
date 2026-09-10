/**
 * TrailBait product barcode label — the fixed format, designed at 50 × 40 mm:
 *
 *   ┌──────────────────────────┐
 *   │        [TrailBait]       │  logo, centred
 *   │    CROSS BAR Z BRACKET   │  product name, bold caps
 *   │          (PAIR)          │  optional subtitle, small caps
 *   │         SKU TCZP         │  "SKU" bold + code
 *   │      ▐║▌║▐║▌║▐║▌║▐       │  EAN-13
 *   │      9 360281 002218     │  human-readable digits
 *   └──────────────────────────┘
 *
 * Every dimension is in millimetres from the label's top-left corner at the
 * 50 × 40 design size. Other stock sizes scale the whole design uniformly to
 * fit and centre it, so proportions never change. The "proof" output centres
 * the label on a larger page with crop marks (the artwork the print shop
 * expects); "trim" outputs a page the exact label size. Nothing here is
 * user-adjustable except the text and the stock size — that is the point.
 *
 * Type is League Spartan: Medium for the product name and the "SKU" word,
 * Light for everything else.
 *
 * The DYMO 99012 Large Address stock uses a second layout, copied from the
 * warehouse .dymo template (AMBHX2.dymo): title top-left, variant line under
 * it, notes + "SKU:" bottom-left, EAN-13 with its digits bottom-right, no
 * logo. Its page is the DYMO driver's paper form so it prints 1:1 on a
 * LabelWriter.
 */
import { jsPDF } from "jspdf";
import { TRAILBAIT_LOGO } from "@portal/apps/Logistics/utils/labelLogos.js";
import { LEAGUE_SPARTAN_LIGHT, LEAGUE_SPARTAN_MEDIUM } from "./leagueSpartanFonts";
import { EAN13_MODULES, ean13Bars, ean13Groups, isGuardModule, normaliseEan13 } from "./ean13";

export interface BarcodeLabelInput {
  /** Product name — printed bold, upper-cased. */
  title: string;
  /** Optional second line, e.g. "(PAIR)" — small, upper-cased. */
  subtitle: string;
  /** Product SKU — printed after a bold "SKU". */
  sku: string;
  /** EAN-13 (13 digits) or 12 digits without the check digit. */
  barcode: string;
  /** DYMO layout and .dymo file only: extra lines printed above the SKU, one per line. */
  notes?: string;
}

export type LabelOutput = "proof" | "trim";

export interface BarcodeLabelOptions {
  output: LabelOutput;
  /** Stock size from LABEL_SIZES. */
  size: LabelSizeKey;
  /** Pages in the PDF — one label per page. */
  copies: number;
}

// ─── Label stock sizes (mm) ──────────────────────────────────────────────────

/** product = the 50 × 40 design scaled to fit; dymo = the Large Address template. */
export type LabelLayout = "product" | "dymo";

export interface LabelSize { name: string; w: number; h: number; layout: LabelLayout }

export const LABEL_SIZES = {
  "50x40":      { name: "50 × 40 mm (standard)",                 w: 50,    h: 40,    layout: "product" },
  "40x30":      { name: "40 × 30 mm",                            w: 40,    h: 30,    layout: "product" },
  "60x40":      { name: "60 × 40 mm",                            w: 60,    h: 40,    layout: "product" },
  "70x50":      { name: "70 × 50 mm",                            w: 70,    h: 50,    layout: "product" },
  "100x50":     { name: "100 × 50 mm",                           w: 100,   h: 50,    layout: "product" },
  "100x70":     { name: "100 × 70 mm",                           w: 100,   h: 70,    layout: "product" },
  /** DYMO driver form "99012 Large Address" (see labelStock.ts) — nominal 89 × 36 mm. */
  "dymo-99012": { name: "DYMO 99012 Large Address (89 × 36 mm)", w: 88.39, h: 35.81, layout: "dymo" },
} as const satisfies Record<string, LabelSize>;

export type LabelSizeKey = keyof typeof LABEL_SIZES;
export const DEFAULT_LABEL_SIZE: LabelSizeKey = "50x40";
export const LABEL_SIZE_OPTIONS = (Object.keys(LABEL_SIZES) as LabelSizeKey[]).map(value => ({ value, label: LABEL_SIZES[value].name }));

export function resolveLabelSize(key: string | null | undefined): LabelSizeKey {
  return key && key in LABEL_SIZES ? (key as LabelSizeKey) : DEFAULT_LABEL_SIZE;
}

// ─── Geometry (mm, at the 50 × 40 design size) ───────────────────────────────

/** The design size — every constant below is relative to this box. */
const BASE_W = 50;
const BASE_H = 40;

/** Proof page: label + this margin each side, crop marks in the margin. */
const PROOF_MARGIN = 20;
const CROP_GAP = 5;    // crop mark starts this far from the label edge
const CROP_LEN = 10;   // and runs this long
const CROP_LINE = 0.15;

const SIDE_PAD = 3;    // text may not come closer than this to the label edge

const LOGO = { w: 17, top: 5.2 };
const TITLE = { pt: 11, baseline: 15.6 };
const SUBTITLE = { pt: 5, baseline: 18.3 };
const SKU = { pt: 6, baseline: 23.7 };
const BARCODE = { w: 24.3, top: 27, barH: 8.1, guardH: 9.9, digitPt: 5.2, digitBaseline: 37.0 };

// ─── Fonts ───────────────────────────────────────────────────────────────────

const FONT = "LeagueSpartan";
type Weight = "light" | "medium";

/** Register the embedded League Spartan faces on a fresh document. */
function registerFonts(doc: jsPDF) {
  doc.addFileToVFS("LeagueSpartan-Light.ttf", LEAGUE_SPARTAN_LIGHT);
  doc.addFont("LeagueSpartan-Light.ttf", FONT, "light");
  doc.addFileToVFS("LeagueSpartan-Medium.ttf", LEAGUE_SPARTAN_MEDIUM);
  doc.addFont("LeagueSpartan-Medium.ttf", FONT, "medium");
}

const setFont = (doc: jsPDF, weight: Weight, pt: number) => {
  doc.setFont(FONT, weight);
  doc.setFontSize(pt);
};

/** Pure validation, shared by the form and the builder. */
export function validateBarcodeLabel(input: BarcodeLabelInput): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!input.title.trim()) errors.title = "Enter the product name";
  if (!input.sku.trim()) errors.sku = "Enter the SKU";
  const ean = normaliseEan13(input.barcode);
  if (!ean.ok) errors.barcode = ean.error;
  return errors;
}

/** The 13-digit code the barcode will encode, or null when the input is invalid. */
export function barcodeValue(input: BarcodeLabelInput): string | null {
  const r = normaliseEan13(input.barcode);
  return r.ok ? r.code : null;
}

/** Shrink the current font size until `text` fits `maxW`; returns the size used. */
function fitFontSize(doc: jsPDF, text: string, startPt: number, maxW: number, floorPt: number): number {
  let pt = startPt;
  doc.setFontSize(pt);
  while (doc.getTextWidth(text) > maxW && pt > floorPt) {
    pt -= 0.25;
    doc.setFontSize(pt);
  }
  return pt;
}

function drawLabel(doc: jsPDF, ox: number, oy: number, size: LabelSize, input: BarcodeLabelInput, code: string) {
  // Uniform scale so the 50 × 40 design fits the stock, centred in it.
  const k = Math.min(size.w / BASE_W, size.h / BASE_H);
  const S = (mm: number) => mm * k;
  const x0 = ox + (size.w - BASE_W * k) / 2;
  const y0 = oy + (size.h - BASE_H * k) / 2;
  const cx = x0 + S(BASE_W) / 2;
  const maxTextW = S(BASE_W - SIDE_PAD * 2);

  doc.setTextColor(0);
  doc.setFillColor(0);

  // Logo — fixed width, aspect preserved, centred.
  const logoW = S(LOGO.w);
  const logoH = logoW * (TRAILBAIT_LOGO.h / TRAILBAIT_LOGO.w);
  doc.addImage(TRAILBAIT_LOGO.dataUri, "PNG", cx - logoW / 2, y0 + S(LOGO.top), logoW, logoH);

  // Product name.
  const title = input.title.trim().toUpperCase();
  setFont(doc, "medium", TITLE.pt * k);
  fitFontSize(doc, title, TITLE.pt * k, maxTextW, 6 * k);
  doc.text(title, cx, y0 + S(TITLE.baseline), { align: "center" });

  // Subtitle.
  const subtitle = input.subtitle.trim().toUpperCase();
  if (subtitle) {
    setFont(doc, "light", SUBTITLE.pt * k);
    fitFontSize(doc, subtitle, SUBTITLE.pt * k, maxTextW, 4 * k);
    doc.text(subtitle, cx, y0 + S(SUBTITLE.baseline), { align: "center" });
  }

  // "SKU" + code, centred as one line.
  const sku = input.sku.trim();
  setFont(doc, "medium", SKU.pt * k);
  const labelW = doc.getTextWidth("SKU ");
  setFont(doc, "light", SKU.pt * k);
  const codeW = doc.getTextWidth(sku);
  const skuX = cx - (labelW + codeW) / 2;
  setFont(doc, "medium", SKU.pt * k);
  doc.text("SKU ", skuX, y0 + S(SKU.baseline));
  setFont(doc, "light", SKU.pt * k);
  doc.text(sku, skuX + labelW, y0 + S(SKU.baseline));

  // EAN-13 bars. Guard patterns run taller, into the digit row.
  const module = S(BARCODE.w) / EAN13_MODULES;
  const bx = cx - S(BARCODE.w) / 2;
  const by = y0 + S(BARCODE.top);
  for (const [start, width] of ean13Bars(code)) {
    const h = isGuardModule(start) ? S(BARCODE.guardH) : S(BARCODE.barH);
    doc.rect(bx + start * module, by, width * module, h, "F");
  }

  // Human-readable digits: lead digit in the left quiet zone, then each digit
  // centred under its own 7-module cell so the groups read as in the example.
  const { lead, left, right } = ean13Groups(code);
  setFont(doc, "light", BARCODE.digitPt * k);
  const dy = y0 + S(BARCODE.digitBaseline);
  doc.text(lead, bx - module * 1.5, dy, { align: "right" });
  for (let i = 0; i < 6; i++) {
    doc.text(left[i], bx + (3 + 7 * i + 3.5) * module, dy, { align: "center" });
    doc.text(right[i], bx + (50 + 7 * i + 3.5) * module, dy, { align: "center" });
  }
}

// ─── DYMO Large Address layout (mm, from AMBHX2.dymo, inches × 25.4) ────────

const DYMO = {
  title:    { x: 5.85, y: 1.70,  w: 80.3, h: 10.49, pt: 16, floorPt: 9 },
  subtitle: { x: 5.67, y: 10.22, w: 80.5, h: 7.76,  pt: 16, floorPt: 8 },
  /** Notes + SKU lines, bottom-anchored beside the barcode. */
  notes:    { x: 5.85, y: 15.35, w: 26.1, h: 16.6,  pt: 10, floorPt: 6, lineH: 4.2 },
  /** EAN-13 centred in the template's barcode box; bars, then guard bars reaching into the digit row. */
  barcode:  { x: 33.5, y: 21.56, w: 48.8, h: 11.03, barH: 7.8, guardH: 9.4, digitPt: 7, digitBaseline: 10.5, maxModule: 0.33 },
};

/** Baseline that vertically centres capitals of `pt` in a box. */
const middleBaseline = (y: number, h: number, pt: number) => y + h / 2 + (pt * PT_MM * 0.7) / 2;
const PT_MM = 25.4 / 72;

function drawDymoLabel(doc: jsPDF, ox: number, oy: number, input: BarcodeLabelInput, code: string) {
  doc.setTextColor(0);
  doc.setFillColor(0);

  // Title — bold, left, top.
  const title = input.title.trim();
  const T = DYMO.title;
  setFont(doc, "medium", T.pt);
  const titlePt = fitFontSize(doc, title, T.pt, T.w, T.floorPt);
  doc.text(title, ox + T.x, oy + middleBaseline(T.y, T.h, titlePt));

  // Variant line under it — light, shrinks to fit.
  const subtitle = input.subtitle.trim();
  if (subtitle) {
    const B = DYMO.subtitle;
    setFont(doc, "light", B.pt);
    const pt = fitFontSize(doc, subtitle, B.pt, B.w, B.floorPt);
    doc.text(subtitle, ox + B.x, oy + middleBaseline(B.y, B.h, pt));
  }

  // Notes then "SKU: code", bottom-left, last line sitting on the block's bottom edge.
  const N = DYMO.notes;
  const maxLines = Math.floor(N.h / N.lineH);
  const notes = (input.notes ?? "").split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  // The SKU line always prints; notes that do not fit above it are dropped from the end.
  const shown = [...notes.slice(0, maxLines - 1), `SKU: ${input.sku.trim()}`];
  let y = oy + N.y + N.h - N.pt * PT_MM * 0.25;
  for (let i = shown.length - 1; i >= 0; i--) {
    setFont(doc, "light", N.pt);
    fitFontSize(doc, shown[i], N.pt, N.w, N.floorPt);
    doc.text(shown[i], ox + N.x, y);
    y -= N.lineH;
  }

  // EAN-13, centred in its box, digits underneath as on the product label.
  const C = DYMO.barcode;
  const module = Math.min(C.maxModule, C.w / (EAN13_MODULES + 18));
  const bx = ox + C.x + (C.w - EAN13_MODULES * module) / 2;
  const by = oy + C.y;
  for (const [start, width] of ean13Bars(code)) {
    doc.rect(bx + start * module, by, width * module, isGuardModule(start) ? C.guardH : C.barH, "F");
  }
  const { lead, left, right } = ean13Groups(code);
  setFont(doc, "light", C.digitPt);
  const dy = by + C.digitBaseline;
  doc.text(lead, bx - module * 1.5, dy, { align: "right" });
  for (let i = 0; i < 6; i++) {
    doc.text(left[i], bx + (3 + 7 * i + 3.5) * module, dy, { align: "center" });
    doc.text(right[i], bx + (50 + 7 * i + 3.5) * module, dy, { align: "center" });
  }
}

function drawCropMarks(doc: jsPDF, ox: number, oy: number, size: LabelSize) {
  doc.setDrawColor(0);
  doc.setLineWidth(CROP_LINE);
  const { w, h } = size;
  for (const x of [ox, ox + w]) {
    doc.line(x, oy - CROP_GAP, x, oy - CROP_GAP - CROP_LEN);               // above
    doc.line(x, oy + h + CROP_GAP, x, oy + h + CROP_GAP + CROP_LEN);       // below
  }
  for (const y of [oy, oy + h]) {
    doc.line(ox - CROP_GAP, y, ox - CROP_GAP - CROP_LEN, y);               // left
    doc.line(ox + w + CROP_GAP, y, ox + w + CROP_GAP + CROP_LEN, y);       // right
  }
}

/** PDF page size in mm for an output style and stock size. */
export function pageSize(output: LabelOutput, sizeKey: LabelSizeKey): [number, number] {
  const { w, h } = LABEL_SIZES[sizeKey];
  return output === "proof" ? [w + PROOF_MARGIN * 2, h + PROOF_MARGIN * 2] : [w, h];
}

/**
 * Build the PDF. Throws if the input does not validate — call
 * validateBarcodeLabel first to show errors inline.
 */
export function buildBarcodeLabelPdf(input: BarcodeLabelInput, opts: BarcodeLabelOptions): jsPDF {
  const sizeKey = resolveLabelSize(opts.size);
  const size = LABEL_SIZES[sizeKey];
  const errors = validateBarcodeLabel(input);
  const firstError = Object.values(errors)[0];
  if (firstError) throw new Error(firstError);
  const code = barcodeValue(input);
  if (code === null) throw new Error("Invalid barcode");

  const [pw, ph] = pageSize(opts.output, sizeKey);
  const ox = (pw - size.w) / 2;
  const oy = (ph - size.h) / 2;
  const copies = Math.max(1, Math.min(500, Math.floor(opts.copies) || 1));

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: [pw, ph], compress: true });
  registerFonts(doc);
  for (let i = 0; i < copies; i++) {
    if (i > 0) doc.addPage([pw, ph], "landscape");
    if (opts.output === "proof") drawCropMarks(doc, ox, oy, size);
    if (size.layout === "dymo") drawDymoLabel(doc, ox, oy, input, code);
    else drawLabel(doc, ox, oy, size, input, code);
  }
  return doc;
}

/** File name like `label-TCZP-9360281002218.pdf`. */
export function barcodeLabelFileName(input: BarcodeLabelInput): string {
  const sku = input.sku.trim().replace(/[^\w-]+/g, "_") || "label";
  return `label-${sku}-${barcodeValue(input) ?? "barcode"}.pdf`;
}
