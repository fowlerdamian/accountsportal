import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { supabase } from '../lib/supabase.js'
import { useNavigate } from 'react-router-dom'
import { APPS } from '../config/apps.js'
import { useIsAdmin } from '../hooks/useIsAdmin.js'

const LIVE_APPS = APPS.filter(a => (a.status === 'live' || a.status === 'beta') && a.route !== '/settings')

// ─── Primitives ───────────────────────────────────────────────────────────────

function SectionHeading({ children }) {
  return (
    <h2 style={{
      fontSize: '11px', fontWeight: 600, color: '#555',
      letterSpacing: '0.12em', textTransform: 'uppercase',
      fontFamily: '"JetBrains Mono", monospace',
      margin: '0 0 12px',
    }}>
      {children}
    </h2>
  )
}

function Card({ children, style }) {
  return (
    <div style={{
      background: '#0c0c0e', border: '1px solid #1e1e22',
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
        width: '32px', height: '18px', borderRadius: '9px', border: 'none',
        background: checked ? '#E8A838' : '#2a2a2a',
        cursor: disabled ? 'not-allowed' : 'pointer',
        position: 'relative', transition: 'background 150ms', flexShrink: 0,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <span style={{
        position: 'absolute', top: '2px',
        left: checked ? '16px' : '2px',
        width: '14px', height: '14px', borderRadius: '50%',
        background: '#fff', transition: 'left 150ms',
      }} />
    </button>
  )
}

const ROLE_OPTIONS = ['admin', 'editor', 'user']

const ROLE_LABELS = {
  admin:  { label: 'Admin',  color: '#E8A838' },
  editor: { label: 'Editor', color: '#60A5FA' },
  user:   { label: 'User',   color: '#666' },
}

const inputStyle = {
  width: '100%', boxSizing: 'border-box',
  background: '#111113', border: '1px solid #2a2a2e',
  borderRadius: '6px', padding: '8px 12px',
  fontSize: '13px', color: '#E5E5E5',
  fontFamily: 'inherit', outline: 'none',
}

const labelStyle = {
  fontSize: '11px', color: '#555',
  fontFamily: '"JetBrains Mono", monospace',
  letterSpacing: '0.08em', textTransform: 'uppercase',
  display: 'block', marginBottom: '6px',
}

// ─── Account section ──────────────────────────────────────────────────────────

function AccountSection({ user }) {
  const navigate  = useNavigate()
  const meta      = user.user_metadata || {}
  const [name,    setName]    = useState(meta.full_name || '')
  const [phone,   setPhone]   = useState(meta.phone || '')
  const [saving,  setSaving]  = useState(false)
  const [saved,   setSaved]   = useState(false)
  const [error,   setError]   = useState(null)

  const save = async () => {
    setSaving(true); setSaved(false); setError(null)
    const { error } = await supabase.auth.updateUser({
      data: { full_name: name.trim(), phone: phone.trim() },
    })
    setSaving(false)
    if (error) setError(error.message)
    else { setSaved(true); setTimeout(() => setSaved(false), 2500) }
  }

  const signOut = async () => {
    await supabase.auth.signOut()
    navigate('/login')
  }

  return (
    <section style={{ marginBottom: '40px' }}>
      <SectionHeading>My Account</SectionHeading>
      <Card>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

          {/* Email — read only */}
          <div>
            <label style={labelStyle}>Email</label>
            <input
              value={user.email}
              readOnly
              style={{ ...inputStyle, color: '#555', cursor: 'default' }}
            />
          </div>

          {/* Full name */}
          <div>
            <label style={labelStyle}>Full Name</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Your name"
              style={inputStyle}
            />
          </div>

          {/* Phone */}
          <div>
            <label style={labelStyle}>Phone</label>
            <input
              value={phone}
              onChange={e => setPhone(e.target.value)}
              placeholder="+61 4xx xxx xxx"
              style={inputStyle}
            />
          </div>

          {error && (
            <div style={{ fontSize: '12px', color: '#EF4444', fontFamily: '"JetBrains Mono", monospace' }}>
              {error}
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', paddingTop: '4px' }}>
            <button
              onClick={signOut}
              style={{
                fontSize: '11px', fontWeight: 500, letterSpacing: '0.08em',
                textTransform: 'uppercase', color: '#EF4444',
                background: 'none', border: '1px solid rgba(239,68,68,0.3)',
                borderRadius: '4px', padding: '6px 14px', cursor: 'pointer',
              }}
            >
              Sign Out
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              {saved && (
                <span style={{ fontSize: '11px', color: '#22C55E', fontFamily: '"JetBrains Mono", monospace' }}>
                  Saved ✓
                </span>
              )}
              <button
                onClick={save}
                disabled={saving}
                style={{
                  fontSize: '11px', fontWeight: 500, letterSpacing: '0.08em',
                  textTransform: 'uppercase', color: saving ? '#444' : '#E8A838',
                  background: 'none', border: '1px solid',
                  borderColor: saving ? '#282828' : 'rgba(232,168,56,0.4)',
                  borderRadius: '4px', padding: '6px 14px',
                  cursor: saving ? 'not-allowed' : 'pointer',
                }}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      </Card>
    </section>
  )
}

// ─── User management (admin only) ────────────────────────────────────────────

function UserManagement() {
  const [users, setUsers]         = useState(null)
  const [tileSettings, setTileSettings] = useState({})
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState(null)
  const [expanded, setExpanded]   = useState(null) // user_id of expanded row

  const load = useCallback(async () => {
    const [{ data: u, error: uErr }, { data: t, error: tErr }] = await Promise.all([
      supabase.rpc('list_portal_users'),
      supabase.from('user_tile_settings').select('user_id, tile_route, enabled'),
    ])
    if (uErr || tErr) { setError((uErr || tErr).message); return }
    setUsers(u)
    const map = {}
    t.forEach(r => {
      if (!map[r.user_id]) map[r.user_id] = {}
      map[r.user_id][r.tile_route] = r.enabled
    })
    setTileSettings(map)
  }, [])

  useEffect(() => { load() }, [load])

  const setRole = async (userId, role) => {
    setSaving(true)
    if (role === 'user') {
      // Remove any existing role row
      await supabase.from('user_roles').delete().eq('user_id', userId)
    } else {
      await supabase.from('user_roles').upsert({ user_id: userId, role }, { onConflict: 'user_id' })
    }
    setSaving(false)
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, role } : u))
  }

  const toggleTile = async (userId, tileRoute, enabled) => {
    setSaving(true)
    await supabase.from('user_tile_settings')
      .upsert({ user_id: userId, tile_route: tileRoute, enabled }, { onConflict: 'user_id,tile_route' })
    setSaving(false)
    setTileSettings(prev => ({
      ...prev,
      [userId]: { ...(prev[userId] || {}), [tileRoute]: enabled },
    }))
  }

  if (!users) return (
    <div style={{ color: '#555', fontFamily: '"JetBrains Mono", monospace', fontSize: '13px' }}>Loading…</div>
  )

  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
        <SectionHeading>User Management</SectionHeading>
        {saving && (
          <span style={{ fontSize: '11px', color: '#555', fontFamily: '"JetBrains Mono", monospace' }}>Saving…</span>
        )}
      </div>
      {error && (
        <div style={{ marginBottom: '12px', padding: '10px 14px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '6px', color: '#EF4444', fontSize: '12px' }}>
          {error}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {users.map(u => {
          const isExpanded = expanded === u.id
          const userTiles = tileSettings[u.id] || {}
          const roleLabel = ROLE_LABELS[u.role] || ROLE_LABELS.user

          return (
            <Card key={u.id} style={{ padding: '0' }}>
              {/* User row header */}
              <div
                style={{
                  display: 'flex', alignItems: 'center', gap: '16px',
                  padding: '14px 20px', cursor: 'pointer',
                }}
                onClick={() => setExpanded(isExpanded ? null : u.id)}
              >
                {/* Avatar */}
                <div style={{
                  width: '32px', height: '32px', borderRadius: '50%',
                  background: '#1e1e22', display: 'flex', alignItems: 'center',
                  justifyContent: 'center', fontSize: '12px', color: '#555',
                  flexShrink: 0, fontFamily: '"JetBrains Mono", monospace', fontWeight: 600,
                }}>
                  {u.email[0].toUpperCase()}
                </div>

                {/* Email */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '13px', color: '#E5E5E5', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {u.email}
                  </div>
                </div>

                {/* Role badge */}
                <span style={{
                  fontSize: '10px', fontWeight: 500, letterSpacing: '0.08em',
                  textTransform: 'uppercase', color: roleLabel.color,
                  fontFamily: '"JetBrains Mono", monospace',
                  padding: '2px 8px', border: `1px solid ${roleLabel.color}33`,
                  borderRadius: '3px', background: `${roleLabel.color}11`, flexShrink: 0,
                }}>
                  {roleLabel.label}
                </span>

                {/* Chevron */}
                <span style={{ color: '#444', fontSize: '12px', transition: 'transform 150ms', transform: isExpanded ? 'rotate(180deg)' : 'none' }}>▾</span>
              </div>

              {/* Expanded panel */}
              {isExpanded && (
                <div style={{ borderTop: '1px solid #1e1e22', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '20px' }}>

                  {/* Role picker */}
                  <div>
                    <div style={{ fontSize: '11px', color: '#555', fontFamily: '"JetBrains Mono", monospace', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '10px' }}>
                      Role
                    </div>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      {ROLE_OPTIONS.map(role => {
                        const cfg = ROLE_LABELS[role]
                        const active = u.role === role
                        return (
                          <button
                            key={role}
                            onClick={() => setRole(u.id, role)}
                            disabled={saving}
                            style={{
                              fontSize: '11px', fontWeight: 500, letterSpacing: '0.08em',
                              textTransform: 'uppercase', fontFamily: '"JetBrains Mono", monospace',
                              padding: '6px 16px', borderRadius: '4px', cursor: saving ? 'not-allowed' : 'pointer',
                              border: `1px solid ${active ? cfg.color + '66' : '#282828'}`,
                              background: active ? cfg.color + '18' : 'transparent',
                              color: active ? cfg.color : '#555',
                              transition: 'all 120ms',
                            }}
                          >
                            {cfg.label}
                          </button>
                        )
                      })}
                    </div>
                    <div style={{ marginTop: '8px', fontSize: '11px', color: '#444', fontFamily: '"JetBrains Mono", monospace' }}>
                      {u.role === 'admin' ? 'Full access — can manage users, roles, and tile access' :
                       u.role === 'editor' ? 'Can access Guide Portal and Contractor Hub' :
                       'Standard access — dashboard and assigned tiles only'}
                    </div>
                  </div>

                  {/* Tile access */}
                  <div>
                    <div style={{ fontSize: '11px', color: '#555', fontFamily: '"JetBrains Mono", monospace', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '10px' }}>
                      Tile Access
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {LIVE_APPS.map(app => {
                        const enabled = userTiles[app.route] !== false
                        return (
                          <div key={app.route} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                              <span style={{ fontSize: '16px' }}>{app.icon}</span>
                              <span style={{ fontSize: '12px', color: '#E5E5E5' }}>{app.name}</span>
                            </div>
                            <Toggle
                              checked={enabled}
                              disabled={saving}
                              onChange={val => toggleTile(u.id, app.route, val)}
                            />
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              )}
            </Card>
          )
        })}
      </div>
    </section>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Settings() {
  const { user } = useAuth()
  const isAdmin  = useIsAdmin()

  if (!user) return null

  return (
    <div style={{
      flex: 1, overflowY: 'auto', padding: '40px 24px',
      maxWidth: '800px', margin: '0 auto', width: '100%', boxSizing: 'border-box',
    }}>
      <div style={{ marginBottom: '32px' }}>
        <h1 style={{ fontSize: '18px', fontWeight: 600, color: '#E5E5E5', margin: 0, letterSpacing: '-0.01em' }}>
          Settings
        </h1>
        <p style={{ fontSize: '13px', color: '#555', margin: '4px 0 0', fontFamily: '"JetBrains Mono", monospace' }}>
          Account and access management
        </p>
      </div>

      <AccountSection user={user} />

      {isAdmin && <UserManagement />}
    </div>
  )
}
