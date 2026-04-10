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
    bg:     "bg-orange-500/10",
    text:   "text-orange-400",
    border: "border-orange-500/30",
    badge:  "bg-orange-500 text-white",
    ring:   "ring-orange-500/40",
  },
  fleetcraft: {
    bg:     "bg-blue-500/10",
    text:   "text-blue-400",
    border: "border-blue-500/30",
    badge:  "bg-blue-500 text-white",
    ring:   "ring-blue-500/40",
  },
  aga: {
    bg:     "bg-emerald-500/10",
    text:   "text-emerald-400",
    border: "border-emerald-500/30",
    badge:  "bg-emerald-500 text-white",
    ring:   "ring-emerald-500/40",
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
  researched:    "bg-blue-900/50 text-blue-300",
  enriched:      "bg-violet-900/50 text-violet-300",
  queued:        "bg-yellow-900/50 text-yellow-300",
  contacted:     "bg-orange-900/50 text-orange-300",
  converted:     "bg-green-900/50 text-green-300",
  disqualified:  "bg-red-900/50 text-red-300",
};

export const CALL_OUTCOME_LABEL: Record<string, string> = {
  connected:      "Connected",
  voicemail:      "Voicemail",
  no_answer:      "No Answer",
  callback:       "Callback",
  not_interested: "Not Interested",
};

export const SCORE_COLOR = (score: number): string => {
  if (score >= 70) return "text-green-400";
  if (score >= 45) return "text-yellow-400";
  return "text-red-400";
};

export const SCORE_BG = (score: number): string => {
  if (score >= 70) return "bg-green-500/20 text-green-400 border-green-500/30";
  if (score >= 45) return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
  return "bg-red-500/20 text-red-400 border-red-500/30";
};

export const SUPABASE_FN_URL = (name: string): string => {
  const base = import.meta.env.VITE_SUPABASE_URL?.replace("/rest/v1", "") ?? "";
  return `${base}/functions/v1/${name}`;
};
