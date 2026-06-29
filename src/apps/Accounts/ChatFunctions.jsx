import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { supabase } from '../../lib/supabase.js'
import { useIsAdmin } from '../../hooks/useIsAdmin.js'

// ─── Primitives (match Settings.jsx) ──────────────────────────────────────────

const inputStyle = {
  width: '100%', boxSizing: 'border-box',
  background: '#111113', border: '1px solid #222222',
  borderRadius: '6px', padding: '8px 12px',
  fontSize: '13px', color: '#ffffff',
  fontFamily: 'inherit', outline: 'none',
}

const labelStyle = {
  fontSize: '11px', color: '#a0a0a0',
  fontFamily: '"JetBrains Mono", monospace',
  letterSpacing: '0.08em', textTransform: 'uppercase',
  display: 'block', marginBottom: '6px',
}

const monoStyle = { fontFamily: '"JetBrains Mono", monospace' }

function Card({ children, style }) {
  return (
    <div style={{
      background: '#0a0a0a', border: '1px solid #222222',
      borderRadius: '8px', padding: '20px 24px',
      ...style,
    }}>
      {children}
    </div>
  )
}

function Toggle({ checked, onChange, disabled }) {
  return (
    <button
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      style={{
        width: '36px', height: '20px', borderRadius: '10px', border: 'none',
        background: checked ? 'var(--brand-accent)' : '#222222',
        cursor: disabled ? 'not-allowed' : 'pointer',
        position: 'relative', transition: 'background 150ms', flexShrink: 0,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <span style={{
        position: 'absolute', top: '2px',
        left: checked ? '18px' : '2px',
        width: '16px', height: '16px', borderRadius: '50%',
        background: '#fff', transition: 'left 150ms',
      }} />
    </button>
  )
}

function SectionHeading({ children }) {
  return (
    <h2 style={{
      fontSize: '11px', fontWeight: 600, color: '#a0a0a0',
      letterSpacing: '0.12em', textTransform: 'uppercase',
      margin: '0 0 12px',
      ...monoStyle,
    }}>
      {children}
    </h2>
  )
}

function Button({ tone = 'gold', disabled, onClick, children }) {
  const palette = {
    gold: { fg: 'var(--brand-accent)', border: 'rgba(243,202,15,0.4)' },
    blue: { fg: '#60A5FA', border: 'rgba(96,165,250,0.4)' },
    red:  { fg: '#ff1744', border: 'rgba(239,68,68,0.4)' },
  }[tone]
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        fontSize: '11px', fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase',
        ...monoStyle,
        color: disabled ? '#444' : palette.fg,
        background: 'none', border: '1px solid',
        borderColor: disabled ? '#222' : palette.border,
        borderRadius: '4px', padding: '6px 14px',
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {children}
    </button>
  )
}

// ─── Per-function config schema ──────────────────────────────────────────────

const CONFIG_SCHEMA = {
  'cin7-daily-digest': [
    { key: 'ops_webhook',           label: 'Main Office Webhook URL', type: 'webhook', placeholder: 'https://chat.googleapis.com/v1/spaces/...' },
    { key: 'max_items_per_section', label: 'Max Items Per Section',   type: 'number',  placeholder: '15' },
    { key: 'escalation_webhook',    label: 'Escalation Webhook (optional)', type: 'webhook', placeholder: 'Pinged after N consecutive failures' },
    { key: 'escalation_threshold',  label: 'Escalation Threshold (consecutive errors)', type: 'number', placeholder: '3' },
  ],
  'cin7-realtime-alerts': [
    { key: 'ops_webhook',                 label: 'Main Office Webhook URL', type: 'webhook', placeholder: 'https://chat.googleapis.com/v1/spaces/...' },
    { key: 'mgmt_webhook',                label: 'Management Webhook URL',  type: 'webhook', placeholder: 'https://chat.googleapis.com/v1/spaces/...' },
    { key: 'unauthorised_stuck_days',     label: 'Unauthorised Stuck (days)',          type: 'number', placeholder: '5'   },
    { key: 'shipped_not_invoiced_hours',  label: 'Shipped Not Invoiced (hours)',       type: 'number', placeholder: '24'  },
    { key: 'distributor_order_threshold', label: 'Distributor Order Threshold ($AUD)', type: 'number', placeholder: '1000' },
    { key: 'min_margin_percent',          label: 'Min Margin Alert (%)',               type: 'number', placeholder: '20'  },
    { key: 'dedup_window_hours',          label: 'Dedup Window (hours, 0=off)',        type: 'number', placeholder: '12'  },
    { key: 'escalation_webhook',          label: 'Escalation Webhook (optional)',      type: 'webhook', placeholder: 'Pinged after N consecutive failures' },
    { key: 'escalation_threshold',        label: 'Escalation Threshold (consecutive errors)', type: 'number', placeholder: '3' },
  ],
  'cin7-diagnostic': [],
}

const SCHEDULE_LABEL = {
  'cin7-daily-digest':    'Runs daily at 7:30am AEST',
  'cin7-realtime-alerts': 'Runs every 15 minutes',
  'cin7-diagnostic':      'Manual trigger only',
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function deepEqual(a, b) {
  if (a === b) return true
  if (typeof a !== typeof b) return false
  if (typeof a !== 'object' || a === null || b === null) return false
  const ka = Object.keys(a); const kb = Object.keys(b)
  if (ka.length !== kb.length) return false
  return ka.every(k => deepEqual(a[k], b[k]))
}

function relativeTime(iso) {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  const s = Math.floor(diff / 1000)
  if (s < 60)    return `${s}s ago`
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

// ─── Function row ────────────────────────────────────────────────────────────

function FunctionRow({ row, onChange, isAdmin }) {
  const [expanded,  setExpanded]  = useState(false)
  const [config,    setConfig]    = useState(row.config ?? {})
  const [saving,    setSaving]    = useState(false)
  const [saved,     setSaved]     = useState(false)
  const [running,   setRunning]   = useState(false)
  const [runResult, setRunResult] = useState(null)
  const [testing,   setTesting]   = useState(null) // key being tested
  const [clearing,  setClearing]  = useState(false)
  const [error,     setError]     = useState(null)

  const savedTimeoutRef = useRef(null)

  // Sync from server when row.config changes externally
  useEffect(() => { setConfig(row.config ?? {}) }, [row.config])

  // Cleanup the "Saved" flash timer on unmount
  useEffect(() => () => clearTimeout(savedTimeoutRef.current), [])

  const fields = CONFIG_SCHEMA[row.slug] ?? []
  const dirty  = !deepEqual(config, row.config ?? {})

  const toggleEnabled = async (val) => {
    setError(null)
    const { error } = await supabase
      .from('chat_function_settings')
      .update({ enabled: val })
      .eq('slug', row.slug)
    if (error) { setError(error.message); return }
    onChange({ ...row, enabled: val })
  }

  const saveConfig = async () => {
    setSaving(true); setError(null)
    const { error } = await supabase
      .from('chat_function_settings')
      .update({ config })
      .eq('slug', row.slug)
    setSaving(false)
    if (error) { setError(error.message); return }
    onChange({ ...row, config })
    setSaved(true)
    clearTimeout(savedTimeoutRef.current)
    savedTimeoutRef.current = setTimeout(() => setSaved(false), 2500)
  }

  const runNow = async ({ dryRun = false } = {}) => {
    if (dirty) {
      const proceed = window.confirm(
        'You have unsaved changes. Save them first?\n\n' +
        'OK  → save & run\n' +
        'Cancel → discard local changes & run with saved settings',
      )
      if (proceed) {
        await saveConfig()
      } else {
        setConfig(row.config ?? {})
      }
    }
    setRunning(true); setError(null); setRunResult(null)
    const { data, error } = await supabase.functions.invoke(row.slug, {
      body: dryRun ? { dry_run: true } : {},
    })
    setRunning(false)
    if (error) { setError(error.message); return }
    setRunResult(data)
    // Refresh row to pick up new last_run_*
    const { data: fresh } = await supabase
      .from('chat_function_settings')
      .select('*')
      .eq('slug', row.slug)
      .maybeSingle()
    if (fresh) onChange(fresh)
  }

  const sendTest = async (key) => {
    const url = (config[key] ?? '').toString().trim()
    if (!url) { setError(`${key}: webhook URL is empty`); return }
    setTesting(key); setError(null)
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `🧪 Test from Staff Portal · ${row.display_name} · ${new Date().toLocaleString('en-AU')}`,
        }),
      })
      if (!res.ok) setError(`${key}: ${res.status} ${res.statusText}`)
    } catch (e) {
      setError(`${key}: ${String(e)}`)
    } finally {
      setTesting(null)
    }
  }

  const setField = (key, raw, type) => {
    const value = type === 'number'
      ? (raw === '' ? '' : Number(raw))
      : raw
    setConfig(prev => ({ ...prev, [key]: value }))
  }

  const clearDedup = async () => {
    if (!window.confirm(`Clear all stored alert fingerprints for ${row.display_name}?\n\nThe next run will re-post any alert that was previously deduped.`)) return
    setClearing(true); setError(null)
    const { error } = await supabase
      .from('chat_function_alerts')
      .delete()
      .eq('slug', row.slug)
    setClearing(false)
    if (error) setError(`clear dedup: ${error.message}`)
  }

  const lastRun = row.last_run_at
    ? `${row.last_run_status ?? 'ran'} · ${relativeTime(row.last_run_at)}`
    : 'never run'
  const lastRunColor = row.last_run_status === 'error' ? '#ff1744' : '#666'
  const errorCount = row.consecutive_errors ?? 0
  const supportsDedup = row.slug === 'cin7-realtime-alerts'

  return (
    <Card style={{ padding: 0 }}>
      {/* Header */}
      <div
        style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '14px 20px', cursor: 'pointer' }}
        onClick={() => setExpanded(v => !v)}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '13px', color: '#ffffff', fontWeight: 500 }}>
            {row.display_name}
          </div>
          <div style={{ fontSize: '11px', color: '#666', marginTop: '4px', ...monoStyle }}>
            {SCHEDULE_LABEL[row.slug] ?? row.slug}
            <span style={{ color: lastRunColor, marginLeft: '8px' }}>· {lastRun}</span>
            {errorCount > 0 && (
              <span style={{ color: '#ff1744', marginLeft: '8px' }}>· {errorCount} consecutive error{errorCount > 1 ? 's' : ''}</span>
            )}
          </div>
        </div>

        <div onClick={e => e.stopPropagation()}>
          <Toggle checked={row.enabled} onChange={toggleEnabled} disabled={!isAdmin} />
        </div>

        <span style={{
          color: '#444', fontSize: '12px',
          transition: 'transform 150ms',
          transform: expanded ? 'rotate(180deg)' : 'none', flexShrink: 0,
        }}>▾</span>
      </div>

      {/* Expanded panel */}
      {expanded && (
        <div style={{ borderTop: '1px solid #1a1a1a', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>

          {row.description && (
            <div style={{ fontSize: '12px', color: '#a0a0a0', lineHeight: 1.5 }}>
              {row.description}
            </div>
          )}

          {fields.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {fields.map(f => (
                <div key={f.key}>
                  <label style={labelStyle}>{f.label}</label>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'stretch' }}>
                    <input
                      type={f.type === 'number' ? 'number' : 'text'}
                      value={config[f.key] ?? ''}
                      placeholder={f.placeholder}
                      disabled={!isAdmin}
                      onChange={e => setField(f.key, e.target.value, f.type)}
                      style={{ ...inputStyle, opacity: isAdmin ? 1 : 0.6, flex: 1 }}
                    />
                    {f.type === 'webhook' && (
                      <Button
                        tone="blue"
                        disabled={!isAdmin || testing === f.key || !(config[f.key] ?? '').toString().trim()}
                        onClick={() => sendTest(f.key)}
                      >
                        {testing === f.key ? 'Sending…' : 'Send Test'}
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {row.last_run_summary && (
            <details>
              <summary style={{ cursor: 'pointer', fontSize: '11px', color: '#a0a0a0', ...monoStyle, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                Last run summary
              </summary>
              <pre style={{
                margin: '8px 0 0', fontSize: '11px', color: '#a0a0a0',
                background: '#050505', border: '1px solid #1a1a1a',
                borderRadius: '6px', padding: '10px 12px', maxHeight: '200px', overflow: 'auto',
                ...monoStyle, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              }}>
                {JSON.stringify(row.last_run_summary, null, 2)}
              </pre>
            </details>
          )}

          {error && (
            <div style={{ fontSize: '12px', color: '#ff1744', ...monoStyle }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <Button tone="blue" disabled={running || !row.enabled} onClick={() => runNow({ dryRun: false })}>
                {running ? 'Running…' : 'Run Now'}
              </Button>
              {row.slug !== 'cin7-diagnostic' && (
                <Button tone="blue" disabled={running || !row.enabled} onClick={() => runNow({ dryRun: true })}>
                  {running ? 'Running…' : 'Dry Run'}
                </Button>
              )}
              {supportsDedup && (
                <Button tone="red" disabled={!isAdmin || clearing} onClick={clearDedup}>
                  {clearing ? 'Clearing…' : 'Clear Dedup'}
                </Button>
              )}
            </div>

            {fields.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                {dirty && <span style={{ fontSize: '11px', color: 'var(--brand-accent)', ...monoStyle }}>● Unsaved</span>}
                {saved && <span style={{ fontSize: '11px', color: '#60a57e', ...monoStyle }}>Saved</span>}
                <Button
                  tone="gold"
                  disabled={saving || !isAdmin || !dirty}
                  onClick={saveConfig}
                >
                  {saving ? 'Saving…' : 'Save Settings'}
                </Button>
              </div>
            )}
          </div>

          {runResult && (
            <pre style={{
              margin: 0, fontSize: '11px', color: '#a0a0a0',
              background: '#050505', border: '1px solid #1a1a1a',
              borderRadius: '6px', padding: '10px 12px',
              maxHeight: '320px', overflow: 'auto',
              ...monoStyle, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            }}>
              {typeof runResult === 'string' ? runResult : JSON.stringify(runResult, null, 2)}
            </pre>
          )}
        </div>
      )}
    </Card>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function ChatFunctions() {
  const { isAdmin, checking } = useIsAdmin()
  const [rows,    setRows]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    const { data, error } = await supabase
      .from('chat_function_settings')
      .select('*')
      .order('slug')
    setLoading(false)
    if (error) { setError(error.message); return }
    setRows(data ?? [])
  }, [])

  useEffect(() => { load() }, [load])

  // Auto-refresh telemetry every 30s while the page is open.
  useEffect(() => {
    const id = setInterval(async () => {
      const { data } = await supabase
        .from('chat_function_settings')
        .select('slug, enabled, last_run_at, last_run_status, last_run_summary, consecutive_errors')
        .order('slug')
      if (!data) return
      setRows(prev => {
        if (!prev) return prev
        return prev.map(r => {
          const next = data.find(d => d.slug === r.slug)
          return next ? { ...r, ...next } : r
        })
      })
    }, 30_000)
    return () => clearInterval(id)
  }, [])

  const updateRow = (next) => {
    setRows(prev => prev.map(r => r.slug === next.slug ? next : r))
  }

  return (
    <div style={{
      flex: 1, overflowY: 'auto', padding: '40px 24px',
      maxWidth: '800px', margin: '0 auto', width: '100%', boxSizing: 'border-box',
    }}>
      <div style={{ marginBottom: '32px' }}>
        <h1 style={{ fontSize: '18px', fontWeight: 600, color: '#ffffff', margin: 0, letterSpacing: '-0.01em' }}>
          Chat Functions
        </h1>
        <p style={{ fontSize: '13px', color: '#a0a0a0', margin: '4px 0 0', ...monoStyle }}>
          Cin7 → Google Chat automations
        </p>
      </div>

      <SectionHeading>Functions</SectionHeading>

      {error && (
        <div style={{
          marginBottom: '16px', padding: '10px 14px',
          background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
          borderRadius: '6px', color: '#ff1744', fontSize: '12px',
          ...monoStyle,
        }}>
          {error}
        </div>
      )}

      {loading || checking ? (
        <div style={{ color: '#555', fontSize: '12px', padding: '16px 0', ...monoStyle }}>
          Loading…
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {(rows ?? []).map(row => (
            <FunctionRow key={row.slug} row={row} onChange={updateRow} isAdmin={isAdmin} />
          ))}
          {(rows ?? []).length === 0 && (
            <div style={{ color: '#555', fontSize: '12px', ...monoStyle }}>
              No chat functions configured.
            </div>
          )}
        </div>
      )}

      {!checking && !isAdmin && (
        <div style={{ marginTop: '20px', fontSize: '11px', color: '#555', ...monoStyle }}>
          Read-only — admin access required to change settings.
        </div>
      )}
    </div>
  )
}
