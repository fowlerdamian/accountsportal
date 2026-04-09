import { useState } from 'react'
import { useAuth } from '../context/AuthContext'

const GUEST_KEY = 'portal_guest_email'

function GuestGate({ onEnter }) {
  const [email, setEmail] = useState('')

  const submit = e => {
    e.preventDefault()
    const trimmed = email.trim().toLowerCase()
    if (!trimmed) return
    localStorage.setItem(GUEST_KEY, trimmed)
    onEnter(trimmed)
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center',
      justifyContent: 'center', background: '#000000',
    }}>
      <form onSubmit={submit} style={{
        width: '100%', maxWidth: '360px', padding: '0 24px',
        display: 'flex', flexDirection: 'column', gap: '16px',
      }}>
        <div>
          <div style={{ fontSize: '18px', fontWeight: 600, color: '#ffffff', marginBottom: '4px' }}>
            Welcome
          </div>
          <div style={{ fontSize: '12px', color: '#a0a0a0', fontFamily: '"JetBrains Mono", monospace' }}>
            Enter your email to continue
          </div>
        </div>
        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="you@automotivegroup.com.au"
          required
          autoFocus
          style={{
            width: '100%', boxSizing: 'border-box',
            background: '#111113', border: '1px solid #222222',
            borderRadius: '6px', padding: '10px 14px',
            fontSize: '13px', color: '#ffffff', outline: 'none',
          }}
        />
        <button
          type="submit"
          style={{
            background: '#f3ca0f', border: 'none', borderRadius: '6px',
            padding: '10px', fontSize: '13px', fontWeight: 600,
            color: '#000', cursor: 'pointer',
          }}
        >
          Continue
        </button>
      </form>
    </div>
  )
}

export default function ProtectedRoute({ children }) {
  const { user } = useAuth()
  const [guest, setGuest] = useState(() => localStorage.getItem(GUEST_KEY))

  // TODO: re-enable auth wall
  // if (loading) return <LoadingScreen />
  // if (!user)   return <Navigate to="/login" replace />

  if (!user && !guest) return <GuestGate onEnter={setGuest} />
  return children
}
