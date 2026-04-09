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

// ─── Single card ─────────────────────────────────────────────────────────────

function Card({ label, value, sub, valueColor = '#ffffff', accent = false }) {
  return (
    <div
      className="rounded-lg p-5 flex flex-col gap-1.5"
      style={{
        background: '#0a0a0a',
        border: `1px solid ${accent ? 'rgba(243,202,15,0.25)' : '#222'}`,
      }}
    >
      <span
        className="text-[10px] uppercase tracking-[0.12em] font-medium"
        style={{ color: '#a0a0a0' }}
      >
        {label}
      </span>
      <span
        className="font-mono text-[1.6rem] leading-none font-medium"
        style={{ color: valueColor }}
      >
        {value}
      </span>
      {sub && (
        <span className="text-[11px] font-mono" style={{ color: '#a0a0a0' }}>
          {sub}
        </span>
      )}
    </div>
  )
}

// ─── Cards row ───────────────────────────────────────────────────────────────

export default function SummaryCards({ totals }) {
  const { revenue, totalCogs, totalProfit, avgGp, flaggedCount, flagBreakdown } = totals

  const profitColor = totalProfit > 0 ? '#60a57e' : totalProfit < 0 ? '#ff1744' : '#888'
  const gpColor     = avgGp >= 20 ? '#60a57e' : '#ff1744'
  const flagColor   = flaggedCount === 0 ? '#60a57e' : flaggedCount <= 3 ? '#f3ca0f' : '#ff1744'

  const flagParts = [
    flagBreakdown.zeroCogs > 0 && `${flagBreakdown.zeroCogs} $0 COGS`,
    flagBreakdown.zeroInv  > 0 && `${flagBreakdown.zeroInv} $0 Inv`,
    flagBreakdown.lowGp    > 0 && `${flagBreakdown.lowGp} Low GP`,
    flagBreakdown.highGp   > 0 && `${flagBreakdown.highGp} High GP`,
  ].filter(Boolean)

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
      <Card
        label="Revenue (ex GST)"
        value={fmtCurrency(revenue)}
      />
      <Card
        label="Total COGS"
        value={fmtCurrency(totalCogs)}
      />
      <Card
        label="Gross Profit"
        value={fmtCurrency(totalProfit)}
        valueColor={profitColor}
      />
      <Card
        label="Avg GP%"
        value={fmtPercent(avgGp)}
        valueColor={gpColor}
        sub={avgGp >= 20 ? 'Above 20% target' : 'Below 20% target'}
      />
      <Card
        label="Flagged Orders"
        value={String(flaggedCount)}
        valueColor={flagColor}
        sub={flagParts.length > 0 ? flagParts.join(' · ') : 'No anomalies detected'}
        accent={flaggedCount > 0}
      />
    </div>
  )
}
