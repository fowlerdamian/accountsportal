import { useState, useMemo } from 'react'
import { FLAG } from '../utils/processor.js'

// ─── Formatters ───────────────────────────────────────────────────────────────

function fmtCurrency(value) {
  const abs = Math.abs(value)
  const str = new Intl.NumberFormat('en-AU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(abs)
  return value < 0 ? `-$${str}` : `$${str}`
}

function fmtPercent(value) {
  return `${value.toFixed(1)}%`
}

// ─── Color logic ─────────────────────────────────────────────────────────────

function profitColor(value) {
  if (value > 0.005)  return '#22C55E'
  if (value < -0.005) return '#EF4444'
  return '#888'
}

function gpColor(gpPercent, invoiceExGst) {
  if (Math.abs(invoiceExGst) < 0.01) return '#888'
  if (gpPercent > 90) return '#F59E0B'
  if (gpPercent < 20) return '#EF4444'
  return '#22C55E'
}

// ─── Flag badges ─────────────────────────────────────────────────────────────

const FLAG_STYLE = {
  [FLAG.ZERO_COGS]: { label: '$0 COGS', bg: 'rgba(127,29,29,0.7)',  text: '#FCA5A5', border: '#7F1D1D' },
  [FLAG.ZERO_INV]:  { label: '$0 INV',  bg: 'rgba(124,45,18,0.7)',  text: '#FDBA74', border: '#7C2D12' },
  [FLAG.LOW_GP]:    { label: 'LOW GP',  bg: 'rgba(30,27,75,0.8)',   text: '#A5B4FC', border: '#312E81' },
  [FLAG.HIGH_GP]:   { label: 'HIGH GP', bg: 'rgba(113,63,18,0.7)',  text: '#FDE68A', border: '#713F12' },
}

function FlagBadge({ flag }) {
  const s = FLAG_STYLE[flag]
  if (!s) return null
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium border whitespace-nowrap"
      style={{ background: s.bg, color: s.text, borderColor: s.border }}
    >
      {s.label}
    </span>
  )
}

// ─── Order number cell ────────────────────────────────────────────────────────
// Shows a clickable link if the Cin7 GUID has been resolved, a plain text label
// with a pulsing dot while the lookup is in flight, or plain text if unavailable.

function OrderNumCell({ orderNum, orderLinks, linksLoading }) {
  const url = orderLinks?.[orderNum]

  if (url) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="font-mono text-sm whitespace-nowrap hover:underline underline-offset-2"
        style={{ color: '#E8A838' }}
      >
        {orderNum}
      </a>
    )
  }

  return (
    <span
      className="font-mono text-sm whitespace-nowrap inline-flex items-center gap-1.5"
      style={{ color: '#E8A838' }}
    >
      {orderNum}
      {linksLoading && (
        <span
          className="inline-block w-1 h-1 rounded-full animate-pulse flex-shrink-0"
          style={{ background: '#E8A838', opacity: 0.4 }}
        />
      )}
    </span>
  )
}

// ─── Table row ────────────────────────────────────────────────────────────────

function ApproveCheckbox({ orderNum, isApproved, onToggleApprove }) {
  return (
    <label
      className="inline-flex items-center gap-1.5 cursor-pointer select-none"
      title={isApproved ? 'Approved — click to re-flag' : 'Approve (remove flags)'}
    >
      <span
        className="relative inline-flex items-center justify-center w-3.5 h-3.5 rounded-sm border flex-shrink-0"
        style={{
          background:   isApproved ? '#22C55E' : 'transparent',
          borderColor:  isApproved ? '#22C55E' : '#444',
          transition:   'background 0.15s, border-color 0.15s',
        }}
      >
        {isApproved && (
          <svg width="8" height="6" viewBox="0 0 8 6" fill="none" style={{ display: 'block' }}>
            <path d="M1 3l2 2 4-4" stroke="#000" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )}
        <input
          type="checkbox"
          checked={isApproved}
          onChange={() => onToggleApprove(orderNum)}
          className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
        />
      </span>
    </label>
  )
}

function Row({ order, isEven, orderLinks, linksLoading, isApproved, onToggleApprove }) {
  return (
    <tr style={{ background: isEven ? '#0d0d0d' : '#0a0a0a' }}>
      <td className="px-4 py-2.5">
        <OrderNumCell
          orderNum={order.orderNum}
          orderLinks={orderLinks}
          linksLoading={linksLoading}
        />
      </td>
      <td className="px-4 py-2.5 text-sm max-w-[180px]" style={{ color: '#CCC' }}>
        <span className="block truncate" title={order.customer}>
          {order.customer || '—'}
        </span>
      </td>
      <td className="px-4 py-2.5 text-sm font-mono text-right whitespace-nowrap" style={{ color: '#DDD' }}>
        {fmtCurrency(order.invoiceExGst)}
      </td>
      <td className="px-4 py-2.5 text-sm font-mono text-right whitespace-nowrap" style={{ color: '#DDD' }}>
        {fmtCurrency(order.cogsAdj)}
      </td>
      <td
        className="px-4 py-2.5 text-sm font-mono text-right whitespace-nowrap"
        style={{ color: profitColor(order.profit) }}
      >
        {fmtCurrency(order.profit)}
      </td>
      <td
        className="px-4 py-2.5 text-sm font-mono text-right whitespace-nowrap"
        style={{ color: gpColor(order.gpPercent, order.invoiceExGst) }}
      >
        {fmtPercent(order.gpPercent)}
      </td>
      <td className="px-4 py-2.5">
        {order.flags.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <ApproveCheckbox
              orderNum={order.orderNum}
              isApproved={isApproved}
              onToggleApprove={onToggleApprove}
            />
            {isApproved ? (
              <span className="text-[10px] font-mono" style={{ color: '#22C55E' }}>approved</span>
            ) : (
              order.flags.map((f) => <FlagBadge key={f} flag={f} />)
            )}
          </div>
        ) : (
          <span className="text-[#333] text-xs font-mono">—</span>
        )}
      </td>
    </tr>
  )
}

// ─── Column headers ───────────────────────────────────────────────────────────

const COLUMNS = [
  { label: 'Order #',          align: 'left',  key: 'orderNum'     },
  { label: 'Customer',         align: 'left',  key: 'customer'     },
  { label: 'Invoice (ex GST)', align: 'right', key: 'invoiceExGst' },
  { label: 'COGS (adj)',       align: 'right', key: 'cogsAdj'      },
  { label: 'Profit',           align: 'right', key: 'profit'       },
  { label: 'GP%',              align: 'right', key: 'gpPercent'    },
  { label: 'Flags',            align: 'left',  key: null           },
]

function SortIcon({ dir }) {
  return (
    <svg width="8" height="10" viewBox="0 0 8 10" fill="none" style={{ display: 'inline', marginLeft: 4, verticalAlign: 'middle', flexShrink: 0 }}>
      <path d="M4 1v8M1 4L4 1l3 3" stroke={dir === 'asc' ? 'currentColor' : '#333'} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M4 9L1 6l3 3 3-3" stroke={dir === 'desc' ? 'currentColor' : '#333'} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

// ─── Main table ───────────────────────────────────────────────────────────────

export default function DataTable({ orders, orderLinks = {}, linksLoading = false, approved = new Set(), onToggleApprove = () => {} }) {
  const [sortCol, setSortCol] = useState(null)
  const [sortDir, setSortDir] = useState('asc')

  function handleSort(key) {
    if (!key) return
    if (sortCol === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortCol(key)
      setSortDir('asc')
    }
  }

  const sorted = useMemo(() => {
    if (!sortCol) return orders
    return [...orders].sort((a, b) => {
      const av = a[sortCol]
      const bv = b[sortCol]
      const cmp = typeof av === 'string' ? av.localeCompare(bv) : av - bv
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [orders, sortCol, sortDir])

  if (orders.length === 0) {
    return (
      <div
        className="flex items-center justify-center py-24 font-mono text-sm"
        style={{ color: '#444' }}
      >
        No orders to display.
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse min-w-[780px]">
        <thead>
          <tr
            className="sticky top-0 z-10"
            style={{ background: '#141414', borderBottom: '1px solid #222' }}
          >
            {COLUMNS.map((col) => {
              const isActive = sortCol === col.key
              return (
                <th
                  key={col.label}
                  onClick={() => handleSort(col.key)}
                  className={`px-4 py-3 text-[10px] font-medium uppercase tracking-[0.1em] whitespace-nowrap ${
                    col.align === 'right' ? 'text-right' : 'text-left'
                  } ${col.key ? 'cursor-pointer select-none' : ''}`}
                  style={{ color: isActive ? '#E8A838' : '#555', transition: 'color 0.15s' }}
                >
                  {col.label}
                  {col.key && <SortIcon dir={isActive ? sortDir : null} />}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((order, idx) => (
            <Row
              key={order.orderNum}
              order={order}
              isEven={idx % 2 === 0}
              orderLinks={orderLinks}
              linksLoading={linksLoading}
              isApproved={approved.has(order.orderNum)}
              onToggleApprove={onToggleApprove}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}
