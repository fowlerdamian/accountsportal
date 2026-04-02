export const aud = (n) =>
  n == null ? '—' : `$${Math.abs(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export const lineVariance = (line) =>
  line.contracted_total == null ? null : line.charged_total - line.contracted_total

export const invoiceOvercharge = (lines) =>
  lines.reduce((sum, l) => { const v = lineVariance(l); return sum + (v != null && v > 0 ? v : 0) }, 0)

export const invoiceTotal = (lines) =>
  lines.reduce((sum, l) => sum + l.charged_total, 0)
