/**
 * Print DYMO labels through the browser print pipeline without leaving the
 * current screen.
 *
 * Loads /labels/print in a hidden same-origin iframe, waits for the route to
 * post `labels:ready` (data fetched, barcodes rendered, logos loaded), then
 * calls print() on the iframe window. The user picks the LabelWriter queue in
 * Chrome's print dialog once (scale 100%, margins None); Chrome remembers the
 * choice per destination.
 */

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

const READY_TIMEOUT_MS = 20_000;
/** How long a dismissed-but-silent print dialog may keep the iframe alive before it is torn down anyway. */
const AFTERPRINT_TIMEOUT_MS = 5 * 60_000;

/**
 * Resolves once the print dialog has been dismissed (printed or cancelled).
 * Rejects if the route reports an error or never becomes ready.
 */
export function printLabels(opts: PrintLabelsOptions): Promise<void> {
  if (!opts.ids.length) return Promise.reject(new Error("Nothing to print"));

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
    iframe.src = labelPrintUrl(opts);
    document.body.appendChild(iframe);
  });
}
