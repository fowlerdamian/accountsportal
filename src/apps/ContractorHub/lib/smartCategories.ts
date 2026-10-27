// Smart categories for the Projects list. Each rule tags a project when its
// name or description matches; a project can carry several tags. The list
// shown is dynamic: only categories that currently hold 2+ projects, biggest
// first, capped at SMART_CATEGORY_MAX. Add a rule here to teach it a new group.

export const SMART_CATEGORY_MAX = 10;

interface Rule { key: string; label: string; re: RegExp }

const RULES: Rule[] = [
  // Vehicles
  { key: "ranger",    label: "Ford Ranger / Raptor", re: /\b(ranger|raptor)\b/i },
  { key: "everest",   label: "Everest",              re: /\beverest\b/i },
  { key: "hilux",     label: "Hilux",                re: /\b(hilux|n80|n90)\b/i },
  { key: "landcruiser", label: "LandCruiser",        re: /\b(lc ?300|lc ?70|lc ?79|landcruiser|land cruiser)\b/i },
  { key: "prado",     label: "Prado",                re: /\bprado\b/i },
  { key: "triton",    label: "Triton",               re: /\b(triton|mv|mvt)\b|tritontow/i },
  { key: "navara",    label: "Navara",               re: /\b(navara|np300)\b/i },
  { key: "dmax",      label: "D-Max",                re: /\bd-?max\b/i },
  { key: "byd",       label: "BYD",                  re: /\bbyd\b/i },
  { key: "foton",     label: "Foton",                re: /\bfoton\b/i },
  { key: "jeep",      label: "Jeep",                 re: /\bjeep\b/i },
  { key: "us-trucks", label: "Silverado / Tundra",   re: /\b(silverado|tundra)\b/i },
  { key: "van",       label: "Van fit-out",          re: /\bvan\b/i },
  // Product kinds
  { key: "tow",       label: "Tow",                  re: /\btow\b|tow ?hitch/i },
  { key: "lighting",  label: "Lighting",             re: /\b(light|lights|lamp|beacon|light ?bar)\b/i },
  { key: "uhf",       label: "UHF & aerials",        re: /\b(uhf|aerial|ariel|antenna|starlink)\b/i },
  { key: "phone",     label: "Phone & tablet",       re: /\b(phone|tablet|quad ?lock)\b/i },
  { key: "storage",   label: "Storage & holders",    re: /\b(holder|holders|storage|pocket|tray|hook|pegs?|carrier)\b/i },
  { key: "electrical", label: "Electrical",          re: /\b(isolator|fuse|relay|harness|loom|power|switch|battery|socket|dc ?dc|bcdc)\b/i },
  { key: "tie-down",  label: "Tie-downs",            re: /\btie ?downs?\b/i },
  { key: "racks",     label: "Racks & crossbars",    re: /\b(cross ?bars?|rack|sports bar|roof)\b/i },
  { key: "camping",   label: "Awnings & camping",    re: /\b(awning|tent|compressor|high lift)\b/i },
  { key: "tub",       label: "Tub",                  re: /\btub\b/i },
  { key: "grille",    label: "Behind grille",        re: /\b(grille|grill|bglb)\b/i },
  { key: "interior",  label: "Interior & console",   re: /\b(console|visor|cup holder|dash|centre)\b/i },
  { key: "safety",    label: "Safety",               re: /\b(fire extinguisher|first aid|airbag|wheel chock)\b/i },
];

export interface SmartCategory { key: string; label: string; ids: Set<string> }

export function smartCategories(projects: { id: string; name: string; description?: string | null }[]): SmartCategory[] {
  return RULES
    .map(r => ({
      key: r.key,
      label: r.label,
      ids: new Set(projects.filter(p => r.re.test(`${p.name} ${p.description ?? ""}`)).map(p => p.id)),
    }))
    .filter(c => c.ids.size >= 2)
    .sort((a, b) => b.ids.size - a.ids.size)
    .slice(0, SMART_CATEGORY_MAX);
}
