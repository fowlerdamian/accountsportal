// The one Sync button every finance tab shows: same look, same shared run
// (financeSync.js), and a subtle "Last sync" stamp underneath.
//
// The stamp is the Xero P&L run time — every Sync press and the nightly cron
// write it. The tooltip breaks out each source (Cin7 sales also syncs hourly).

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@portal/lib/supabase'
import { palette } from '@portal/lib/palette'
import { useFinanceSync, SYNC_LABEL } from './financeSync.js'

const C = {
  panel: '#161616', border: '#2a2a2a', text: '#f8fafc', faint: '#666666', bg: '#0a0a0a',
  accent: palette.accent, red: palette.pink,
}
const MONO = '"JetBrains Mono", monospace'

export const SYNC_STAMP_KEY = ['finance-sync-stamp']

function useSyncStamp() {
  return useQuery({
    queryKey: SYNC_STAMP_KEY,
    queryFn: async () => {
      const [snap, cin7] = await Promise.all([
        supabase.from('finance_snapshot').select('source_run_at').order('source_run_at', { ascending: false }).limit(1).maybeSingle(),
        supabase.from('cin7_stat_sync_state').select('last_run, last_snapshot').eq('id', 1).maybeSingle(),
      ])
      return {
        xero: snap.data?.source_run_at ?? null,
        sales: cin7.data?.last_run ?? null,
        stock: cin7.data?.last_snapshot ?? null,
      }
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })
}

// '4m ago' / '2h ago' / '3d ago'
function ago(iso) {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  if (mins < 48 * 60) return `${Math.round(mins / 60)}h ago`
  return `${Math.round(mins / 1440)}d ago`
}
const full = (iso) => (iso ? new Date(iso).toLocaleString('en-AU') : '—')

export default function FinanceSyncButton({ disabled = false }) {
  const qc = useQueryClient()
  const { state, busy, run } = useFinanceSync()
  const { data: stamp } = useSyncStamp()
  const done = state === 'done'
  const tip = stamp
    ? `Xero P&L: ${full(stamp.xero)}\nCin7 sales: ${full(stamp.sales)}\nStock snapshot: ${full(stamp.stock)}`
    : undefined

  return (
    <div data-html2canvas-ignore="true" style={{ position: 'relative', display: 'inline-flex' }}>
      <button onClick={() => run(qc)} disabled={busy || disabled}
        title="Sync Xero + Cin7 across all finance apps"
        style={{
          display: 'flex', alignItems: 'center', gap: 6, cursor: busy ? 'wait' : 'pointer',
          background: done ? C.accent : C.panel, color: done ? C.bg : (state === 'error' ? C.red : C.text),
          border: `1px solid ${done ? C.accent : C.border}`, borderRadius: 7,
          padding: '7px 12px', fontSize: 11.5, fontFamily: MONO, whiteSpace: 'nowrap',
          transition: 'background 120ms, color 120ms',
        }}>
        <style>{'@keyframes finance-sync-spin { to { transform: rotate(360deg) } }'}</style>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          style={busy ? { animation: 'finance-sync-spin 0.8s linear infinite' } : undefined}>
          <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" />
          <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" /><path d="M21 21v-5h-5" />
        </svg>
        {SYNC_LABEL[state] ?? 'Sync all'}
      </button>
      {/* Absolutely placed so the button lines up with its row like before */}
      {stamp?.xero && (
        <span title={tip} style={{ position: 'absolute', top: '100%', right: 0, marginTop: 3, fontSize: 10, color: C.faint, fontFamily: MONO, whiteSpace: 'nowrap', cursor: 'default' }}>
          Last sync {ago(stamp.xero)}
        </span>
      )}
    </div>
  )
}
