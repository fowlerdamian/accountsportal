import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Short code for a brand badge/tab (max 3 chars). The brands table has no
 * short-code column, so derive it: initials for multi-word names
 * ("Automotive Group Australia" → "AGA"), first two letters for single words
 * ("Trailbait" → "TR").
 */
export function brandShort(b: { name?: string | null; key?: string | null } | null | undefined): string {
  const src = (b?.name || b?.key || "").trim();
  if (!src) return "—";
  const words = src.split(/[\s\-_/]+/).filter(Boolean);
  const code = words.length > 1 ? words.map((w) => w[0]).join("") : src.slice(0, 2);
  return code.slice(0, 3).toUpperCase();
}
