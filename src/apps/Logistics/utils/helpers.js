export const aud = (n) =>
  n == null ? '—' : `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

// ─── Delimited-text parsing ───────────────────────────────────────────────────

// RFC-4180-ish parser — handles double-quoted fields, escaped quotes ("") and
// separators/newlines inside quotes. Returns an array of rows (string[] cells).
export function parseDelimitedText(text, sep = ',') {
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ }  // escaped quote
        else inQuotes = false
      } else field += ch
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === sep) {
      row.push(field); field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.length > 1 || row[0].trim() !== '') rows.push(row)
      row = []
    } else field += ch
  }
  row.push(field)
  if (row.length > 1 || row[0].trim() !== '') rows.push(row)
  return rows
}

// Strip currency symbols and thousands separators before parsing:
// "$1,234.56" → 1234.56. Returns NaN for non-numeric input.
export const parseMoney = (str) =>
  parseFloat(String(str ?? '').replace(/[$\s]/g, '').replace(/,/g, ''))

// Parse "YYYY-MM-DD" as local time to avoid UTC midnight → previous day in positive-offset zones
export const fmtDate = (str) => {
  if (!str) return '—'
  const [y, m, d] = str.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-AU')
}

export const lineVariance = (line) =>
  line.contracted_total == null ? null : line.charged_total - line.contracted_total

export const invoiceOvercharge = (lines) =>
  lines.reduce((sum, l) => { const v = lineVariance(l); return sum + (v != null && v > 0 ? v : 0) }, 0)

export const invoiceTotal = (lines) =>
  lines.reduce((sum, l) => sum + l.charged_total, 0)
