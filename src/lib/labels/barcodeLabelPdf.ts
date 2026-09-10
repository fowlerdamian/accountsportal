/**
 * TrailBait product barcode label — the fixed 50 × 40 mm format:
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
 * Every dimension is in millimetres from the label's top-left corner. The
 * "proof" output centres the label on a larger page with crop marks (the
 * artwork the print shop expects); "trim" outputs a page the exact label size.
 * Nothing here is user-adjustable except the text — that is the point.
 */
import { jsPDF } from "jspdf";
import { TRAILBAIT_LOGO } from "@portal/apps/Logistics/utils/labelLogos.js";
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
  /** Pages in the PDF — one label per page. */
  copies: number;
}

// ─── Geometry (mm) ───────────────────────────────────────────────────────────

export const LABEL_W = 50;
export const LABEL_H = 40;

/** Proof page: label + this margin each side, crop marks in the margin. */
const PROOF_MARGIN = 20;
const CROP_GAP = 5;    // crop mark starts this far from the label edge
const CROP_LEN = 10;   // and runs this long
const CROP_LINE = 0.15;

const SIDE_PAD = 3;    // text may not come closer than this to the label edge

const LOGO = { w: 17, top: 5.2 };
const TITLE = { pt: 10, baseline: 15.6 };
const SUBTITLE = { pt: 5, baseline: 18.3 };
const SKU = { pt: 6, baseline: 23.7 };
const BARCODE = { w: 24.3, top: 27, barH: 8.1, guardH: 9.9, digitPt: 4.6, digitBaseline: 37.0 };

const PT_TO_MM = 25.4 / 72;

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

function drawLabel(doc: jsPDF, ox: number, oy: number, input: BarcodeLabelInput, code: string) {
  const cx = ox + LABEL_W / 2;
  const maxTextW = LABEL_W - SIDE_PAD * 2;

  doc.setTextColor(0);
  doc.setFillColor(0);

  // Logo — fixed width, aspect preserved, centred.
  const logoH = LOGO.w * (TRAILBAIT_LOGO.h / TRAILBAIT_LOGO.w);
  doc.addImage(TRAILBAIT_LOGO.dataUri, "PNG", cx - LOGO.w / 2, oy + LOGO.top, LOGO.w, logoH);

  // Product name.
  const title = input.title.trim().toUpperCase();
  doc.setFont("helvetica", "bold");
  fitFontSize(doc, title, TITLE.pt, maxTextW, 6);
  doc.text(title, cx, oy + TITLE.baseline, { align: "center" });

  // Subtitle.
  const subtitle = input.subtitle.trim().toUpperCase();
  if (subtitle) {
    doc.setFont("helvetica", "normal");
    fitFontSize(doc, subtitle, SUBTITLE.pt, maxTextW, 4);
    doc.text(subtitle, cx, oy + SUBTITLE.baseline, { align: "center" });
  }

  // "SKU" + code, centred as one line.
  const sku = input.sku.trim();
  doc.setFontSize(SKU.pt);
  doc.setFont("helvetica", "bold");
  const labelW = doc.getTextWidth("SKU ");
  doc.setFont("helvetica", "normal");
  const codeW = doc.getTextWidth(sku);
  const skuX = cx - (labelW + codeW) / 2;
  doc.setFont("helvetica", "bold");
  doc.text("SKU ", skuX, oy + SKU.baseline);
  doc.setFont("helvetica", "normal");
  doc.text(sku, skuX + labelW, oy + SKU.baseline);

  // EAN-13 bars. Guard patterns run taller, into the digit row.
  const module = BARCODE.w / EAN13_MODULES;
  const bx = cx - BARCODE.w / 2;
  const by = oy + BARCODE.top;
  for (const [start, width] of ean13Bars(code)) {
    const h = isGuardModule(start) ? BARCODE.guardH : BARCODE.barH;
    doc.rect(bx + start * module, by, width * module, h, "F");
  }

  // Human-readable digits: lead digit in the left quiet zone, then each digit
  // centred under its own 7-module cell so the groups read as in the example.
  const { lead, left, right } = ean13Groups(code);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(BARCODE.digitPt);
  const dy = oy + BARCODE.digitBaseline;
  doc.text(lead, bx - module * 1.5, dy, { align: "right" });
  for (let i = 0; i < 6; i++) {
    doc.text(left[i], bx + (3 + 7 * i + 3.5) * module, dy, { align: "center" });
    doc.text(right[i], bx + (50 + 7 * i + 3.5) * module, dy, { align: "center" });
  }
}

function drawCropMarks(doc: jsPDF, ox: number, oy: number) {
  doc.setDrawColor(0);
  doc.setLineWidth(CROP_LINE);
  const xs = [ox, ox + LABEL_W];
  const ys = [oy, oy + LABEL_H];
  for (const x of xs) {
    doc.line(x, oy - CROP_GAP, x, oy - CROP_GAP - CROP_LEN);                       // above
    doc.line(x, oy + LABEL_H + CROP_GAP, x, oy + LABEL_H + CROP_GAP + CROP_LEN);   // below
  }
  for (const y of ys) {
    doc.line(ox - CROP_GAP, y, ox - CROP_GAP - CROP_LEN, y);                       // left
    doc.line(ox + LABEL_W + CROP_GAP, y, ox + LABEL_W + CROP_GAP + CROP_LEN, y);   // right
  }
}

export function pageSize(output: LabelOutput): [number, number] {
  return output === "proof"
    ? [LABEL_W + PROOF_MARGIN * 2, LABEL_H + PROOF_MARGIN * 2]
    : [LABEL_W, LABEL_H];
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

  const [pw, ph] = pageSize(opts.output);
  const ox = (pw - LABEL_W) / 2;
  const oy = (ph - LABEL_H) / 2;
  const copies = Math.max(1, Math.min(500, Math.floor(opts.copies) || 1));

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: [pw, ph], compress: true });
  for (let i = 0; i < copies; i++) {
    if (i > 0) doc.addPage([pw, ph], "landscape");
    if (opts.output === "proof") drawCropMarks(doc, ox, oy);
    drawLabel(doc, ox, oy, input, ean.code);
  }
  return doc;
}

/** File name like `label-TCZP-9360281002218.pdf`. */
export function barcodeLabelFileName(input: BarcodeLabelInput): string {
  const ean = normaliseEan13(input.barcode);
  const sku = input.sku.trim().replace(/[^\w-]+/g, "_") || "label";
  return `label-${sku}-${ean.ok ? ean.code : "barcode"}.pdf`;
}
