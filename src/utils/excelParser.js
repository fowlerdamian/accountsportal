import * as XLSX from 'xlsx'

// ─── File reading ────────────────────────────────────────────────────────────

export function readExcelFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result)
        const workbook = XLSX.read(data, { type: 'array' })
        const sheet = workbook.Sheets[workbook.SheetNames[0]]
        // raw:true gives us actual numbers for numeric cells
        const rows = XLSX.utils.sheet_to_json(sheet, {
          header: 1,
          defval: '',
          raw: true,
        })
        resolve(rows)
      } catch (err) {
        reject(new Error(`Could not read file: ${err.message}`))
      }
    }
    reader.onerror = () => reject(new Error('File read failed.'))
    reader.readAsArrayBuffer(file)
  })
}

// ─── Header detection ────────────────────────────────────────────────────────

function rowHasHeaders(row) {
  const cells = row.map((c) => String(c).toLowerCase().trim())
  return (
    cells.some((c) => c.includes('order')) &&
    cells.some((c) => c.includes('customer')) &&
    cells.some((c) => c.includes('invoice'))
  )
}

function findHeaderRowIndex(rows) {
  for (let i = 0; i < Math.min(15, rows.length); i++) {
    if (rowHasHeaders(rows[i])) return i
  }
  return -1
}

// ─── Column mapping ──────────────────────────────────────────────────────────

function buildColumnMap(headerRow) {
  const map = {}
  headerRow.forEach((cell, idx) => {
    const lower = String(cell).toLowerCase().trim()
    if (!lower) return
    // First match wins for each field
    if (lower.includes('order') && map.order === undefined) map.order = idx
    else if (lower.includes('customer') && map.customer === undefined) map.customer = idx
    else if (lower.includes('invoice') && map.invoice === undefined) map.invoice = idx
    else if (lower.includes('cogs') && map.cogs === undefined) map.cogs = idx
    else if (lower.includes('journal') && map.journals === undefined) map.journals = idx
    // profit last: avoid matching "Profit Summary Report" title rows
    else if (lower === 'profit' && map.profit === undefined) map.profit = idx
    else if (lower.includes('profit') && map.profit === undefined) map.profit = idx
  })
  return map
}

// ─── Metadata parsing ────────────────────────────────────────────────────────

function extractMetadata(rows, headerRowIndex) {
  const lines = []
  for (let i = 0; i < headerRowIndex && i < 5; i++) {
    const nonEmpty = rows[i]
      .map((c) => String(c).trim())
      .filter((c) => c !== '' && c !== '0')
    if (nonEmpty.length > 0) lines.push(nonEmpty.join('  '))
  }

  // Try to find a period/date line
  const dateRe = /\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/
  const periodRe = /period|date range|from|report/i
  const period =
    lines.find((l) => periodRe.test(l) || dateRe.test(l)) ||
    lines[0] ||
    null

  return { metaLines: lines, period }
}

// ─── Number coercion ─────────────────────────────────────────────────────────

function toNum(value) {
  if (typeof value === 'number') return isNaN(value) ? 0 : value
  const n = parseFloat(String(value).replace(/[$,\s]/g, ''))
  return isNaN(n) ? 0 : n
}

// ─── Main parse entry point ──────────────────────────────────────────────────

export function parseSheet(rows) {
  const headerIdx = findHeaderRowIndex(rows)

  if (headerIdx === -1) {
    throw new Error(
      'Header row not found. Expected columns containing "Order #", "Customer", and "Invoice" in the first 15 rows.'
    )
  }

  const colMap = buildColumnMap(rows[headerIdx])
  const missing = ['order', 'customer', 'invoice', 'cogs'].filter(
    (k) => colMap[k] === undefined
  )
  if (missing.length > 0) {
    throw new Error(
      `Required columns not found: ${missing.map((k) => k.toUpperCase()).join(', ')}. ` +
        'Check that this is a Cin7 Profit Summary Report export.'
    )
  }

  const { metaLines, period } = extractMetadata(rows, headerIdx)

  const rawRows = []
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i]
    if (row.every((c) => String(c).trim() === '')) continue

    const orderNum = String(row[colMap.order] ?? '').trim()
    if (!/^SO-/i.test(orderNum)) continue

    rawRows.push({
      orderNum,
      customer: String(row[colMap.customer] ?? '').trim(),
      invoice: toNum(row[colMap.invoice]),
      cogs: toNum(row[colMap.cogs]),
      journals: colMap.journals !== undefined ? toNum(row[colMap.journals]) : 0,
    })
  }

  return { rawRows, metaLines, period }
}
