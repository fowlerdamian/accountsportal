// ─── Flag constants ───────────────────────────────────────────────────────────

export const FLAG = {
  ZERO_COGS: 'ZERO_COGS',   // Adjusted COGS is $0 — missing cost record
  ZERO_INV:  'ZERO_INV',    // Invoice ex-GST is $0 — shipped but not billed
  LOW_GP:    'LOW_GP',      // GP% < 20% — margin too thin
  HIGH_GP:   'HIGH_GP',     // GP% > 90% — suspiciously high, likely missing COGS
}

const EPSILON = 0.01

function isZero(v) {
  return Math.abs(v) < EPSILON
}

// ─── Core processing ──────────────────────────────────────────────────────────

export function processOrders(rawRows) {
  const orders = []

  for (const row of rawRows) {
    // 1. Remove GST from invoice (Cin7 invoices include 10% GST)
    const invoiceExGst = row.invoice / 1.1

    // 2. Reconcile COGS: add journal adjustments Cin7 doesn't roll in automatically
    const cogsAdj = row.cogs + row.journals

    // 3. Drop rows where both invoice and COGS round to zero (voided/cancelled orders)
    if (isZero(invoiceExGst) && isZero(cogsAdj)) continue

    // 4. Recalculate profit and GP%
    const profit    = invoiceExGst - cogsAdj
    const gpPercent = isZero(invoiceExGst) ? 0 : (profit / invoiceExGst) * 100

    // 5. Flag anomalies
    // Suppress trivial zero-value flags: zero invoice + COGS < $20, or zero COGS + invoice < $20
    const trivialZeroInv  = isZero(invoiceExGst) && cogsAdj  < 20
    const trivialZeroCogs = isZero(cogsAdj)      && invoiceExGst < 20

    const flags = []
    if (isZero(cogsAdj)      && !trivialZeroCogs) flags.push(FLAG.ZERO_COGS)
    if (isZero(invoiceExGst) && !trivialZeroInv)  flags.push(FLAG.ZERO_INV)
    if (!isZero(invoiceExGst) && gpPercent < 20)  flags.push(FLAG.LOW_GP)
    if (gpPercent > 90)                           flags.push(FLAG.HIGH_GP)

    orders.push({
      orderNum: row.orderNum,
      customer: row.customer,
      invoiceExGst,
      cogsAdj,
      profit,
      gpPercent,
      flags,
    })
  }

  // ─── Totals ───────────────────────────────────────────────────────────────

  const revenue     = orders.reduce((s, o) => s + o.invoiceExGst, 0)
  const totalCogs   = orders.reduce((s, o) => s + o.cogsAdj,      0)
  const totalProfit = revenue - totalCogs
  const avgGp       = isZero(revenue) ? 0 : (totalProfit / revenue) * 100

  const flagBreakdown = {
    zeroCogs: orders.filter((o) => o.flags.includes(FLAG.ZERO_COGS)).length,
    zeroInv:  orders.filter((o) => o.flags.includes(FLAG.ZERO_INV)).length,
    lowGp:    orders.filter((o) => o.flags.includes(FLAG.LOW_GP)).length,
    highGp:   orders.filter((o) => o.flags.includes(FLAG.HIGH_GP)).length,
  }

  return {
    orders,
    totals: {
      revenue,
      totalCogs,
      totalProfit,
      avgGp,
      flaggedCount: orders.filter((o) => o.flags.length > 0).length,
      flagBreakdown,
    },
  }
}
