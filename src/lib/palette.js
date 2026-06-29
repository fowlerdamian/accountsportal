// Single source of truth for brand accent colours — JS side.
//
// The canonical values live in src/index.css `:root` as --brand-* custom
// properties. This module reads them so JavaScript consumers (recharts
// fills/strokes, canvas — anything that can't use a CSS var()) get the exact
// same colours. Edit the --brand-* tokens in index.css to recolour the whole
// portal; both CSS and JS pick it up on the next load.
//
// Inline styles / CSS should use the variables directly:
//   style={{ color: 'var(--brand-accent)' }}
// Charts / other JS import from here:
//   import { palette } from '@portal/lib/palette'
//   <Bar fill={palette.accent} />

const FALLBACK = {
  accent: '#e09f3e', gold: '#e09f3e', orange: '#e09f3e', pink: '#9e2a2b',
  blue: '#335c67', aqua: '#335c67', purple: '#540b0e',
}

function read(name, fallback) {
  if (typeof window === 'undefined' || !window.getComputedStyle) return fallback
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

// Live getters — each access reflects the current --brand-* token value, so a
// token change (after rebuild) is picked up without touching consumer code.
export const palette = {
  get accent() { return read('--brand-accent', FALLBACK.accent) },
  get gold()   { return read('--brand-gold',   FALLBACK.gold) },
  get orange() { return read('--brand-orange', FALLBACK.orange) },
  get pink()   { return read('--brand-pink',   FALLBACK.pink) },
  get blue()   { return read('--brand-blue',   FALLBACK.blue) },
  get aqua()   { return read('--brand-aqua',   FALLBACK.aqua) },
  get purple() { return read('--brand-purple', FALLBACK.purple) },
  // Ordered hue list for multi-series charts (mirrors --cat-* intent).
  get series() { return [this.gold, this.blue, this.pink, this.aqua, this.purple, this.orange] },
}
