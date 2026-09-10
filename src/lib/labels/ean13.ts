/**
 * EAN-13 encoder for the barcode label PDF (no library — the symbology is a
 * fixed 95-module pattern).
 *
 * Accepts 12 digits (check digit is computed) or 13 digits (check digit is
 * verified). UPC-A codes are EAN-13 with a leading 0, so a 12-digit UPC can be
 * entered as "0" + the 11 data digits + its check digit.
 */

/** Left-hand digit encodings — L (odd parity) and G (even parity) — and right-hand R. */
const L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
const G = ["0100111", "0110011", "0011011", "0100001", "0011101", "0111001", "0000101", "0010001", "0001001", "0010111"];
const R = ["1110010", "1100110", "1101100", "1000010", "1011100", "1001110", "1010000", "1000100", "1001000", "1110100"];

/** Parity pattern for the six left-hand digits, selected by the first (implicit) digit. */
const PARITY = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];

/** Number of modules in the symbol excluding quiet zones. */
export const EAN13_MODULES = 95;
/** Quiet zones in modules (GS1 minimum). */
export const EAN13_QUIET_LEFT = 11;
export const EAN13_QUIET_RIGHT = 7;

export function ean13CheckDigit(first12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

export type Ean13Result = { ok: true; code: string } | { ok: false; error: string };

/** Normalise user input (spaces/dashes allowed) into a valid 13-digit code, or explain why not. */
export function normaliseEan13(input: string): Ean13Result {
  const digits = input.replace(/[\s-]/g, "");
  if (!digits) return { ok: false, error: "Enter the barcode number" };
  if (!/^\d+$/.test(digits)) return { ok: false, error: "Barcode must be digits only" };
  if (digits.length === 12) return { ok: true, code: digits + ean13CheckDigit(digits) };
  if (digits.length === 13) {
    const expected = ean13CheckDigit(digits.slice(0, 12));
    if (Number(digits[12]) !== expected) {
      return { ok: false, error: `Check digit should be ${expected} (got ${digits[12]})` };
    }
    return { ok: true, code: digits };
  }
  return { ok: false, error: `Barcode must be 12 or 13 digits (got ${digits.length})` };
}

/**
 * Module pattern for a valid 13-digit code: a string of 95 "0"/"1" characters,
 * "1" = bar. Layout: start guard (3), 6 left digits (42), centre guard (5),
 * 6 right digits (42), end guard (3).
 */
export function ean13Modules(code: string): string {
  if (!/^\d{13}$/.test(code)) throw new Error("ean13Modules needs a 13-digit code");
  const parity = PARITY[Number(code[0])];
  let out = "101";
  for (let i = 1; i <= 6; i++) {
    const d = Number(code[i]);
    out += parity[i - 1] === "L" ? L[d] : G[d];
  }
  out += "01010";
  for (let i = 7; i <= 12; i++) out += R[Number(code[i])];
  out += "101";
  return out;
}

/** Bar runs as [startModule, widthModules] pairs, ready for drawing. */
export function ean13Bars(code: string): Array<[number, number]> {
  const modules = ean13Modules(code);
  const bars: Array<[number, number]> = [];
  let i = 0;
  while (i < modules.length) {
    if (modules[i] === "1") {
      let w = 1;
      while (modules[i + w] === "1") w++;
      bars.push([i, w]);
      i += w;
    } else i++;
  }
  return bars;
}

/** Module index ranges of the three guard patterns — these bars are drawn taller. */
export const EAN13_GUARDS: Array<[number, number]> = [[0, 3], [45, 50], [92, 95]];

export function isGuardModule(index: number): boolean {
  return EAN13_GUARDS.some(([a, b]) => index >= a && index < b);
}

/** Human-readable text groups: leading digit, left six, right six. */
export function ean13Groups(code: string): { lead: string; left: string; right: string } {
  return { lead: code[0], left: code.slice(1, 7), right: code.slice(7, 13) };
}
