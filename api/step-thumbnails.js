// Cloud CAD thumbnails for R&D project files — no PC involved.
//
// Every 10 min pg_cron POSTs here with `Authorization: Bearer $CRON_SECRET`.
// Works through public.step_thumbnail_queue (STEP/STP files never rendered from
// their current version), renders each with api/_lib/step-render.js
// (OpenCascade wasm + software rasteriser), uploads
// contractor-hub-files/file-thumbnails/{id}.png and stamps the row. Time-boxed
// so a big backlog drains over several runs.
//
// Env: SUPABASE_URL (or VITE_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET.

import { stepTriangles, renderPng } from './_lib/step-render.js'

const BUCKET = 'contractor-hub-files'
const BUDGET_MS = 45_000  // Hobby plan: function capped at 60 s; backlog drains over several runs

export default async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || (req.headers['authorization'] ?? '') !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'unauthorized' })
  }
  const base = (process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '').replace(/\/$/, '')
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!base || !key) return res.status(500).json({ error: 'Supabase env missing' })
  const h = { apikey: key, Authorization: `Bearer ${key}` }

  const started = Date.now()
  const qr = await fetch(`${base}/rest/v1/rpc/step_thumbnail_queue`, {
    method: 'POST', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_limit: 40 }),
  })
  if (!qr.ok) return res.status(502).json({ error: `queue ${qr.status}: ${await qr.text()}` })
  const queue = await qr.json()

  const done = [], failed = []
  for (const f of queue) {
    if (Date.now() - started > BUDGET_MS) break
    try {
      // Stamp first: if a huge part blows the 60 s limit mid-render, it is skipped
      // next run instead of wedging the head of the queue.
      await patch(base, h, f.id, { thumbnail_source_mtime: f.modified_at })
      const bytes = await fetchStep(base, h, f)
      const png = renderPng(await stepTriangles(bytes))
      const path = `file-thumbnails/${f.id}.png`
      const up = await fetch(`${base}/storage/v1/object/${BUCKET}/${path}`, {
        method: 'POST', headers: { ...h, 'Content-Type': 'image/png', 'x-upsert': 'true' }, body: png,
      })
      if (!up.ok) throw new Error(`upload ${up.status}: ${(await up.text()).slice(0, 200)}`)
      await patch(base, h, f.id, {
        thumbnail_url: `${base}/storage/v1/object/public/${BUCKET}/${path}?v=${Math.floor(Date.now() / 1000)}`,
        thumbnail_source_mtime: f.modified_at,
      })
      done.push(f.filename)
    } catch (e) {
      // stamp the attempt so a broken file isn't retried until it changes
      await patch(base, h, f.id, { thumbnail_source_mtime: f.modified_at }).catch(() => {})
      failed.push({ file: f.filename, error: String(e?.message ?? e).slice(0, 200) })
    }
  }
  res.status(200).json({ queued: queue.length, rendered: done.length, failed, ms: Date.now() - started })
}

async function fetchStep(base, h, f) {
  if (f.source === 'drive' && f.drive_file_id) {
    const r = await fetch(`${base}/functions/v1/google-drive`, {
      method: 'POST', headers: { ...h, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'download_bytes', drive_file_id: f.drive_file_id }),
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok || !j.base64) throw new Error(`Drive download: ${j.error ?? r.status}`)
    return new Uint8Array(Buffer.from(j.base64, 'base64'))
  }
  const r = await fetch(f.file_url)
  if (!r.ok) throw new Error(`download ${r.status}`)
  return new Uint8Array(await r.arrayBuffer())
}

async function patch(base, h, id, body) {
  const r = await fetch(`${base}/rest/v1/files?id=eq.${id}`, {
    method: 'PATCH', headers: { ...h, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`patch ${r.status}`)
}
