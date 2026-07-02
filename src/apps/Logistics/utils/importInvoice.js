// Shared invoice-file import pipeline: extract → AI-parse → auto-import →
// auto rate-check. Used by the app-wide drop zone and the upload modal.
import * as pdfjsLib from 'pdfjs-dist'
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { supabase } from '@portal/lib/supabase'
import { parseDelimitedText, parseMoney } from './helpers.js'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker

export async function extractPdfText(buffer) {
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise
  let text = ''
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p)
    const content = await page.getTextContent()
    text += content.items.map(i => i.str).join(' ') + '\n'
  }
  return text
}

// CSV — required: description, charged_total. Optional structured columns feed
// the audit engine: service, origin, destination, weight_kg, qty, detail, tracking.
export function parseCsvLines(text) {
  const allRows = parseDelimitedText(text)
  if (allRows.length < 2) return { rows: [], error: 'CSV has no data rows' }

  const headers = allRows[0].map(h => h.trim().toLowerCase())
  if (!headers.includes('description') || !headers.includes('charged_total')) {
    return { rows: [], error: 'Missing required columns: description, charged_total' }
  }

  const idx = k => headers.indexOf(k)
  const cell = (cells, k) => (idx(k) !== -1 ? (cells[idx(k)] ?? '').trim() : '')
  const rows = []
  let skipped = 0
  for (let i = 1; i < allRows.length; i++) {
    const cells = allRows[i]
    const description   = cell(cells, 'description')
    const charged_total = parseMoney(cell(cells, 'charged_total'))
    if (!description || isNaN(charged_total)) { skipped++; continue }
    const weight = parseMoney(cell(cells, 'weight_kg'))
    const qty    = parseInt(cell(cells, 'qty'), 10)
    rows.push({
      description,
      detail:      cell(cells, 'detail') || null,
      service:     cell(cells, 'service') || null,
      origin:      cell(cells, 'origin') || null,
      destination: cell(cells, 'destination') || null,
      weight_kg:   isNaN(weight) ? null : weight,
      qty:         isNaN(qty) ? null : qty,
      tracking:    cell(cells, 'tracking') || null,
      charged_total,
    })
  }
  return { rows, skipped }
}

// Token-based carrier matching so partial names still resolve —
// "FedEx Express Australia Pty Ltd" → "TNT / FedEx", "StarTrack Express" →
// "StarTrack". Generic words are ignored; the carrier sharing the most
// distinctive tokens wins.
const CARRIER_STOPWORDS = new Set(['australia', 'australian', 'pty', 'ltd', 'limited', 'express', 'freight', 'group', 'the', 'and', 'co', 'inc', 'logistics', 'transport', 'couriers', 'courier', 'trading', 'as'])
const carrierTokens = (s) => (s ?? '').toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length >= 3 && !CARRIER_STOPWORDS.has(t))

export const matchCarrier = (carriers, name) => {
  if (!name) return null
  const n = name.toLowerCase()
  // Exact/substring first
  const direct = carriers.find(c => c.name.toLowerCase() === n || c.name.toLowerCase().includes(n) || n.includes(c.name.toLowerCase()))
  if (direct) return direct
  // Token overlap
  const nameTok = new Set(carrierTokens(name))
  if (!nameTok.size) return null
  let best = null, bestScore = 0
  for (const c of carriers) {
    const score = carrierTokens(c.name).filter(t => nameTok.has(t)).length
    if (score > bestScore) { best = c; bestScore = score }
  }
  return best
}

// Step 1 — import header + lines atomically. Returns fast so the upload
// window can close as soon as the invoice is in the table.
export async function importInvoiceRows({ invoice_ref, carrier_id, invoice_date, due_date, lines }) {
  const { data: invoiceId, error } = await supabase.rpc('import_freight_invoice', {
    _invoice_ref:  invoice_ref.trim(),
    _carrier_id:   carrier_id,
    _invoice_date: invoice_date,
    _due_date:     due_date || null,
    _lines:        lines,
  })
  if (error) return { status: 'error', message: error.message }
  return { status: 'imported', invoiceId }
}

// Step 2 — background ShipStation cross-reference. Fire-and-forget; the
// invoice row shows "Processing invoice…" until matched_at is written, and the
// realtime subscription flips it to Processed/Flagged.
export function runAuditCheck(invoiceId) {
  return supabase.functions.invoke('logistics-match-invoice', { body: { invoice_id: invoiceId } })
    .catch(() => { /* row stays pending; re-run from the invoice detail page */ })
}

// Back-compat: import then kick off the background check.
export async function importAndCheck(payload) {
  const result = await importInvoiceRows(payload)
  if (result.status === 'imported') runAuditCheck(result.invoiceId)
  return result
}

// Step 1b (background) — full line extraction for a header-only import, then
// the ShipStation cross-reference. Runs while the row shows
// "Processing invoice…"; fire-and-forget.
export async function extractLinesInBackground(invoiceId, text) {
  try {
    const { data, error } = await supabase.functions.invoke('logistics-parse-invoice', { body: { text } })
    if (!error && !data?.error && data?.lines?.length) {
      const rows = data.lines.map((l, i) => ({
        invoice_id:    invoiceId,
        description:   l.description,
        detail:        l.detail ?? null,
        service:       l.service ?? null,
        origin:        l.origin ?? null,
        destination:   l.destination ?? null,
        weight_kg:     l.weight_kg ?? null,
        qty:           l.qty ?? null,
        charged_total: l.charged_total,
        tracking_ref:  l.tracking ?? null,
        sort_order:    i,
      }))
      await supabase.from('freight_invoice_lines').insert(rows)
    }
  } catch { /* row stays pending — re-run from the invoice detail page */ }
  return runAuditCheck(invoiceId)
}

// Full drop pipeline. Returns:
//   { status:'imported', invoiceId, match }  — fully automatic
//   { status:'needs_input', prefill }        — parsed but a field is missing
//   { status:'error', message }
export async function autoImportInvoice(file, carriers) {
  const ext = file.name.split('.').pop().toLowerCase()

  if (ext === 'csv') {
    const { rows, error } = parseCsvLines(await file.text())
    if (error) return { status: 'error', message: error }
    if (!rows.length) return { status: 'error', message: 'No valid line items found in CSV' }
    // CSVs carry no header info — always needs carrier/ref/date
    return { status: 'needs_input', prefill: { lines: rows, carrier_id: '', invoice_ref: '', invoice_date: '', due_date: '' } }
  }

  if (ext !== 'pdf') return { status: 'error', message: 'Unsupported file — drop a PDF or CSV invoice' }

  // FAST first stage: header only (inv no, date, carrier) so the window can
  // close in seconds. Line extraction + rate check continue in the background.
  const text = await extractPdfText(new Uint8Array(await file.arrayBuffer()))
  const { data: header, error: fnErr } = await supabase.functions.invoke('logistics-parse-invoice', { body: { text, mode: 'header' } })
  if (fnErr || header?.error) return { status: 'error', message: header?.error ?? fnErr?.message ?? 'Failed to parse PDF' }

  const carrier = matchCarrier(carriers, header.carrier_name)
  const prefill = {
    lines:        null,             // extracted in the background
    pdfText:      text,
    carrier_id:   carrier?.id ?? '',
    carrier_name: header.carrier_name ?? '',
    invoice_ref:  header.invoice_ref ?? '',
    invoice_date: header.invoice_date ?? '',
    due_date:     header.due_date ?? '',
  }

  if (carrier && prefill.invoice_ref && prefill.invoice_date) {
    const result = await importInvoiceRows({ ...prefill, lines: [] })
    if (result.status === 'error') return result
    extractLinesInBackground(result.invoiceId, text)   // fire-and-forget
    return result
  }
  return { status: 'needs_input', prefill }
}
