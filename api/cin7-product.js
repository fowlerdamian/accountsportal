// Look a product up in Cin7 Core by SKU for the Barcode Labels tool.
//
//   POST /api/cin7-product  { sku: "TCZP" }
//   → 200 { product: { sku, name, barcode } }
//   → 404 { error: "No product with SKU …" }
//   → 503 { error: "Cin7 is not configured" }
//
// Cin7 Core's product endpoint treats the Sku filter as a prefix; only an exact
// (case-insensitive) match is returned, so a partial SKU never pulls up a product.

const CIN7_BASE = 'https://inventory.dearsystems.com/ExternalApi/v2'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const accountId = process.env.CIN7_ACCOUNT_ID
  const apiKey    = process.env.CIN7_API_KEY
  if (!accountId || !apiKey) return res.status(503).json({ error: 'Cin7 is not configured' })

  const sku = String(req.body?.sku ?? '').trim()
  if (!sku) return res.status(400).json({ error: 'Enter a SKU' })
  if (sku.length > 64) return res.status(400).json({ error: 'SKU is too long' })

  let data
  try {
    const resp = await fetch(`${CIN7_BASE}/product?Sku=${encodeURIComponent(sku)}&Limit=20`, {
      headers: { 'api-auth-accountid': accountId, 'api-auth-applicationkey': apiKey },
    })
    if (!resp.ok) return res.status(502).json({ error: `Cin7 returned ${resp.status}` })
    data = await resp.json()
  } catch (e) {
    return res.status(502).json({ error: `Cin7 request failed: ${e?.message ?? e}` })
  }

  // Cin7 treats the Sku filter as a prefix, so only an exact (case-insensitive)
  // match counts — a partial SKU must not pull up whichever product sorts first.
  const products = Array.isArray(data?.Products) ? data.Products : []
  const product = products.find(p => String(p?.SKU ?? '').toLowerCase() === sku.toLowerCase())
  if (!product) {
    const near = products.map(p => String(p?.SKU ?? '')).filter(Boolean).slice(0, 5)
    const hint = near.length ? ` — enter the full SKU (did you mean ${near.join(', ')}?)` : ''
    return res.status(404).json({ error: `No product with SKU ${sku} in Cin7${hint}` })
  }

  return res.status(200).json({
    product: {
      sku:     String(product.SKU ?? sku),
      name:    String(product.Name ?? ''),
      barcode: String(product.Barcode ?? ''),
    },
  })
}
