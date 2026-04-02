import { useState, useCallback } from 'react'
import DropZone from './components/DropZone.jsx'
import ProfitDashboard from './components/ProfitDashboard.jsx'
import { readExcelFile, parseSheet } from './utils/excelParser.js'
import { processOrders } from './utils/processor.js'

// ─── Cin7 link lookup ─────────────────────────────────────────────────────────
// Sends SO numbers in small batches with a pause between each to stay within
// Cin7's rate limit. Links are merged into state as each batch resolves so
// the table updates incrementally rather than all-at-once.
const BATCH_SIZE  = 5
const BATCH_DELAY = 1200 // ms between batches — keeps well under 60 req/min

async function fetchOrderLinks(soNumbers, setOrderLinks, setLinksLoading) {
  setLinksLoading(true)
  try {
    for (let i = 0; i < soNumbers.length; i += BATCH_SIZE) {
      const batch = soNumbers.slice(i, i + BATCH_SIZE)
      try {
        const resp = await fetch('/api/cin7-lookup', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ orders: batch }),
        })
        if (resp.ok) {
          const links = await resp.json()
          setOrderLinks((prev) => ({ ...prev, ...links }))
        }
      } catch {
        // batch failed — continue to next batch
      }

      if (i + BATCH_SIZE < soNumbers.length) {
        await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY))
      }
    }
  } finally {
    setLinksLoading(false)
  }
}

export default function ProfitProcessor() {
  const [result, setResult]           = useState(null)
  const [error, setError]             = useState(null)
  const [loading, setLoading]         = useState(false)
  const [fileName, setFileName]       = useState('')
  const [orderLinks, setOrderLinks]   = useState({})
  const [linksLoading, setLinksLoading] = useState(false)

  const handleFile = useCallback(async (file) => {
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
      fetchOrderLinks(soNumbers, setOrderLinks, setLinksLoading)
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
            style={{ borderColor: '#E8A838', borderTopColor: 'transparent' }}
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
                background: 'rgba(127,29,29,0.15)',
                border: '1px solid rgba(127,29,29,0.5)',
              }}
            >
              <p className="text-sm font-mono" style={{ color: '#FCA5A5' }}>
                <span style={{ color: '#EF4444' }}>Error: </span>
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
