/**
 * TrailBait product barcode label — the fixed format, designed at 50 × 40 mm:
 *
 *   ┌──────────────────────────┐
 *   │        [TrailBait]       │  optional logo, centred (see barcodeLogos.ts)
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
 * logo in the template; when one is picked it sits top-right and the title
 * shortens to make room. Its page is the DYMO driver's paper form so it
 * prints 1:1 on a LabelWriter.
 *
 * Logos are optional (default none) and come in as pixel data via
 * `BarcodeLabelOptions.logoImage` — see barcodeLogos.ts. With no logo the
 * product layout shifts its content up so it stays centred on the label.
 */
import { jsPDF } from "jspdf";
import { barcodeLogoScale, isWideBarcodeLogo, type LoadedLogo } from "./barcodeLogos";
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
  /** DYMO layout only: extra lines printed above the SKU, one per line. */
  notes?: string;
  /** Logo key from BARCODE_LOGOS, or "none" / undefined for no logo. */
  logo?: string;
}

export type LabelOutput = "proof" | "trim";

export interface BarcodeLabelOptions {
  output: LabelOutput;
  /** Stock size from LABEL_SIZES. */
  size: LabelSizeKey;
  /** Pages in the PDF — one label per page. */
  copies: number;
  /** Pixel data for `input.logo`, from loadBarcodeLogo(); null / undefined prints no logo. */
  logoImage?: LoadedLogo | null;
}

// ─── Label stock sizes (mm) ──────────────────────────────────────────────────

/** product = the 50 × 40 design scaled to fit; dymo = the Large Address template. */
export type LabelLayout = "product" | "dymo";

export interface LabelSize { name: string; w: number; h: number; layout: LabelLayout }

export const LABEL_SIZES = {
  /** DYMO driver form "99012 Large Address" (see labelStock.ts) — nominal 89 × 36 mm. */
  "dymo-99012": { name: "DYMO 99012 Large Address (89 × 36 mm)", w: 88.39, h: 35.81, layout: "dymo" },
  "50x40":      { name: "50 × 40 mm",                            w: 50,    h: 40,    layout: "product" },
  /** Landscape — the 50 × 40 design scales up to 62.5 × 50 and sits centred. */
  "70x50":      { name: "70 × 50 mm",                            w: 70,    h: 50,    layout: "product" },
} as const satisfies Record<string, LabelSize>;

export type LabelSizeKey = keyof typeof LABEL_SIZES;
export const DEFAULT_LABEL_SIZE: LabelSizeKey = "dymo-99012";
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

/**
 * Logo fits inside this box (aspect preserved), centred horizontally. The box
 * is wide so a long wordmark (FleetCraft, ≈12:1) still gets a readable
 * height; squarer logos are limited by the height and come out narrower.
 */
const LOGO = { w: 40, h: 5, top: 5.2 };
/** With no logo the text + barcode block moves up this much so it sits centred. */
const NO_LOGO_SHIFT = -5;
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

/** Size of `logo` fitted inside a w × h box, aspect preserved, shrunk by the logo's own scale (barcodeLogos.ts). */
function fitLogo(logo: LoadedLogo, w: number, h: number, logoKey?: string): { w: number; h: number } {
  const k = Math.min(w / logo.w, h / logo.h) * barcodeLogoScale(logoKey);
  return { w: logo.w * k, h: logo.h * k };
}

function drawLabel(doc: jsPDF, ox: number, oy: number, size: LabelSize, input: BarcodeLabelInput, code: string, logo: LoadedLogo | null) {
  // Uniform scale so the 50 × 40 design fits the stock, centred in it.
  const k = Math.min(size.w / BASE_W, size.h / BASE_H);
  const S = (mm: number) => mm * k;
  const x0 = ox + (size.w - BASE_W * k) / 2;
  // Everything below the logo slot moves up when there is no logo.
  const y0 = oy + (size.h - BASE_H * k) / 2 + (logo ? 0 : S(NO_LOGO_SHIFT));
  const cx = x0 + S(BASE_W) / 2;
  const maxTextW = S(BASE_W - SIDE_PAD * 2);

  doc.setTextColor(0);
  doc.setFillColor(0);

  // Logo — fitted in its box, centred both ways.
  if (logo) {
    const box = { w: S(LOGO.w), h: S(LOGO.h) };
    const fit = fitLogo(logo, box.w, box.h, input.logo);
    doc.addImage(logo.dataUri, "PNG", cx - fit.w / 2, y0 + S(LOGO.top) + (box.h - fit.h) / 2, fit.w, fit.h);
  }

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

/** Shared with the browser print route (src/pages/BarcodeLabelPrint.tsx) so the printed label matches the PDF preview. */
export const DYMO_LAYOUT = {
  title:    { x: 5.85, y: 1.70,  w: 80.3, h: 10.49, pt: 16, floorPt: 9 },
  subtitle: { x: 5.67, y: 10.22, w: 80.5, h: 7.76,  pt: 16, floorPt: 8 },
  /** Notes + SKU lines, bottom-anchored beside the barcode. */
  notes:    { x: 5.85, y: 15.35, w: 26.1, h: 16.6,  pt: 10, floorPt: 6, lineH: 4.2 },
  /** EAN-13 centred in the template's barcode box; bars, then guard bars reaching into the digit row. */
  barcode:  { x: 33.5, y: 21.56, w: 48.8, h: 11.03, barH: 7.8, guardH: 9.4, digitPt: 7, digitBaseline: 10.5, maxModule: 0.33 },
};
const DYMO = DYMO_LAYOUT;

export type DymoBarcodeBox = typeof DYMO_LAYOUT.barcode;

/**
 * DYMO layout used when a logo is picked — the warehouse BGLBDM.dymo
 * template (inches × 25.4): logo top-left, text block top-right, barcode
 * across the bottom.
 */
export const DYMO_LOGO_LAYOUT = {
  /** Logo box; the image is fitted uniformly and centred in it. */
  logo:    { x: 5.67, y: 2.6, w: 25, h: 10.5 },
  /** Title, subtitle, notes and "SKU:" lines, left-aligned, vertically centred. */
  text:    { x: 32.5, y: 2.4, w: 48.2, h: 14.6, titlePt: 12, pt: 9.5, floorPt: 6, lineH: 4.4 },
  /** Barcode across the bottom (the template's ITF-14 box, EAN-13 centred in it). */
  barcode: { x: 10.26, y: 18.8, w: 67.88, h: 13.6, barH: 8.6, guardH: 10.2, digitPt: 7, digitBaseline: 12.6, maxModule: 0.42 } as DymoBarcodeBox,
};

/**
 * Wide-logo variant for long wordmarks (FleetCraft): the logo runs as a band
 * across the top, the text block sits full-width under it, the barcode
 * across the bottom. Same page; only the boxes move.
 */
export const DYMO_WIDE_LOGO_LAYOUT = {
  logo:    { x: 5.67, y: 1.8, w: 75, h: 5 },
  text:    { x: 5.85, y: 7.2, w: 75, h: 13.2, titlePt: 12, pt: 9.5, floorPt: 6, lineH: 4.2 },
  barcode: { x: 10.26, y: 20.8, w: 67.88, h: 13.4, barH: 8.0, guardH: 9.6, digitPt: 7, digitBaseline: 12.0, maxModule: 0.42 } as DymoBarcodeBox,
};

export type DymoLogoLayout = typeof DYMO_LOGO_LAYOUT;

/** The logo layout to use for a logo key: full-width band for wide wordmarks, BGLBDM box otherwise. */
export function dymoLogoLayoutFor(logoKey: string | null | undefined): DymoLogoLayout {
  return isWideBarcodeLogo(logoKey) ? DYMO_WIDE_LOGO_LAYOUT : DYMO_LOGO_LAYOUT;
}

/** Text lines for the logo layout: title, subtitle (if any), notes that fit, then "SKU: code". */
export function dymoLogoTextLines(input: BarcodeLabelInput, layout: DymoLogoLayout = dymoLogoLayoutFor(input.logo)): { text: string; bold: boolean }[] {
  const X = layout.text;
  const maxLines = Math.floor(X.h / MIN_LINE_H);
  const notes = (input.notes ?? "").split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const head = [{ text: input.title.trim(), bold: true }];
  const subtitle = input.subtitle.trim();
  if (subtitle) head.push({ text: subtitle, bold: false });
  const tail = { text: `SKU: ${input.sku.trim()}`, bold: false };
  const room = Math.max(0, maxLines - head.length - 1);
  return [...head, ...notes.slice(0, room).map(text => ({ text, bold: false })), tail];
}

/** Smallest line pitch the text block will go to before dropping note lines (mm). */
const MIN_LINE_H = 3.0;
/** The title line is this much taller than the others. */
const TITLE_LINE_FACTOR = 1.3;

export interface DymoTextLine { text: string; bold: boolean; pt: number; h: number }

/**
 * Lines of the logo layout's text block with their font size and line height.
 * When the block is crowded (a note plus a subtitle) every line and its type
 * scale down together, like DYMO's AlwaysFit, so nothing is dropped or clipped.
 */
export function dymoLogoTextLayout(input: BarcodeLabelInput, layout: DymoLogoLayout = dymoLogoLayoutFor(input.logo)): { lines: DymoTextLine[]; height: number } {
  const X = layout.text;
  const raw = dymoLogoTextLines(input, layout);
  const units = raw.reduce((n, l) => n + (l.bold ? TITLE_LINE_FACTOR : 1), 0);
  const unit = Math.min(X.lineH, X.h / units);
  const scale = unit / X.lineH;
  const lines = raw.map(l => ({
    ...l,
    pt: (l.bold ? X.titlePt : X.pt) * scale,
    h: unit * (l.bold ? TITLE_LINE_FACTOR : 1),
  }));
  return { lines, height: lines.reduce((n, l) => n + l.h, 0) };
}

/** Lines printed in the DYMO notes block: the notes that fit, then "SKU: code" last. */
export function dymoNoteLines(input: BarcodeLabelInput): string[] {
  const N = DYMO_LAYOUT.notes;
  const maxLines = Math.floor(N.h / N.lineH);
  const notes = (input.notes ?? "").split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  // The SKU line always prints; notes that do not fit above it are dropped from the end.
  return [...notes.slice(0, maxLines - 1), `SKU: ${input.sku.trim()}`];
}

/** EAN-13 module width (mm) in a DYMO barcode box. */
export function dymoBarcodeModule(C: DymoBarcodeBox = DYMO_LAYOUT.barcode): number {
  return Math.min(C.maxModule, C.w / (EAN13_MODULES + 18));
}

/** Baseline that vertically centres capitals of `pt` in a box. */
const middleBaseline = (y: number, h: number, pt: number) => y + h / 2 + (pt * PT_MM * 0.7) / 2;
const PT_MM = 25.4 / 72;

/** EAN-13 centred in a DYMO barcode box, digits underneath as on the product label. */
function drawDymoBarcode(doc: jsPDF, ox: number, oy: number, C: DymoBarcodeBox, code: string) {
  const module = dymoBarcodeModule(C);
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

/** AMBHX2 arrangement — no logo: title / subtitle across the top, notes + SKU bottom-left, barcode bottom-right. */
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
  const shown = dymoNoteLines(input);
  let y = oy + N.y + N.h - N.pt * PT_MM * 0.25;
  for (let i = shown.length - 1; i >= 0; i--) {
    setFont(doc, "light", N.pt);
    fitFontSize(doc, shown[i], N.pt, N.w, N.floorPt);
    doc.text(shown[i], ox + N.x, y);
    y -= N.lineH;
  }

  drawDymoBarcode(doc, ox, oy, DYMO.barcode, code);
}

/** BGLBDM arrangement — with a logo: logo top-left, text block top-right, barcode across the bottom. */
function drawDymoLogoLabel(doc: jsPDF, ox: number, oy: number, input: BarcodeLabelInput, code: string, logo: LoadedLogo) {
  doc.setTextColor(0);
  doc.setFillColor(0);

  const layout = dymoLogoLayoutFor(input.logo);
  const L = layout.logo;
  const fit = fitLogo(logo, L.w, L.h, input.logo);
  doc.addImage(logo.dataUri, "PNG", ox + L.x + (L.w - fit.w) / 2, oy + L.y + (L.h - fit.h) / 2, fit.w, fit.h);

  // Text block — lines stacked and centred vertically in the box, each shrunk to fit its width.
  const X = layout.text;
  const { lines, height } = dymoLogoTextLayout(input, layout);
  let y = oy + X.y + (X.h - height) / 2;
  for (const line of lines) {
    setFont(doc, line.bold ? "medium" : "light", line.pt);
    const pt = fitFontSize(doc, line.text, line.pt, X.w, X.floorPt);
    doc.text(line.text, ox + X.x, middleBaseline(y, line.h, pt));
    y += line.h;
  }

  drawDymoBarcode(doc, ox, oy, layout.barcode, code);
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

  // jsPDF swaps the format to match the orientation, so it must follow the page shape.
  const orientation = pw >= ph ? "landscape" : "portrait";
  const doc = new jsPDF({ orientation, unit: "mm", format: [pw, ph], compress: true });
  registerFonts(doc);
  for (let i = 0; i < copies; i++) {
    if (i > 0) doc.addPage([pw, ph], orientation);
    if (opts.output === "proof") drawCropMarks(doc, ox, oy, size);
    const logo = opts.logoImage ?? null;
    if (size.layout !== "dymo") drawLabel(doc, ox, oy, size, input, code, logo);
    else if (logo) drawDymoLogoLabel(doc, ox, oy, input, code, logo);
    else drawDymoLabel(doc, ox, oy, input, code);
  }
  return doc;
}

/** File name like `label-TCZP-9360281002218.pdf`. */
export function barcodeLabelFileName(input: BarcodeLabelInput): string {
  const sku = input.sku.trim().replace(/[^\w-]+/g, "_") || "label";
  return `label-${sku}-${barcodeValue(input) ?? "barcode"}.pdf`;
}
