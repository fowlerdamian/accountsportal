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

export interface LabelSize { name: string; w: number; h: number }

export const LABEL_SIZES = {
  "50x40":  { name: "50 × 40 mm (standard)", w: 50,  h: 40 },
  "40x30":  { name: "40 × 30 mm",            w: 40,  h: 30 },
  "60x40":  { name: "60 × 40 mm",            w: 60,  h: 40 },
  "70x50":  { name: "70 × 50 mm",            w: 70,  h: 50 },
  "100x50": { name: "100 × 50 mm",           w: 100, h: 50 },
  "100x70": { name: "100 × 70 mm",           w: 100, h: 70 },
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
  const errors = validateBarcodeLabel(input);
  const firstError = Object.values(errors)[0];
  if (firstError) throw new Error(firstError);
  const ean = normaliseEan13(input.barcode);
  if (!ean.ok) throw new Error(ean.error);

  const sizeKey = resolveLabelSize(opts.size);
  const size = LABEL_SIZES[sizeKey];
  const [pw, ph] = pageSize(opts.output, sizeKey);
  const ox = (pw - size.w) / 2;
  const oy = (ph - size.h) / 2;
  const copies = Math.max(1, Math.min(500, Math.floor(opts.copies) || 1));

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: [pw, ph], compress: true });
  registerFonts(doc);
  for (let i = 0; i < copies; i++) {
    if (i > 0) doc.addPage([pw, ph], "landscape");
    if (opts.output === "proof") drawCropMarks(doc, ox, oy, size);
    drawLabel(doc, ox, oy, size, input, ean.code);
  }
  return doc;
}

/** File name like `label-TCZP-9360281002218.pdf`. */
export function barcodeLabelFileName(input: BarcodeLabelInput): string {
  const ean = normaliseEan13(input.barcode);
  const sku = input.sku.trim().replace(/[^\w-]+/g, "_") || "label";
  return `label-${sku}-${ean.ok ? ean.code : "barcode"}.pdf`;
}
