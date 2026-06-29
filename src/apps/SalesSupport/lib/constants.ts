export type Channel = "trailbait" | "fleetcraft" | "aga";

export const CHANNELS: Channel[] = ["trailbait", "fleetcraft", "aga"];

export const CHANNEL_LABEL: Record<Channel, string> = {
  trailbait:  "TrailBait",
  fleetcraft: "FleetCraft",
  aga:        "AGA Bespoke",
};

export const CHANNEL_DESCRIPTION: Record<Channel, string> = {
  trailbait:  "Wholesale & Distribution",
  fleetcraft: "Fleet & Commercial",
  aga:        "Bespoke / OEM",
};

// Tailwind colour tokens per channel
export const CHANNEL_COLOR: Record<Channel, { bg: string; text: string; border: string; badge: string; ring: string }> = {
  trailbait:  {
    bg:     "bg-[rgba(var(--brand-accent-rgb),0.1)]",
    text:   "text-[var(--brand-orange)]",
    border: "border-[rgba(var(--brand-accent-rgb),0.3)]",
    badge:  "bg-[var(--brand-orange)] text-white",
    ring:   "ring-[rgba(var(--brand-accent-rgb),0.4)]",
  },
  fleetcraft: {
    bg:     "bg-[rgba(var(--brand-aqua-rgb),0.1)]",
    text:   "text-[var(--brand-blue)]",
    border: "border-[rgba(var(--brand-aqua-rgb),0.3)]",
    badge:  "bg-[var(--brand-blue)] text-white",
    ring:   "ring-[rgba(var(--brand-aqua-rgb),0.4)]",
  },
  aga: {
    bg:     "bg-[rgba(var(--brand-pink-rgb),0.1)]",
    text:   "text-[var(--brand-pink)]",
    border: "border-[rgba(var(--brand-pink-rgb),0.3)]",
    badge:  "bg-[var(--brand-pink)] text-white",
    ring:   "ring-[rgba(var(--brand-pink-rgb),0.4)]",
  },
};

export const LEAD_STATUS_LABEL: Record<string, string> = {
  new:           "New",
  researched:    "Researched",
  enriched:      "Enriched",
  queued:        "Queued",
  contacted:     "Contacted",
  converted:     "Converted",
  disqualified:  "Disqualified",
};

export const LEAD_STATUS_COLOR: Record<string, string> = {
  new:           "bg-zinc-700 text-zinc-300",
  researched:    "bg-[rgba(var(--brand-aqua-rgb),0.5)] text-[var(--brand-blue)]",
  enriched:      "bg-[rgba(var(--brand-purple-rgb),0.5)] text-[var(--brand-purple)]",
  queued:        "bg-[rgba(var(--brand-accent-rgb),0.5)] text-[var(--brand-orange)]",
  contacted:     "bg-[rgba(var(--brand-accent-rgb),0.5)] text-[var(--brand-orange)]",
  converted:     "bg-[rgba(var(--brand-aqua-rgb),0.5)] text-[var(--brand-aqua)]",
  disqualified:  "bg-[rgba(var(--brand-pink-rgb),0.5)] text-[var(--brand-pink)]",
};

export const CALL_OUTCOME_LABEL: Record<string, string> = {
  connected:      "Connected",
  voicemail:      "Voicemail",
  no_answer:      "No Answer",
  callback:       "Callback",
  not_interested: "Not Interested",
};

export const SCORE_COLOR = (score: number): string => {
  if (score >= 70) return "text-[var(--brand-aqua)]";
  if (score >= 45) return "text-[var(--brand-orange)]";
  return "text-[var(--brand-pink)]";
};

export const SCORE_BG = (score: number): string => {
  if (score >= 70) return "bg-[rgba(var(--brand-aqua-rgb),0.2)] text-[var(--brand-aqua)] border-[rgba(var(--brand-aqua-rgb),0.3)]";
  if (score >= 45) return "bg-[rgba(var(--brand-accent-rgb),0.2)] text-[var(--brand-orange)] border-[rgba(var(--brand-accent-rgb),0.3)]";
  return "bg-[rgba(var(--brand-pink-rgb),0.2)] text-[var(--brand-pink)] border-[rgba(var(--brand-pink-rgb),0.3)]";
};

export const SUPABASE_FN_URL = (name: string): string => {
  const base = import.meta.env.VITE_SUPABASE_URL?.replace("/rest/v1", "") ?? "";
  return `${base}/functions/v1/${name}`;
};
