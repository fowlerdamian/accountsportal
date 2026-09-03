// One sync for every finance app. Pressing any "Sync" / "Refresh" button in the
// Accounts module runs ALL of these together and every button shows the same state:
//   1. /api/finance-snapshot   → xero-pl-snapshot → finance_snapshot   (Finance Dashboard)
//   2. request_xero_invoice_sync RPC (pg_net → edge fn, ~1 min)         (Revenue & Targets)
//   3. cashflow-forecast edge fn re-run (Xero + Cin7 live)              (Cash Flow)
//   4. stat-breakdown-sync edge fn (Cin7 sales → stat + product lines)  (Sales Mix, Stock Turn)
//   5. stock-turn-snapshot edge fn (today's stock on hand at cost)      (Stock Turn)
// Then every finance query key is invalidated so whichever page is open re-renders.

import { useSyncExternalStore } from 'react'
import { supabase } from '@portal/lib/supabase'

export const FINANCE_QUERY_KEYS = [['finance-dashboard'], ['revenue-targets'], ['cashflow-forecast'], ['stat-breakdown'], ['stock-turn']]

// Invoice sync is fired async by pg_net; give it this long before refetching targets.
const INVOICE_SYNC_SETTLE_MS = 75_000

// state: idle | syncing | waiting | done | error
let state = 'idle'
let error = null
const listeners = new Set()
const emit = () => listeners.forEach((l) => l())
function set(next, err = null) { state = next; error = err; emit() }

export function useFinanceSync() {
  const s = useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb) }, () => state)
  return { state: s, error, busy: s === 'syncing' || s === 'waiting', run: runFinanceSync }
}

let inflight = null
let idleTimer = null

/** Run every finance sync job. Safe to call from any page; concurrent calls share one run. */
export function runFinanceSync(qc) {
  if (inflight) return inflight
  clearTimeout(idleTimer)
  set('syncing')
  const invalidateAll = () => Promise.all(FINANCE_QUERY_KEYS.map((queryKey) => qc.invalidateQueries({ queryKey })))

  inflight = (async () => {
    const results = await Promise.allSettled([
      // 1. P&L snapshot (synchronous — returns when finance_snapshot is written)
      fetch('/api/finance-snapshot', { method: 'POST' }).then(async (r) => {
        if (!r.ok) throw new Error(`finance-snapshot ${r.status}: ${await r.text()}`)
      }),
      // 2. Xero invoice sync (async on the server side)
      supabase.rpc('request_xero_invoice_sync').then(({ data, error: e }) => {
        if (e) throw e
        if (!data?.ok) throw new Error(data?.error || 'invoice sync refused')
      }),
      // 3. Cash flow forecast — invalidating forces the edge fn to re-run on refetch
      qc.invalidateQueries({ queryKey: ['cashflow-forecast'] }),
      // 4. Stat Breakdown — scan Cin7 for new/updated sales and drain the queue
      supabase.functions.invoke('stat-breakdown-sync', { body: { drainMs: 60_000 } }).then(({ data, error: e }) => {
        if (e) throw e
        if (data && data.ok === false) throw new Error(data.error || 'stat-breakdown-sync failed')
      }),
      // 5. Stock Turn — fresh stock-on-hand snapshot (~4 Cin7 calls)
      supabase.functions.invoke('stock-turn-snapshot', { body: {} }).then(({ data, error: e }) => {
        if (e) throw e
        if (data && data.ok === false) throw new Error(data.error || 'stock-turn-snapshot failed')
      }),
    ])
    const failed = results.filter((r) => r.status === 'rejected')
    failed.forEach((r) => console.error('[finance sync]', r.reason))

    await invalidateAll()

    if (failed.length === results.length) {
      set('error', failed[0].reason)
      idleTimer = setTimeout(() => set('idle'), 5000)
      return
    }

    // Invoice sync lands ~1 min later; refetch everything again once it has settled.
    set('waiting')
    await new Promise((res) => setTimeout(res, INVOICE_SYNC_SETTLE_MS))
    await invalidateAll()
    set(failed.length ? 'error' : 'done', failed[0]?.reason ?? null)
    idleTimer = setTimeout(() => set('idle'), 4000)
  })().finally(() => { inflight = null })

  return inflight
}

export const SYNC_LABEL = {
  idle: 'Sync all', syncing: 'Syncing…', waiting: 'Syncing… ~1 min', done: 'Synced ✓', error: 'Partial / failed',
}
