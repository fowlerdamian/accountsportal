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

// ─── Rate engine derived values ───────────────────────────────────────────────
// expected_total is written by the logistics-match-invoice edge function.

export const lineVariance = (line) =>
  line.expected_total == null ? null : line.charged_total - line.expected_total

export const invoiceOvercharge = (lines) =>
  lines.reduce((sum, l) => { const v = lineVariance(l); return sum + (v != null && v > 0 ? v : 0) }, 0)

export const invoiceTotal = (lines) =>
  lines.reduce((sum, l) => sum + l.charged_total, 0)

// Age in whole days from an ISO timestamp/date to now
export const daysSince = (iso) =>
  iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : null

// ─── Missing-invoice detection ────────────────────────────────────────────────
// Carriers with a billing_frequency are expected to invoice every period since
// the anchor (first 2026 invoice, 03/01/2026). Returns fully-elapsed periods
// with no invoice, grouped per carrier.

export const BILLING_ANCHOR = new Date(2026, 0, 3) // 03/01/2026

const parseLocalDate = (str) => {
  const [y, m, d] = str.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function missingInvoicePeriods(carriers, invoices, today = new Date()) {
  const now = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const groups = []

  for (const c of carriers) {
    if (!c.billing_frequency) continue
    const dates = invoices
      .filter(inv => inv.carrier_id === c.id && inv.invoice_date)
      .map(inv => parseLocalDate(inv.invoice_date))
    const missing = []

    if (c.billing_frequency === 'weekly') {
      // 7-day windows from the anchor; only windows that have fully elapsed
      for (let start = new Date(BILLING_ANCHOR); ; start.setDate(start.getDate() + 7)) {
        const end = new Date(start); end.setDate(end.getDate() + 7)
        if (end > now) break
        if (!dates.some(d => d >= start && d < end)) {
          missing.push(start.toLocaleDateString('en-AU', { day: '2-digit', month: '2-digit', year: '2-digit' }))
        }
      }
    } else if (c.billing_frequency === 'monthly') {
      // Calendar months from Jan 2026; only fully completed months
      for (let m = new Date(BILLING_ANCHOR.getFullYear(), BILLING_ANCHOR.getMonth(), 1); ; m = new Date(m.getFullYear(), m.getMonth() + 1, 1)) {
        const next = new Date(m.getFullYear(), m.getMonth() + 1, 1)
        if (next > now) break
        if (!dates.some(d => d >= m && d < next)) {
          missing.push(m.toLocaleDateString('en-AU', { month: 'short', year: '2-digit' }))
        }
      }
    }

    if (missing.length) groups.push({ carrier: c.name, frequency: c.billing_frequency, missing })
  }
  return groups
}
