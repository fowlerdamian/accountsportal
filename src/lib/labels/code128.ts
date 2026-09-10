/**
 * Code 128 encoder for the DYMO-format barcode label (the .dymo template
 * uses Code128, so the scanner reads back exactly the text that was typed —
 * no check digit is added to the data).
 *
 * Code set C is used for an all-digit string (half the width; an odd-length
 * one ends with a single set A digit), otherwise code set B (printable
 * ASCII 32–126).
 */

/** Symbol patterns as bar/space widths, index = symbol value (0–106). */
const PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
];
const CODE_A = 101;
const START_B = 104;
const START_C = 105;
const STOP = 106;

export type Code128Result = { ok: true; text: string } | { ok: false; error: string };

/** Trim and check the text can be encoded in code set B/C. */
export function normaliseCode128(input: string): Code128Result {
  const text = input.trim();
  if (!text) return { ok: false, error: "Enter the barcode text" };
  if (text.length > 48) return { ok: false, error: `Barcode text is too long (${text.length} characters, max 48)` };
  if (!/^[\x20-\x7e]+$/.test(text)) return { ok: false, error: "Barcode may only contain letters, digits and basic punctuation" };
  return { ok: true, text };
}

/** Symbol values (start … data … check, stop) for the text. */
export function code128Symbols(text: string): number[] {
  const symbols: number[] = [];
  if (/^\d+$/.test(text) && text.length >= 2) {
    const odd = text.length % 2 === 1;
    const pairs = odd ? text.slice(0, -1) : text;
    symbols.push(START_C);
    for (let i = 0; i < pairs.length; i += 2) symbols.push(Number(pairs.slice(i, i + 2)));
    if (odd) symbols.push(CODE_A, text.charCodeAt(text.length - 1) - 32);
  } else {
    symbols.push(START_B);
    for (const ch of text) symbols.push(ch.charCodeAt(0) - 32);
  }
  let check = symbols[0];
  for (let i = 1; i < symbols.length; i++) check += symbols[i] * i;
  symbols.push(check % 103, STOP);
  return symbols;
}

/** Module string, "1" = bar. 11 modules per symbol, 13 for the stop. */
export function code128Modules(text: string): string {
  let out = "";
  for (const sym of code128Symbols(text)) {
    const widths = PATTERNS[sym];
    for (let i = 0; i < widths.length; i++) out += (i % 2 === 0 ? "1" : "0").repeat(Number(widths[i]));
  }
  return out;
}

/** Bar runs as [startModule, widthModules] pairs, plus the total module count. */
export function code128Bars(text: string): { bars: Array<[number, number]>; modules: number } {
  const m = code128Modules(text);
  const bars: Array<[number, number]> = [];
  let i = 0;
  while (i < m.length) {
    if (m[i] === "1") {
      let w = 1;
      while (m[i + w] === "1") w++;
      bars.push([i, w]);
      i += w;
    } else i++;
  }
  return { bars, modules: m.length };
}

/** Quiet zone each side, in modules (spec minimum is 10). */
export const CODE128_QUIET = 10;
