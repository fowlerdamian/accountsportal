const CIN7_BASE = 'https://inventory.dearsystems.com/ExternalApi/v2'

// ─── Single SO lookup ─────────────────────────────────────────────────────────
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
// Expects a small batch of SO numbers (sent by the frontend in groups).
// Processes sequentially to avoid bursting Cin7's rate limit within a batch.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const accountId = process.env.CIN7_ACCOUNT_ID
  const apiKey    = process.env.CIN7_API_KEY

  if (!accountId || !apiKey) {
    return res.status(200).json({})
  }

  const { orders } = req.body ?? {}
  if (!Array.isArray(orders) || orders.length === 0) {
    return res.status(400).json({ error: 'orders must be a non-empty array' })
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
