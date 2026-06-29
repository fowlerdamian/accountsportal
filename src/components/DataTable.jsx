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
  if (value > 0.005)  return 'var(--brand-aqua)'
  if (value < -0.005) return 'var(--brand-pink)'
  return '#888'
}

function gpColor(gpPercent, invoiceExGst) {
  if (Math.abs(invoiceExGst) < 0.01) return '#888'
  if (gpPercent > 90) return 'var(--brand-orange)'
  if (gpPercent < 20) return 'var(--brand-pink)'
  return 'var(--brand-aqua)'
}

// ─── Flag badges ─────────────────────────────────────────────────────────────

const FLAG_STYLE = {
  [FLAG.ZERO_COGS]: { label: '$0 COGS', bg: 'rgba(var(--brand-pink-rgb),0.7)',  text: 'var(--brand-pink)', border: 'var(--brand-pink)' },
  [FLAG.ZERO_INV]:  { label: '$0 INV',  bg: 'rgba(var(--brand-accent-rgb),0.7)',  text: 'var(--brand-orange)', border: 'var(--brand-orange)' },
  [FLAG.LOW_GP]:    { label: 'LOW GP',  bg: 'rgba(var(--brand-purple-rgb),0.8)',   text: 'var(--brand-purple)', border: 'var(--brand-purple)' },
  [FLAG.HIGH_GP]:   { label: 'HIGH GP', bg: 'rgba(var(--brand-accent-rgb),0.7)',  text: 'var(--brand-orange)', border: 'var(--brand-orange)' },
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

// ─── Table row ────────────────────────────────────────────────────────────────

function Row({ order, isEven }) {
  return (
    <tr style={{ background: isEven ? '#0d0d0d' : '#0a0a0a' }}>
      <td className="px-4 py-2.5 text-sm font-mono whitespace-nowrap" style={{ color: 'var(--brand-accent)' }}>
        {order.orderNum}
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
          <div className="flex flex-wrap gap-1">
            {order.flags.map((f) => (
              <FlagBadge key={f} flag={f} />
            ))}
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
  { label: 'Order #',         align: 'left'  },
  { label: 'Customer',        align: 'left'  },
  { label: 'Invoice (ex GST)',align: 'right' },
  { label: 'COGS (adj)',      align: 'right' },
  { label: 'Profit',          align: 'right' },
  { label: 'GP%',             align: 'right' },
  { label: 'Flags',           align: 'left'  },
]

// ─── Main table ───────────────────────────────────────────────────────────────

export default function DataTable({ orders }) {
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
            {COLUMNS.map((col) => (
              <th
                key={col.label}
                className={`px-4 py-3 text-[10px] font-medium uppercase tracking-[0.1em] whitespace-nowrap ${
                  col.align === 'right' ? 'text-right' : 'text-left'
                }`}
                style={{ color: '#a0a0a0' }}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {orders.map((order, idx) => (
            <Row key={order.orderNum} order={order} isEven={idx % 2 === 0} />
          ))}
        </tbody>
      </table>
    </div>
  )
}
