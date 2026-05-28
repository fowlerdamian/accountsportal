import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function ResetPassword() {
  const navigate = useNavigate()
  const [status, setStatus]       = useState('verifying') // 'verifying' | 'ready' | 'saving' | 'done' | 'invalid'
  const [password, setPassword]   = useState('')
  const [confirm, setConfirm]     = useState('')
  const [error, setError]         = useState(null)
  const [email, setEmail]         = useState('')

  // The supabase client auto-parses the recovery hash on load and fires
  // PASSWORD_RECOVERY. We also check the existing session in case the event
  // fired before this component mounted.
  useEffect(() => {
    let cancelled = false

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return
      if (event === 'PASSWORD_RECOVERY' && session) {
        setEmail(session.user?.email || '')
        setStatus('ready')
      }
    })

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled) return
      const hash = window.location.hash || ''
      const isRecoveryLink = hash.includes('type=recovery')
      if (session && isRecoveryLink) {
        setEmail(session.user?.email || '')
        setStatus('ready')
      } else if (!isRecoveryLink && status === 'verifying') {
        // Give the auth event ~1s to fire before declaring the link invalid
        setTimeout(() => {
          if (!cancelled) setStatus(s => s === 'verifying' ? 'invalid' : s)
        }, 1500)
      }
    })

    return () => { cancelled = true; subscription.unsubscribe() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)

    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }

    setStatus('saving')
    const { error: updateError } = await supabase.auth.updateUser({ password })
    if (updateError) {
      setError(updateError.message || 'Could not update password.')
      setStatus('ready')
      return
    }
    setStatus('done')
    setTimeout(() => navigate('/dashboard', { replace: true }), 1500)
  }

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center p-6"
      style={{ background: '#000000' }}
    >
      <div
        className="w-full max-w-sm rounded-lg p-8 flex flex-col gap-7"
        style={{ background: '#111113', border: '1px solid #222226' }}
      >
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2.5">
            <div className="w-1.5 h-6 rounded-sm" style={{ background: '#f3ca0f' }} />
            <span className="text-base font-semibold tracking-widest uppercase" style={{ color: '#ffffff' }}>
              Staff Portal
            </span>
          </div>
          <p className="text-[11px] font-mono pl-4" style={{ color: '#a0a0a0' }}>
            Set a new password
          </p>
        </div>

        {status === 'verifying' && (
          <p className="text-xs font-mono" style={{ color: '#a0a0a0' }}>Verifying reset link…</p>
        )}

        {status === 'invalid' && (
          <div className="flex flex-col gap-4">
            <div
              className="rounded px-4 py-4"
              style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)' }}
            >
              <p className="text-sm font-medium" style={{ color: '#ff6b6b' }}>Link invalid or expired</p>
              <p className="text-xs font-mono mt-2" style={{ color: '#a0a0a0' }}>
                Ask an admin to send a new reset link from Settings.
              </p>
            </div>
            <button
              onClick={() => navigate('/login')}
              className="text-xs font-mono text-center"
              style={{ color: '#a0a0a0', background: 'none', border: 'none', cursor: 'pointer' }}
            >
              Back to sign in
            </button>
          </div>
        )}

        {status === 'done' && (
          <div
            className="rounded px-4 py-4"
            style={{ background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.2)' }}
          >
            <p className="text-sm font-medium" style={{ color: '#86EFAC' }}>Password updated</p>
            <p className="text-xs font-mono mt-2" style={{ color: '#a0a0a0' }}>Redirecting to the portal…</p>
          </div>
        )}

        {(status === 'ready' || status === 'saving') && (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {email && (
              <p className="text-xs font-mono" style={{ color: '#a0a0a0' }}>
                Resetting password for <span style={{ color: '#888' }}>{email}</span>
              </p>
            )}

            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] font-mono uppercase tracking-wider" style={{ color: '#a0a0a0' }}>
                New password
              </span>
              <input
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={status === 'saving'}
                className="rounded px-3 py-2 text-sm"
                style={{ background: '#0a0a0c', border: '1px solid #222226', color: '#ffffff' }}
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] font-mono uppercase tracking-wider" style={{ color: '#a0a0a0' }}>
                Confirm password
              </span>
              <input
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                disabled={status === 'saving'}
                className="rounded px-3 py-2 text-sm"
                style={{ background: '#0a0a0c', border: '1px solid #222226', color: '#ffffff' }}
              />
            </label>

            {error && (
              <p className="text-xs font-mono" style={{ color: '#ff6b6b' }}>{error}</p>
            )}

            <button
              type="submit"
              disabled={status === 'saving'}
              className="w-full py-2.5 rounded text-sm font-semibold tracking-wide uppercase mt-1"
              style={{
                background: status === 'saving' ? '#333' : '#f3ca0f',
                color: status === 'saving' ? '#888' : '#000000',
                border: 'none',
                cursor: status === 'saving' ? 'default' : 'pointer',
              }}
            >
              {status === 'saving' ? 'Saving…' : 'Update password'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
