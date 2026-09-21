/**
 * DOM helpers shared by the label render routes (/labels/print and
 * /labels/print-barcode): the per-stock page CSS, text shrink-to-fit, and the
 * ready/error handshake with the hidden iframe that `printLabelRoute()` opens.
 */
import type { CSSProperties } from "react";
import { LABEL_STOCK, type Box, type LabelStockKey } from "./labelStock";
import type { LabelPrintMessage } from "./printLabels";

export const mm = (n: number) => `${n.toFixed(3)}mm`;
export const abs = (b: Box): CSSProperties => ({ position: "absolute", left: mm(b.x), top: mm(b.y), width: mm(b.w), height: mm(b.h) });

/**
 * The label box is a hair smaller than the page so px rounding of the mm
 * values can never overflow the page box and feed a blank label.
 */
const PAGE_SLACK_MM = 0.3;

/** Page + label CSS for one stock. Everything else on the page is inline so nothing from the portal shell leaks in. */
export function stockCss(stock: LabelStockKey): string {
  const { width, height } = LABEL_STOCK[stock];
  return `
@page { size: ${mm(width)} ${mm(height)}; margin: 0; }
html, body, #root { margin: 0; padding: 0; height: auto; min-height: 0; background: #fff; color: #000; }
body { font-family: Arial, Helvetica, sans-serif; color: #000; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.label { position: relative; width: ${mm(width - PAGE_SLACK_MM)}; height: ${mm(height - PAGE_SLACK_MM)}; overflow: hidden; background: #fff; page-break-after: always; break-after: page; page-break-inside: avoid; break-inside: avoid; }
.label:last-child { page-break-after: auto; break-after: auto; }
.label * { box-sizing: border-box; }
/* Only the label sheet may reach the page box: portal chrome that mounts on
   every route (mention/shortcut helpers, toast + dialog portals appended to
   body) would otherwise lay out as flow content after the last label and
   push a blank page onto the roll. */
body > :not(#root), #root > :not([data-labels]) { display: none !important; }
[data-labels] { display: block; }
.fit { white-space: nowrap; overflow: hidden; line-height: 1.15; }
@media screen {
  body { background: #d4d4d4; padding: 8mm; }
  .label { margin: 0 auto 4mm; outline: 1px solid #888; }
}
`;
}

/** Shrink any `[data-fit]` text that overflows its box, down to a 4pt floor. */
export function fitTexts(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>("[data-fit]").forEach(el => {
    let size = parseFloat(getComputedStyle(el).fontSize);
    const floor = (4 * 96) / 72;
    let guard = 40;
    while (el.scrollWidth > el.clientWidth + 0.5 && size > floor && guard-- > 0) {
      size -= 0.5;
      el.style.fontSize = `${size}px`;
    }
  });
}

export function whenImagesSettled(root: HTMLElement): Promise<void> {
  const imgs = Array.from(root.querySelectorAll("img"));
  return Promise.all(imgs.map(img => img.complete ? Promise.resolve() : new Promise<void>(res => {
    img.addEventListener("load", () => res(), { once: true });
    img.addEventListener("error", () => res(), { once: true });
  }))).then(() => undefined);
}

/** True when this document is the hidden print frame rather than a stand-alone tab. */
export const inPrintFrame = () => typeof window !== "undefined" && !!window.parent && window.parent !== window;

/** Tell the opener (printLabelRoute) how the render went. No-op when opened stand-alone. */
export function postToOpener(msg: LabelPrintMessage) {
  if (inPrintFrame()) window.parent.postMessage(msg, window.location.origin);
}

/** Two animation frames — enough for layout + paint after the DOM settles. */
export const nextPaint = () => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())));
