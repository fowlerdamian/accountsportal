import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import WarehouseNav from './components/WarehouseNav.jsx'

// Sub-apps are code-split so the tile opens without pulling jspdf + fonts
// until the Barcodes tab is actually used.
const Barcodes = lazy(() => import('./pages/Barcodes'))

function Loading() {
  return <div style={{ padding: '40px 0', color: '#666', fontFamily: '"JetBrains Mono", monospace', fontSize: 12 }}>Loading…</div>
}

export default function Warehouse() {
  return (
    <div style={{ flex: 1, overflowY: 'auto', width: '100%' }}>
      <div style={{ padding: '32px 24px', maxWidth: '1100px', margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
        <div style={{ marginBottom: '16px' }}>
          <h1 style={{ fontSize: '18px', fontWeight: 600, color: '#ffffff', margin: 0, letterSpacing: '-0.01em' }}>Warehouse</h1>
          <p style={{ fontSize: '12px', color: '#a0a0a0', margin: '4px 0 0', fontFamily: '"JetBrains Mono", monospace' }}>
            Labels and stock tools
          </p>
        </div>
        <WarehouseNav />
        <Suspense fallback={<Loading />}>
          <Routes>
            <Route index element={<Navigate to="/warehouse/barcodes" replace />} />
            <Route path="barcodes" element={<Barcodes />} />
            <Route path="*" element={<Navigate to="/warehouse/barcodes" replace />} />
          </Routes>
        </Suspense>
      </div>
    </div>
  )
}
