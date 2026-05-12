/**
 * Shared helpers for the cin7-* edge functions. Pure functions only,
 * so they can be unit-tested with `deno test`.
 */

export const numOr = (v: unknown, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/**
 * Cin7 customer "Tags" field is either a string with separators or an
 * array. We treat each token as a discrete tag and look for an exact "D".
 */
export function hasDistributorTag(customer: { Tags?: unknown; Tag?: unknown } | null | undefined): boolean {
  if (!customer) return false;
  const raw = customer.Tags ?? customer.Tag ?? "";
  const list = Array.isArray(raw) ? raw : String(raw).split(/[,;|]/);
  return list.some((t: unknown) => String(t).trim().toUpperCase() === "D");
}

export async function fingerprint(text: string): Promise<string> {
  const buf  = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function cin7OrderLink(saleId: string, orderNumber: string): string {
  return `<https://inventory.dearsystems.com/Sale?ID=${saleId}|${orderNumber}>`;
}

export function formatCurrency(amount: number): string {
  return amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// Pad/truncate a string to a fixed display width (for monospace tables).
export function padTo(s: string, n: number, right = false): string {
  if (s.length === n) return s;
  if (s.length > n) return s.slice(0, n - 1) + "…";
  return right ? " ".repeat(n - s.length) + s : s + " ".repeat(n - s.length);
}

export interface StockRow {
  SKU?: string;
  ProductCode?: string;
  Name?: string;
  Available?: number;
  OnOrder?: number;
  ReorderLevel?: number;
}

const W_SKU = 22, W_NAME = 28, W_AVAIL = 5, W_ONORDER = 8, W_RE = 7;

export function renderStockTable(rows: StockRow[]): string {
  const head = [
    padTo("SKU",      W_SKU),
    padTo("Name",     W_NAME),
    padTo("Avail",    W_AVAIL,   true),
    padTo("On Order", W_ONORDER, true),
    padTo("Minimum",  W_RE,      true),
  ].join("  ");
  const sep  = "─".repeat(head.length);
  const body = rows.map((r) => [
    padTo(String(r.SKU ?? r.ProductCode ?? ""), W_SKU),
    padTo(String(r.Name ?? "Unknown"),          W_NAME),
    padTo(String(r.Available ?? 0),             W_AVAIL,   true),
    padTo(String(r.OnOrder ?? 0),               W_ONORDER, true),
    padTo(String(r.ReorderLevel ?? 0),          W_RE,      true),
  ].join("  ")).join("\n");
  return "```\n" + head + "\n" + sep + "\n" + body + "\n```";
}
