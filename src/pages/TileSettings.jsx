import { Link } from 'react-router-dom'
import {
  BarChart3, Truck, ShoppingCart, Headphones, Wrench, BookOpen, Settings,
  Package, Users, DollarSign, TrendingUp, ClipboardCheck, ShieldCheck,
} from 'lucide-react'
import { APPS } from '../config/apps.js'
import { useAllUserTileSettings } from '../hooks/useTileSettings.js'
import { useIsAdmin } from '../hooks/useIsAdmin.js'

const ICON_MAP = {
  BarChart3, Truck, ShoppingCart, Headphones, Wrench, BookOpen, Settings,
  Package, Users, DollarSign, TrendingUp, ClipboardCheck, ShieldCheck,
}

function AppIcon({ name }) {
  const Icon = ICON_MAP[name]
  if (!Icon) return <span style={{ fontSize: '12px', color: '#555' }}>{name}</span>
  return <Icon size={14} strokeWidth={1.5} />
}

const LIVE_APPS = APPS.filter(a => a.status === 'live' || a.status === 'beta')

// Apps that support sub-access levels (route → [modes])
const SUPPORT_MODES = {
  '/support': ['full', 'dashboard', 'off'],
}

function SupportModeSelector({ userId, settings, toggle, saving }) {
  const isOff = settings[userId]?.['/support'] === false
  const isDashOnly = settings[userId]?.['/support/dashboard-only'] === true
  const mode = isOff ? 'off' : isDashOnly ? 'dashboard' : 'full'

  const setMode = (next) => {
    if (next === 'off') {
      toggle(userId, '/support', false)
      toggle(userId, '/support/dashboard-only', false)
    } else if (next === 'dashboard') {
      toggle(userId, '/support', true)
      toggle(userId, '/support/dashboard-only', true)
    } else {
      toggle(userId, '/support', true)
      toggle(userId, '/support/dashboard-only', false)
    }
  }

  const btn = (value, label) => (
    <button
      key={value}
      onClick={() => !saving && setMode(value)}
      disabled={saving}
      style={{
        padding: '2px 6px', fontSize: '9px', border: 'none', cursor: saving ? 'not-allowed' : 'pointer',
        fontFamily: '"JetBrains Mono", monospace', letterSpacing: '0.06em', textTransform: 'uppercase',
        background: mode === value ? '#f3ca0f' : '#1a1a1a',
        color: mode === value ? '#000' : '#555',
        borderRadius: value === 'full' ? '4px 0 0 4px' : value === 'off' ? '0 4px 4px 0' : '0',
        opacity: saving ? 0.5 : 1,
      }}
    >{label}</button>
  )

  return (
    <div style={{ display: 'flex', justifyContent: 'center' }}>
      <div style={{ display: 'inline-flex', border: '1px solid #222', borderRadius: '4px', overflow: 'hidden' }}>
        {btn('full', 'Full')}
        {btn('dashboard', 'Dash')}
        {btn('off', 'Off')}
      </div>
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
        background: checked ? '#f3ca0f' : '#222222',
        cursor: disabled ? 'not-allowed' : 'pointer',
        position: 'relative', transition: 'background 150ms', flexShrink: 0,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <span style={{
        position: 'absolute', top: '3px',
        left: checked ? '19px' : '3px',
        width: '14px', height: '14px', borderRadius: '50%',
        background: '#fff', transition: 'left 150ms',
      }} />
    </button>
  )
}

export default function TileSettings() {
  const { isAdmin } = useIsAdmin()
  const { users, settings, saving, error, toggle } = useAllUserTileSettings()

  if (!isAdmin) {
    return (
      <div style={{ padding: '40px 24px', color: '#a0a0a0', fontFamily: '"JetBrains Mono", monospace', fontSize: '13px' }}>
        Access denied.
      </div>
    )
  }

  return (
    <div style={{
      flex: 1, overflowY: 'auto', padding: '40px 24px',
      maxWidth: '1200px', margin: '0 auto', width: '100%', boxSizing: 'border-box',
    }}>

      {/* Header */}
      <div style={{ marginBottom: '32px', display: 'flex', alignItems: 'center', gap: '12px' }}>
        <Link
          to="/dashboard"
          style={{
            fontSize: '11px', color: '#a0a0a0', textDecoration: 'none',
            fontFamily: '"JetBrains Mono", monospace', letterSpacing: '0.08em',
            display: 'inline-flex', alignItems: 'center', gap: '4px',
          }}
        >
          ← Dashboard
        </Link>
        <span style={{ color: '#333' }}>/</span>
        <h1 style={{ fontSize: '18px', fontWeight: 600, color: '#ffffff', margin: 0, letterSpacing: '-0.01em' }}>
          Manage Access
        </h1>
        {saving && (
          <span style={{ fontSize: '11px', color: '#a0a0a0', fontFamily: '"JetBrains Mono", monospace', marginLeft: 'auto' }}>
            Saving…
          </span>
        )}
      </div>

      {error && (
        <div style={{ marginBottom: '24px', padding: '12px 16px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '6px', color: '#ff1744', fontSize: '13px', fontFamily: '"JetBrains Mono", monospace' }}>
          {error.message}
        </div>
      )}

      {!users ? (
        <div style={{ color: '#a0a0a0', fontFamily: '"JetBrains Mono", monospace', fontSize: '13px' }}>Loading…</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>

          {/* Column headers */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: `200px repeat(${LIVE_APPS.length}, 1fr)`,
            gap: '8px', padding: '0 16px 12px', alignItems: 'end',
          }}>
            <div style={{ fontSize: '11px', color: '#444', fontFamily: '"JetBrains Mono", monospace', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              User
            </div>
            {LIVE_APPS.map(app => (
              <div key={app.route} style={{
                fontSize: '10px', color: '#444', fontFamily: '"JetBrains Mono", monospace',
                letterSpacing: '0.06em', textTransform: 'uppercase', textAlign: 'center',
                lineHeight: 1.3,
              }}>
                <AppIcon name={app.icon} /><br />{app.name.split(' ')[0]}
              </div>
            ))}
          </div>

          {/* User rows */}
          {users.map(user => {
            const userSettings = settings[user.id] || {}
            return (
              <div
                key={user.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: `200px repeat(${LIVE_APPS.length}, 1fr)`,
                  gap: '8px', padding: '14px 16px', alignItems: 'center',
                  background: '#0a0a0a', border: '1px solid #222222', borderRadius: '6px',
                }}
              >
                {/* User info */}
                <div>
                  <div style={{ fontSize: '12px', color: '#ffffff', marginBottom: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {user.email}
                  </div>
                  <div style={{ fontSize: '10px', color: '#a0a0a0', fontFamily: '"JetBrains Mono", monospace', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    {user.role}
                  </div>
                </div>

                {/* Toggle per tile */}
                {LIVE_APPS.map(app => {
                  if (app.route === '/support') {
                    return (
                      <SupportModeSelector
                        key={app.route}
                        userId={user.id}
                        settings={settings}
                        toggle={toggle}
                        saving={saving}
                      />
                    )
                  }
                  const enabled = userSettings[app.route] !== false // default on
                  return (
                    <div key={app.route} style={{ display: 'flex', justifyContent: 'center' }}>
                      <Toggle
                        checked={enabled}
                        disabled={saving}
                        onChange={val => toggle(user.id, app.route, val)}
                      />
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
