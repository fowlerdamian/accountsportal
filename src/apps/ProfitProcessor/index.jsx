import { useState, useCallback, useRef } from 'react'
import DropZone from './components/DropZone.jsx'
import ProfitDashboard from './components/ProfitDashboard.jsx'
import { readExcelFile, parseSheet } from './utils/excelParser.js'
import { processOrders } from './utils/processor.js'

// ─── Cin7 link lookup ─────────────────────────────────────────────────────────
// Pages through Cin7's sale list in bulk (1000 sales per API call) and matches
// the report's SO numbers against each page — a whole report resolves in a few
// calls instead of one rate-limited Search per order. Links merge into state as
// each page lands so the table fills in progressively.
const MAX_PAGES = 10 // 10,000 most recent sales — well past any report's reach

async function fetchOrderLinks(soNumbers, setOrderLinks, setLinksLoading, genRef, gen) {
  setLinksLoading(true)
  const wanted = new Set(soNumbers)
  try {
    for (let page = 1; page <= MAX_PAGES && wanted.size > 0; page++) {
      // A newer file was loaded — stop fetching and never merge stale pages
      if (genRef.current !== gen) return
      try {
        const resp = await fetch('/api/cin7-lookup', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ page }),
        })
        if (!resp.ok) break
        const { links = {}, count = 0, limit = 0 } = await resp.json()
        if (genRef.current !== gen) return

        const matched = {}
        for (const so of Object.keys(links)) {
          if (wanted.has(so)) {
            matched[so] = links[so]
            wanted.delete(so)
          }
        }
        if (Object.keys(matched).length > 0) {
          setOrderLinks((prev) => ({ ...prev, ...matched }))
        }

        if (count < limit) break // last page — remaining SOs don't exist in Cin7
      } catch {
        break // network hiccup — leave whatever links already resolved
      }
    }
  } finally {
    // Don't clobber the loading flag of a newer run
    if (genRef.current === gen) setLinksLoading(false)
  }
}

export default function ProfitProcessor() {
  const [result, setResult]           = useState(null)
  const [error, setError]             = useState(null)
  const [loading, setLoading]         = useState(false)
  const [fileName, setFileName]       = useState('')
  const [orderLinks, setOrderLinks]   = useState({})
  const [linksLoading, setLinksLoading] = useState(false)
  // Generation counter — loading a new file invalidates any in-flight link loop
  const linkGenRef = useRef(0)

  const handleFile = useCallback(async (file) => {
    const gen = ++linkGenRef.current
    setLoading(true)
    setError(null)
    setResult(null)
    setOrderLinks({})
    setLinksLoading(false)
    setFileName(file.name)

    try {
      const rows = await readExcelFile(file)
      const { rawRows, metaLines, period } = parseSheet(rows)

      if (rawRows.length === 0) {
        throw new Error(
          'No order rows found (expected rows starting with "SO-"). ' +
          'Make sure this is a Cin7 Core Profit Summary Report export.'
        )
      }

      const processed = processOrders(rawRows)
      const finalResult = { ...processed, metaLines, period, fileName: file.name }
      setResult(finalResult)

      // Kick off link lookups in the background — doesn't block the table render
      const soNumbers = finalResult.orders.map((o) => o.orderNum)
      fetchOrderLinks(soNumbers, setOrderLinks, setLinksLoading, linkGenRef, gen)
    } catch (err) {
      setError(err.message || 'An unknown error occurred.')
    } finally {
      setLoading(false)
    }
  }, [])

  const handleReset = useCallback(() => {
    setResult(null)
    setError(null)
    setFileName('')
    setOrderLinks({})
    setLinksLoading(false)
  }, [])

  // ── Dashboard view ────────────────────────────────────────────────────────
  if (result) {
    return (
      <ProfitDashboard
        result={result}
        onReset={handleReset}
        orderLinks={orderLinks}
        linksLoading={linksLoading}
      />
    )
  }

  // ── Drop zone / loading / error ───────────────────────────────────────────
  return (
    <div
      className="flex-1 flex flex-col items-center justify-center gap-6 p-8"
      style={{ overflowY: 'auto' }}
    >
      {loading ? (
        <div className="flex flex-col items-center gap-4">
          <div
            className="w-8 h-8 rounded-full border-2 animate-spin"
            style={{ borderColor: 'var(--brand-accent)', borderTopColor: 'transparent' }}
          />
          <p className="text-sm font-mono" style={{ color: '#666' }}>
            Processing {fileName}…
          </p>
        </div>
      ) : (
        <>
          <DropZone onFile={handleFile} />

          {error && (
            <div
              className="w-full max-w-lg rounded-lg px-4 py-3"
              style={{
                background: 'rgba(var(--brand-pink-rgb),0.15)',
                border: '1px solid rgba(var(--brand-pink-rgb),0.5)',
              }}
            >
              <p className="text-sm font-mono" style={{ color: 'var(--brand-pink)' }}>
                <span style={{ color: 'var(--brand-pink)' }}>Error: </span>
                {error}
              </p>
            </div>
          )}

          <p className="text-[11px] font-mono" style={{ color: '#333' }}>
            All processing happens in-browser. No data leaves your machine.
          </p>
        </>
      )}
    </div>
  )
}
