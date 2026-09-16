/**
 * Print DYMO labels through the browser print pipeline without leaving the
 * current screen.
 *
 * Loads a label render route in a hidden same-origin iframe, waits for the
 * route to post `labels:ready` (data fetched, barcodes rendered, logos
 * loaded), then calls print() on the iframe window. The user picks the
 * LabelWriter queue in Chrome's print dialog once (scale 100%, margins None);
 * Chrome remembers the choice per destination.
 *
 * Two routes speak this protocol:
 *   /labels/print          — Guide QR labels by instruction_sets id (printLabels)
 *   /labels/print-barcode  — warehouse product barcode label (printBarcodeLabel)
 */
import type { BarcodeLabelInput } from "./barcodeLabelPdf";
import { NO_BARCODE_LOGO, resolveBarcodeLogo } from "./barcodeLogos";

export interface PrintLabelsOptions {
  /** instruction_sets ids to print, one label per id. */
  ids: string[];
  /** Brand key whose domain the QR should point at; defaults to the first brand each guide is published on. */
  brand?: string | null;
  /** Logo key from LABEL_LOGOS or "none"; overrides each guide's own label logo (instruction_sets.label_logo) for this job. */
  logo?: string | null;
  /** DYMO part number from LABEL_STOCK; defaults to the brand's dymo_label_size. */
  stock?: string | null;
  /** Copies of each label. */
  copies?: number;
}

export const LABEL_PRINT_PATH = "/labels/print";
export const BARCODE_LABEL_PRINT_PATH = "/labels/print-barcode";

export type LabelPrintMessage =
  | { type: "labels:ready"; count: number }
  | { type: "labels:error"; message: string };

export function labelPrintUrl(opts: PrintLabelsOptions): string {
  const q = new URLSearchParams();
  q.set("ids", opts.ids.join(","));
  if (opts.brand) q.set("brand", opts.brand);
  if (opts.logo) q.set("logo", opts.logo);
  if (opts.stock) q.set("stock", opts.stock);
  if (opts.copies && opts.copies > 1) q.set("copies", String(opts.copies));
  return `${LABEL_PRINT_PATH}?${q.toString()}`;
}

export interface PrintBarcodeLabelOptions {
  /** Copies of the label (one per printed page). */
  copies?: number;
}

/** Query string the barcode print route reads back with `barcodeLabelFromParams`. */
export function barcodeLabelPrintUrl(input: BarcodeLabelInput, opts: PrintBarcodeLabelOptions = {}): string {
  const q = new URLSearchParams();
  q.set("title", input.title.trim());
  if (input.subtitle.trim()) q.set("subtitle", input.subtitle.trim());
  q.set("sku", input.sku.trim());
  q.set("barcode", input.barcode.trim());
  if (input.notes?.trim()) q.set("notes", input.notes.trim());
  const logo = resolveBarcodeLogo(input.logo);
  if (logo !== NO_BARCODE_LOGO) q.set("logo", logo);
  if (opts.copies && opts.copies > 1) q.set("copies", String(opts.copies));
  return `${BARCODE_LABEL_PRINT_PATH}?${q.toString()}`;
}

export function barcodeLabelFromParams(params: URLSearchParams): BarcodeLabelInput {
  return {
    title: params.get("title") ?? "",
    subtitle: params.get("subtitle") ?? "",
    sku: params.get("sku") ?? "",
    barcode: params.get("barcode") ?? "",
    notes: params.get("notes") ?? "",
    logo: resolveBarcodeLogo(params.get("logo")),
  };
}

const READY_TIMEOUT_MS = 20_000;
/** How long a dismissed-but-silent print dialog may keep the iframe alive before it is torn down anyway. */
const AFTERPRINT_TIMEOUT_MS = 5 * 60_000;

/**
 * Load a label render route in a hidden iframe and print it once it reports
 * ready. Resolves once the print dialog has been dismissed (printed or
 * cancelled). Rejects if the route reports an error or never becomes ready.
 */
export function printLabelRoute(url: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("aria-hidden", "true");
    iframe.title = "Label print";
    // Kept in the layout (not display:none) so Chrome lays the page out and prints it.
    Object.assign(iframe.style, {
      position: "fixed", right: "0", bottom: "0", width: "0", height: "0",
      border: "0", opacity: "0", pointerEvents: "none",
    } satisfies Partial<CSSStyleDeclaration>);

    let settled = false;
    let readyTimer = 0;
    let afterTimer = 0;

    const cleanup = () => {
      window.clearTimeout(readyTimer);
      window.clearTimeout(afterTimer);
      window.removeEventListener("message", onMessage);
      iframe.remove();
    };
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      err ? reject(err) : resolve();
    };

    const onMessage = (event: MessageEvent<LabelPrintMessage>) => {
      if (event.source !== iframe.contentWindow || event.origin !== window.location.origin) return;
      const msg = event.data;
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "labels:error") return finish(new Error(msg.message || "Label render failed"));
      if (msg.type !== "labels:ready") return;

      window.clearTimeout(readyTimer);
      const win = iframe.contentWindow;
      if (!win) return finish(new Error("Print frame was closed"));
      // Chrome blocks print() until the dialog closes, so afterprint fires
      // straight after; the timer covers browsers that never fire it.
      win.addEventListener("afterprint", () => finish(), { once: true });
      afterTimer = window.setTimeout(() => finish(), AFTERPRINT_TIMEOUT_MS);
      try {
        win.focus();
        win.print();
      } catch (e: any) {
        finish(new Error(e?.message || "print() failed"));
      }
    };

    window.addEventListener("message", onMessage);
    readyTimer = window.setTimeout(() => finish(new Error("Label print timed out before the labels rendered")), READY_TIMEOUT_MS);
    iframe.src = url;
    document.body.appendChild(iframe);
  });
}

/** Print Guide QR labels (one per instruction_sets id). */
export function printLabels(opts: PrintLabelsOptions): Promise<void> {
  if (!opts.ids.length) return Promise.reject(new Error("Nothing to print"));
  return printLabelRoute(labelPrintUrl(opts));
}

/** Print a warehouse product barcode label on the DYMO 99012 Large Address stock. */
export function printBarcodeLabel(input: BarcodeLabelInput, opts: PrintBarcodeLabelOptions = {}): Promise<void> {
  return printLabelRoute(barcodeLabelPrintUrl(input, opts));
}
