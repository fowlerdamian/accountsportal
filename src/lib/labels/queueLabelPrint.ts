/**
 * Send a label to the print station instead of opening a print dialog.
 *
 * Inserts a "manual" row in label_print_jobs; the /labels/station kiosk PC
 * (Chrome --kiosk-printing, LabelWriter as default printer) picks it up over
 * Realtime and prints it silently. Resolves with "printed" once the station
 * reports it, or "queued" if no station picked it up within WAIT_MS (the job
 * stays queued and prints if the station comes back within 15 minutes).
 *
 * Two kinds:
 *   guide   — Guide QR label (guide_id)          → /labels/print
 *   barcode — warehouse EAN-13 label (payload)    → /labels/print-barcode
 */
import { supabase } from "@portal/lib/supabase";
import type { BarcodeLabelInput } from "./barcodeLabelPdf";

export interface QueueLabelOptions {
  guideId: string;
  brand?: string | null;
  sku?: string | null;
  copies?: number;
}

export type QueueResult = "printed" | "queued";

const WAIT_MS = 30_000;
const POLL_MS = 1_000;

const clampCopies = (n?: number) => Math.max(1, Math.min(50, Math.floor(n ?? 1)));

async function insertAndWait(row: Record<string, unknown>): Promise<QueueResult> {
  const { data: auth } = await supabase.auth.getUser();
  const { data: job, error } = await supabase
    .from("label_print_jobs")
    .insert({ source: "manual", customer_name: auth.user?.email ?? "Staff portal", ...row })
    .select("id")
    .single();
  if (error || !job) throw new Error(error?.message ?? "Couldn't queue the label");

  const deadline = Date.now() + WAIT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    const { data } = await supabase.from("label_print_jobs").select("status, error").eq("id", job.id).maybeSingle();
    if (data?.status === "printed") return "printed";
    if (data?.status === "failed") throw new Error(data.error ?? "The print station couldn't print the label");
    if (data?.status === "cancelled") throw new Error("The label was cancelled at the print station");
  }
  return "queued";
}

/** Guide QR label. */
export function queueLabelPrint(opts: QueueLabelOptions): Promise<QueueResult> {
  return insertAndWait({
    kind: "guide",
    guide_id: opts.guideId,
    brand_key: opts.brand ?? null,
    sku: opts.sku ?? null,
    copies: clampCopies(opts.copies),
  });
}

/** Warehouse barcode label (99012 DYMO layout). */
export function queueBarcodeLabelPrint(input: BarcodeLabelInput, opts: { copies?: number } = {}): Promise<QueueResult> {
  return insertAndWait({
    kind: "barcode",
    payload: input,
    sku: input.sku.trim() || null,
    copies: clampCopies(opts.copies),
  });
}
