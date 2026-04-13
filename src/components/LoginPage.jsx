import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const ALLOWED_DOMAIN  = 'automotivegroup.com.au'
const ALLOWED_EMAILS  = ['automotivegroupaustralia@gmail.com']

export default function LoginPage() {
  const { user, loading, signIn, signInWithMagicLink } = useAuth()
  const navigate = useNavigate()

  const [email, setEmail]         = useState('')
  const [password, setPassword]   = useState('')
  const [mode, setMode]           = useState('password') // 'password' | 'magic'
  const [error, setError]         = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [sent, setSent]           = useState(false)

  useEffect(() => {
    if (!loading && user) navigate('/dashboard', { replace: true })
  }, [user, loading, navigate])

  const isAllowed = (email) => {
    const t = email.trim().toLowerCase()
    return t.endsWith(`@${ALLOWED_DOMAIN}`) || ALLOWED_EMAILS.includes(t)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)

    if (!isAllowed(email)) {
      setError(`Only @${ALLOWED_DOMAIN} accounts can access this portal.`)
      return
    }

    setSubmitting(true)

    if (mode === 'password') {
      const { error: authError } = await signIn(email.trim().toLowerCase(), password)
      setSubmitting(false)
      if (authError) {
        setError(authError.message === 'Invalid login credentials'
          ? 'Incorrect email or password.'
          : authError.message || 'Sign in failed.')
      }
      // On success, the AuthContext onAuthStateChange fires → navigate happens in useEffect
    } else {
      const { error: authError } = await signInWithMagicLink(email.trim().toLowerCase())
      setSubmitting(false)
      if (authError) {
        const msg = authError.message || ''
        if (
          msg.toLowerCase().includes('fetch') ||
          msg.toLowerCase().includes('network') ||
          msg.toLowerCase().includes('json') ||
          msg.toLowerCase().includes('token')
        ) {
          setError('Could not reach the authentication server. Verify that VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY are correctly set in Vercel.')
        } else {
          setError(msg || 'An unexpected error occurred.')
        }
        return
      }
      setSent(true)
    }
  }

  if (loading) return null

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center p-6"
      style={{ background: '#000000' }}
    >
      <div
        className="w-full max-w-sm rounded-lg p-8 flex flex-col gap-7"
        style={{ background: '#111113', border: '1px solid #222226' }}
      >
        {/* Logo / wordmark */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2.5">
            <div className="w-1.5 h-6 rounded-sm" style={{ background: '#f3ca0f' }} />
            <span
              className="text-base font-semibold tracking-widest uppercase"
              style={{ color: '#ffffff' }}
            >
              Staff Portal
            </span>
          </div>
          <p className="text-[11px] font-mono pl-4" style={{ color: '#a0a0a0' }}>
            Internal portal · Sign in to continue
          </p>
        </div>

        {sent ? (
          /* ── Magic link sent ──────────────────────────────────────────────── */
          <div className="flex flex-col gap-4">
            <div
              className="rounded px-4 py-4 flex flex-col gap-2"
              style={{ background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.2)' }}
            >
              <p className="text-sm font-medium" style={{ color: '#86EFAC' }}>
                Check your inbox
              </p>
              <p className="text-xs font-mono" style={{ color: '#a0a0a0' }}>
                We've sent a login link to <span style={{ color: '#888' }}>{email.trim()}</span>.
                The link expires in 60 minutes.
              </p>
            </div>
            <button
              onClick={() => { setSent(false); setEmail('') }}
              className="text-xs font-mono text-center transition-colors"
              style={{ color: '#a0a0a0', background: 'none', border: 'none', cursor: 'pointer' }}
              onMouseEnter={(e) => { e.currentTarget.style.color = '#888' }}
              onMouseLeave={(e) => { e.currentTarget.style.color = '#555' }}
            >
              Use a different email
            </button>
          </div>
        ) : (
          /* ── Login form ───────────────────────────────────────────────────── */
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {/* Email */}
            <div className="flex flex-col gap-1.5">
              <label
                className="text-[11px] uppercase tracking-widest font-medium"
                style={{ color: '#a0a0a0' }}
              >
                Email
              </label>
              <input
                type="email"
                required
                autoComplete="email"
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={`you@${ALLOWED_DOMAIN}`}
                className="w-full rounded px-3 py-2.5 text-sm font-mono outline-none transition-colors"
                style={{
                  background: '#0a0a0c',
                  border: '1px solid #222222',
                  color: '#ffffff',
                }}
                onFocus={(e) => { e.target.style.borderColor = '#f3ca0f' }}
                onBlur={(e)  => { e.target.style.borderColor = '#222222' }}
              />
            </div>

            {/* Password (only in password mode) */}
            {mode === 'password' && (
              <div className="flex flex-col gap-1.5">
                <label
                  className="text-[11px] uppercase tracking-widest font-medium"
                  style={{ color: '#a0a0a0' }}
                >
                  Password
                </label>
                <input
                  type="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full rounded px-3 py-2.5 text-sm font-mono outline-none transition-colors"
                  style={{
                    background: '#0a0a0c',
                    border: '1px solid #222222',
                    color: '#ffffff',
                  }}
                  onFocus={(e) => { e.target.style.borderColor = '#f3ca0f' }}
                  onBlur={(e)  => { e.target.style.borderColor = '#222222' }}
                />
              </div>
            )}

            {error && (
              <p
                className="text-xs font-mono px-3 py-2 rounded"
                style={{
                  color: '#FCA5A5',
                  background: 'rgba(127,29,29,0.2)',
                  border: '1px solid rgba(127,29,29,0.4)',
                }}
              >
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2.5 rounded text-sm font-semibold tracking-wide uppercase mt-1"
              style={{
                background: submitting ? '#8a6220' : '#f3ca0f',
                color: '#0a0a0a',
                opacity: submitting ? 0.7 : 1,
                cursor: submitting ? 'not-allowed' : 'pointer',
              }}
            >
              {submitting
                ? (mode === 'password' ? 'Signing in…' : 'Sending…')
                : (mode === 'password' ? 'Sign In' : 'Send Login Link')}
            </button>

            {/* Mode toggle */}
            <button
              type="button"
              onClick={() => { setMode(m => m === 'password' ? 'magic' : 'password'); setError(null) }}
              className="text-xs font-mono text-center transition-colors"
              style={{ color: '#555', background: 'none', border: 'none', cursor: 'pointer' }}
              onMouseEnter={(e) => { e.currentTarget.style.color = '#888' }}
              onMouseLeave={(e) => { e.currentTarget.style.color = '#555' }}
            >
              {mode === 'password' ? 'Sign in with a magic link instead' : 'Sign in with password instead'}
            </button>
          </form>
        )}

        <p className="text-[10px] font-mono text-center" style={{ color: '#333' }}>
          Access restricted to @{ALLOWED_DOMAIN} accounts
        </p>
      </div>
    </div>
  )
}
