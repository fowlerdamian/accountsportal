import { useState } from 'react'
import SummaryCards from './SummaryCards.jsx'
import DataTable from './DataTable.jsx'

// ─── Tab button ───────────────────────────────────────────────────────────────

function Tab({ label, count, active, warn, onClick }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 px-5 py-3 text-sm font-medium transition-colors border-b-2 outline-none"
      style={{
        color: active ? '#f3ca0f' : '#666',
        borderBottomColor: active ? '#f3ca0f' : 'transparent',
        background: active ? 'rgba(243,202,15,0.04)' : 'transparent',
      }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.color = '#AAA' }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.color = '#666' }}
    >
      {label}
      <span
        className="px-1.5 py-0.5 rounded text-[10px] font-mono"
        style={{
          background: active
            ? 'rgba(243,202,15,0.15)'
            : warn
              ? 'rgba(127,29,29,0.5)'
              : '#1a1a1a',
          color: active ? '#f3ca0f' : warn ? '#FCA5A5' : '#555',
        }}
      >
        {count}
      </span>
    </button>
  )
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export default function Dashboard({ result, onReset }) {
  const [activeTab, setActiveTab] = useState('all')

  const { orders, totals, metaLines, period, fileName } = result
  const flaggedOrders = orders.filter((o) => o.flags.length > 0)
  const displayOrders = activeTab === 'all' ? orders : flaggedOrders

  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#000000' }}>

      {/* ── Top header bar ──────────────────────────────────────────────────── */}
      <header
        className="flex items-center justify-between flex-wrap gap-3 px-6 py-4 flex-shrink-0"
        style={{ borderBottom: '1px solid #1e1e1e' }}
      >
        <div className="flex items-center gap-3">
          <div className="w-1.5 h-6 rounded-sm" style={{ background: '#f3ca0f' }} />
          <div>
            <p className="text-sm font-semibold tracking-wide uppercase" style={{ color: '#ffffff' }}>
              AGA · Profit Summary Processor
            </p>
            {period && (
              <p className="text-[11px] font-mono mt-0.5" style={{ color: '#666' }}>
                {period}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-5">
          <div className="text-right hidden sm:block">
            <p className="text-[11px] font-mono" style={{ color: '#666' }}>{fileName}</p>
            <p className="text-[11px] font-mono" style={{ color: '#444' }}>
              {orders.length} orders processed
            </p>
          </div>
          <button
            onClick={onReset}
            className="px-4 py-2 text-xs font-medium rounded uppercase tracking-wide transition-colors"
            style={{
              color: '#f3ca0f',
              border: '1px solid rgba(243,202,15,0.35)',
              background: 'transparent',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(243,202,15,0.08)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
          >
            New Report
          </button>
        </div>
      </header>

      {/* ── Metadata strip ──────────────────────────────────────────────────── */}
      {metaLines.length > 0 && (
        <div
          className="px-6 py-2 flex flex-wrap gap-x-6 gap-y-0.5 flex-shrink-0"
          style={{ background: '#0a0a0a', borderBottom: '1px solid #181818' }}
        >
          {metaLines.map((line, i) => (
            <span key={i} className="text-[11px] font-mono" style={{ color: '#a0a0a0' }}>
              {line}
            </span>
          ))}
        </div>
      )}

      {/* ── Main content ────────────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col px-6 py-6 gap-5 overflow-hidden max-w-[1600px] mx-auto w-full">

        {/* Summary cards */}
        <SummaryCards totals={totals} />

        {/* Table card */}
        <div
          className="flex flex-col flex-1 overflow-hidden rounded-lg"
          style={{ border: '1px solid #1e1e1e', background: '#0a0a0a', minHeight: 0 }}
        >
          {/* Tab bar */}
          <div
            className="flex flex-shrink-0"
            style={{ borderBottom: '1px solid #1e1e1e' }}
          >
            <Tab
              label="All Orders"
              count={orders.length}
              active={activeTab === 'all'}
              onClick={() => setActiveTab('all')}
            />
            <Tab
              label="Flagged"
              count={flaggedOrders.length}
              active={activeTab === 'flagged'}
              warn={flaggedOrders.length > 0}
              onClick={() => setActiveTab('flagged')}
            />

            {/* Row count / right side */}
            <div className="ml-auto flex items-center pr-4">
              <span className="text-[11px] font-mono" style={{ color: '#444' }}>
                {displayOrders.length} row{displayOrders.length !== 1 ? 's' : ''}
              </span>
            </div>
          </div>

          {/* Scrollable table */}
          <div className="flex-1 overflow-y-auto overflow-x-auto">
            <DataTable orders={displayOrders} />
          </div>
        </div>
      </main>
    </div>
  )
}
