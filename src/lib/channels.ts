// ── Channels — single source of truth ────────────────────────────────────────
// AGA's three go-to-market channels, in canonical taxonomy order. Both the
// Marketing and (later) Finance Channel-Analytics views import from here so the
// label, order, accent and CRM mapping never drift between modules.
//
// The keys mirror the Postgres `sales_channel` enum (trailbait, fleetcraft, aga)
// — the enforced source of truth for lead/activity attribution. The dealType
// map mirrors CHANNEL_DEAL_TYPE in supabase/functions/sales-hubspot-sync, the
// enforced source of truth for HubSpot deal attribution. Keep all three aligned.

import { palette } from "@portal/lib/palette";

export type ChannelKey = "trailbait" | "fleetcraft" | "aga";

/** The bucket for any record that can't be mapped to a canonical channel. */
export const UNASSIGNED = "unassigned" as const;
export type BucketKey = ChannelKey | typeof UNASSIGNED;

export interface ChannelMeta {
  key: ChannelKey;
  /** Display label — confirmed against existing codebase/CRM convention. */
  label: string;
  /** Sales model, for subtitles/tooltips. */
  model: "B2B2C" | "B2B";
  /** One-line description of who they are. */
  who: string;
  /** HubSpot `dealtype` value used to attribute deals to this channel. */
  dealType: string;
  /** CSS custom-property name for this channel's accent (token-driven). */
  cssVar: string;
  /** Resolved accent hex — reads the live --brand token via palette. */
  accent: () => string;
}

// Order is canonical: TrailBait → FleetCraft → AGA. Accents reuse the existing
// per-brand assignments already used by the Marketing brand tabs
// (TrailBait=accent/gold, FleetCraft=blue, AGA=pink) — no new colours.
export const CHANNELS: ChannelMeta[] = [
  {
    key: "trailbait",
    label: "TrailBait",
    model: "B2B2C",
    who: "Resellers retailing/fitting product for consumers — 4x4 & auto retail",
    dealType: "Distributor",
    cssVar: "--brand-accent",
    accent: () => palette.accent,
  },
  {
    key: "fleetcraft",
    label: "FleetCraft",
    model: "B2B",
    who: "Fleet fitout companies / upfitters",
    dealType: "Fleet & Commercial",
    cssVar: "--brand-blue",
    accent: () => palette.blue,
  },
  {
    key: "aga",
    label: "AGA",
    model: "B2B",
    who: "Contract manufacturing / bespoke for larger automotive brands",
    dealType: "Bespoke Manufacturer",
    cssVar: "--brand-pink",
    accent: () => palette.pink,
  },
];

/** Canonical key order — handy for iterating / sorting. */
export const CHANNEL_KEYS: ChannelKey[] = CHANNELS.map((c) => c.key);

/** The Unassigned bucket's display metadata (surfaced, never hidden). */
export const UNASSIGNED_META = {
  key: UNASSIGNED,
  label: "Unassigned",
  who: "Records with no recognised channel mapping",
  cssVar: "--brand-purple",
  accent: () => palette.purple,
};

const BY_KEY = new Map<ChannelKey, ChannelMeta>(CHANNELS.map((c) => [c.key, c]));
const BY_DEALTYPE = new Map<string, ChannelKey>(
  CHANNELS.map((c) => [c.dealType.toLowerCase(), c.key]),
);

/** Look up channel metadata by key. */
export function channelMeta(key: ChannelKey): ChannelMeta {
  return BY_KEY.get(key)!;
}

/**
 * Classify a HubSpot deal's `dealtype` to a canonical channel, or UNASSIGNED.
 * Tolerant of case and of the dealtype being embedded in a longer string
 * (mirrors the dealname CONTAINS_TOKEN fallback the sync function relies on).
 */
export function classifyDealType(dealType: string | null | undefined): BucketKey {
  if (!dealType) return UNASSIGNED;
  const t = dealType.toLowerCase().trim();
  const exact = BY_DEALTYPE.get(t);
  if (exact) return exact;
  for (const [needle, key] of BY_DEALTYPE) {
    if (t.includes(needle)) return key;
  }
  return UNASSIGNED;
}

/** Label for any bucket key, including Unassigned. */
export function bucketLabel(key: BucketKey): string {
  return key === UNASSIGNED ? UNASSIGNED_META.label : channelMeta(key).label;
}

/** Accent for any bucket key, including Unassigned. */
export function bucketAccent(key: BucketKey): string {
  return key === UNASSIGNED ? UNASSIGNED_META.accent() : channelMeta(key).accent();
}
