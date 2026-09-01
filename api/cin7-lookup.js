const CIN7_BASE = 'https://inventory.dearsystems.com/ExternalApi/v2'

const PAGE_LIMIT = 1000

// ─── Bulk page fetch ──────────────────────────────────────────────────────────
// One saleList page (up to 1000 sales) yields OrderNumber → Sale URL for every
// sale on it — the client pages through these until all its SOs are matched.
// Far cheaper than one Search call per SO against Cin7's 60 req/min limit.
async function fetchSalePage(page, accountId, apiKey) {
  const url = `${CIN7_BASE}/saleList?Page=${page}&Limit=${PAGE_LIMIT}`
  const resp = await fetch(url, {
    headers: {
      'api-auth-accountid':      accountId,
      'api-auth-applicationkey': apiKey,
    },
  })

  if (!resp.ok) return null

  const data = await resp.json()
  const list = Array.isArray(data?.SaleList) ? data.SaleList : []
  const links = {}
  for (const sale of list) {
    const so = sale?.OrderNumber
    const id = sale?.SaleID ?? sale?.ID
    if (so && id) links[so] = `https://inventory.dearsystems.com/Sale#${id}`
  }
  return { links, count: list.length }
}

// ─── Legacy single SO lookup (kept for stale frontend bundles) ────────────────
async function lookupOne(soNum, accountId, apiKey) {
  const url = `${CIN7_BASE}/saleList?Search=${encodeURIComponent(soNum)}&Limit=1`
  const resp = await fetch(url, {
    headers: {
      'api-auth-accountid':      accountId,
      'api-auth-applicationkey': apiKey,
    },
  })

  if (!resp.ok) return null

  const data = await resp.json()
  const sale = data?.SaleList?.[0]
  const id = sale?.SaleID ?? sale?.ID ?? null
  return id ? `https://inventory.dearsystems.com/Sale#${id}` : null
}

// ─── Handler ──────────────────────────────────────────────────────────────────
// New shape: { page } → { links: { "SO-xxx": url, … }, count, limit }
// Legacy shape: { orders: ["SO-xxx", …] } → { "SO-xxx": url, … }
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const accountId = process.env.CIN7_ACCOUNT_ID
  const apiKey    = process.env.CIN7_API_KEY

  const { page, orders } = req.body ?? {}

  if (Number.isInteger(page) && page > 0) {
    if (!accountId || !apiKey) {
      return res.status(200).json({ links: {}, count: 0, limit: PAGE_LIMIT })
    }
    try {
      const result = await fetchSalePage(page, accountId, apiKey)
      return res.status(200).json(result ?? { links: {}, count: 0, limit: PAGE_LIMIT })
    } catch {
      return res.status(200).json({ links: {}, count: 0, limit: PAGE_LIMIT })
    }
  }

  if (!Array.isArray(orders) || orders.length === 0) {
    return res.status(400).json({ error: 'pass { page } or a non-empty { orders } array' })
  }

  if (!accountId || !apiKey) {
    return res.status(200).json({})
  }

  const result = {}
  for (const so of orders) {
    try {
      const url = await lookupOne(so, accountId, apiKey)
      if (url) result[so] = url
    } catch {
      // skip failed lookups — partial results are fine
    }
  }

  return res.status(200).json(result)
}
