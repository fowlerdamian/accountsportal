/**
 * Split a Cin7 product name into the product, the vehicle it suits and any
 * trailing variant, for the barcode label's Product / Vehicle / Notes fields.
 *
 * Cin7 names have no separator, so the split is keyed on vehicle words:
 *   "Behind Grille Light Bar Isuzu D-MAX"            → product "Behind Grille Light Bar", vehicle "Isuzu D-MAX"
 *   "Bonnet Aerial Mount Hilux N90 2025.5+ Passenger Side"
 *                                                    → product "Bonnet Aerial Mount", vehicle "Hilux N90 2025.5+", extra "Passenger Side"
 *   "N90 Hilux Behind-Grille Light Bar STEDI ST3K"   → vehicle "N90 Hilux", product "Behind-Grille Light Bar STEDI ST3K"
 *   "Cross Bar Z Bracket"                            → product only
 *
 * The vehicle span starts at the first make / model word and grows in both
 * directions over model codes, chassis codes, years and "/" alternatives.
 * Anything after the span is the extra (side, mount-only, size…). Connector
 * words before the span ("for", "to suit", "-") are dropped. It is a
 * heuristic — the fields stay editable.
 */

const MAKES_AND_MODELS = [
  // Makes
  "isuzu", "toyota", "ford", "nissan", "mazda", "mitsubishi", "volkswagen", "vw", "holden", "chevrolet", "chev", "dodge", "ram",
  "jeep", "ldv", "gwm", "byd", "kia", "hyundai", "subaru", "ineos", "suzuki", "tesla", "mercedes", "great", "land", "rover", "lexus",
  // Models / platforms
  "d-max", "dmax", "d-max/bt50", "d-max/bt-50", "mu-x", "mux", "hilux", "landcruiser", "cruiser", "prado", "fortuner", "rav4", "lc70", "lc76", "lc78",
  "lc79", "lc200", "lc250", "lc300", "ranger", "raptor", "everest", "f-150", "f150", "navara", "patrol", "pathfinder", "bt-50", "bt50",
  "triton", "pajero", "amarok", "colorado", "silverado", "1500", "2500", "wrangler", "gladiator", "t60", "cannon", "shark", "sportage",
  "tucson", "tuscon", "wrx", "grenadier", "defender", "disco", "discovery", "jimny", "cybertruck", "x-class", "troopy", "universal",
];

/** Words that may extend a vehicle span but never start one. */
const CONTINUATION = new Set([
  "series", "gen", "next", "next-gen", "all-new", "new", "dual", "cab", "dc", "ute", "wagon", "/", "&", "+", "and", "or",
  "sr", "sr5", "sr/sr5", "sr/workmate", "workmate", "rogue", "wildtrak", "xl", "xls", "xlt", "platinum", "sport", "tremor", "ti", "st-x", "st-l",
  "single", "extra", "double", "crew", "super",
]);

/** Chassis / generation codes seen in Cin7 names (upper-cased). */
const CHASSIS = new Set([
  "RG", "RJ", "TF", "NG", "NF", "DS", "DT", "EK", "RA", "PX", "PX2", "PX3", "PX2+3", "MQ", "MR", "MV", "MQ/MR", "MR/QF", "QF", "GC", "GD", "GE", "GR",
  "NP300", "D40", "D23", "N70", "N80", "N90", "Y62", "Y61", "GU", "T60", "P703", "T6.2", "MK2", "MK3", "ZR2", "Z71", "JL", "JT", "JK", "150", "250",
  "70", "76", "78", "79", "80", "100", "105", "200", "300", "3RD", "4TH", "5TH", "6TH", "110/130", "120",
]);

/** Upper-case tokens that look like codes but are product words. */
const NOT_CHASSIS = new Set([
  "UHF", "LED", "DIY", "GME", "PSR", "TTG", "CAN", "KD", "QRG", "WIR", "RSC", "ATV", "HDX", "WLL", "PRO", "EVO", "RGB", "USB", "USBC",
  "LH", "RH", "PSG", "SX", "CT", "CO", "EGR", "PIAK", "TWIN", "MAXX", "AS002", "ULTRAV", "ST4K", "ST3K", "ST1K", "ST3301", "ST3303", "RAP",
]);

const YEAR = /^(?:'?\d{2}|\d{4})(?:\.\d)?(?:\+|-(?:\d{2}|\d{4})\+?|~|-)?$|^\((?:\d{4}(?:-|~)?(?:\d{4}|current|on)?)\)$|^\d{4}(?:\/\d{2,4})?\s?on$/i;
const CONNECTORS = new Set(["for", "to", "suit", "-", "–", "—", "/", ":", "fits", "fit"]);

const norm = (t: string) => t.toLowerCase().replace(/[(),]/g, "");

function isStart(tok: string): boolean {
  return MAKES_AND_MODELS.includes(norm(tok));
}

function isContinuation(tok: string): boolean {
  const n = norm(tok);
  if (!n) return false;
  // Bare model numbers ("Shark 6", "Prado 250", "LandCruiser 70") stay with the vehicle.
  if (MAKES_AND_MODELS.includes(n) || CONTINUATION.has(n) || YEAR.test(tok) || /^\d{1,4}$/.test(tok)) return true;
  const u = tok.replace(/[(),]/g, "").toUpperCase();
  if (NOT_CHASSIS.has(u)) return false;
  if (CHASSIS.has(u)) return true;
  // Letter+digit codes like N80, Y62, LC300, NP300, PX2 — but not sizes like 21.5" or 165W.
  return /^[A-Z]{1,2}\d{1,3}[A-Z]?$/.test(u) && !/["'W]$/.test(tok);
}

export interface SplitProductName {
  product: string;
  vehicle: string;
  /** Trailing variant after the vehicle, e.g. "Passenger Side". */
  extra: string;
}

export function splitProductName(raw: string): SplitProductName {
  const name = raw.replace(/\bVehicle-/gi, "").replace(/\s+/g, " ").trim();
  const tokens = name.split(" ").filter(Boolean);
  const start = tokens.findIndex(isStart);
  if (start < 0) return { product: name, vehicle: "", extra: "" };

  // Grow the span backwards over codes / years ("MV Triton", "22+ Ranger") and forwards over the model detail.
  let a = start;
  while (a > 0 && isContinuation(tokens[a - 1]) && !isStart(tokens[a - 1]) === true) a--;
  while (a > 0 && isStart(tokens[a - 1])) a--;
  let b = start;
  while (b + 1 < tokens.length && isContinuation(tokens[b + 1])) b++;
  // A trailing "/" or "&" with nothing vehicle-like after it belongs to the product.
  while (b > start && CONNECTORS.has(norm(tokens[b]))) b--;

  let before = tokens.slice(0, a);
  const vehicle = tokens.slice(a, b + 1);
  let after = tokens.slice(b + 1);

  // Drop connectors on either side of the span ("… for Ford Ranger", "Mount - Isuzu D-Max").
  while (before.length && CONNECTORS.has(norm(before[before.length - 1]))) before.pop();
  while (after.length && CONNECTORS.has(norm(after[0]))) after.shift();

  const clean = (t: string[]) => t.join(" ").replace(/\s+-\s*$/, "").trim();

  if (a === 0) {
    // Vehicle first: the rest is the product; a trailing year ("… 2024+") still describes the vehicle.
    const rest = [...after];
    const years: string[] = [];
    while (rest.length && YEAR.test(rest[rest.length - 1])) years.unshift(rest.pop() as string);
    return { product: clean(rest), vehicle: clean([...vehicle, ...years]), extra: "" };
  }
  return { product: clean(before), vehicle: clean(vehicle), extra: clean(after) };
}
