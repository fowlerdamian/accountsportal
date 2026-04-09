import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const ALLOWED_DOMAIN  = 'automotivegroup.com.au'
const ALLOWED_EMAILS  = ['automotivegroupaustralia@gmail.com']

export default function LoginPage() {
  const { user, loading, signInWithMagicLink } = useAuth()
  const navigate = useNavigate()

  const [email, setEmail]         = useState('')
  const [error, setError]         = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [sent, setSent]           = useState(false)

  // Already logged in → skip straight to dashboard
  useEffect(() => {
    if (!loading && user) navigate('/dashboard', { replace: true })
  }, [user, loading, navigate])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)

    const trimmed = email.trim().toLowerCase()

    // Client-side domain/email check for a fast, clear error
    const domainOk = trimmed.endsWith(`@${ALLOWED_DOMAIN}`)
    const emailOk  = ALLOWED_EMAILS.includes(trimmed)
    if (!domainOk && !emailOk) {
      setError(`Only @${ALLOWED_DOMAIN} accounts can access this portal.`)
      return
    }

    setSubmitting(true)
    const { error: authError } = await signInWithMagicLink(trimmed)
    setSubmitting(false)

    if (authError) {
      const msg = authError.message || ''
      if (
        msg.toLowerCase().includes('fetch') ||
        msg.toLowerCase().includes('network') ||
        msg.toLowerCase().includes('json') ||
        msg.toLowerCase().includes('token')
      ) {
        setError('Could not reach the authentication server. Verify that VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are correctly set in Vercel.')
      } else {
        setError(msg || 'An unexpected error occurred.')
      }
      return
    }

    setSent(true)
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
          /* ── Confirmation state ─────────────────────────────────────────── */
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
          /* ── Email form ─────────────────────────────────────────────────── */
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
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
              {submitting ? 'Sending…' : 'Send Login Link'}
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
