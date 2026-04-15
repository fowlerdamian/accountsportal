import { useState, useRef, useEffect, Component } from 'react'
import { Send, Loader2, AlertTriangle, CheckCircle2, XCircle, Link2, ExternalLink, Trash2 } from 'lucide-react'
import { supabase } from '@portal/lib/supabase'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

// ─── Constants ────────────────────────────────────────────────────────────────

const CONFIRM_PHRASE = '⚠️ Ready to execute — please confirm.'

const QUICK_ACTIONS = [
  { label: '📋 Draft Invoices',     message: 'Show me all draft sales invoices' },
  { label: '🔍 Search Contacts',    message: 'Search contacts' },
  { label: '📊 Aged Receivables',   message: 'Run the aged receivables report' },
  { label: '📊 Aged Payables',      message: 'Run the aged payables report' },
  { label: '➕ Create Invoice',     message: 'I need to create a new sales invoice' },
  { label: '➕ Create Bill',        message: 'I need to create a new bill from a supplier' },
  { label: '📒 Journal Entry',      message: 'I need to create a manual journal entry' },
  { label: '💰 Bank Summary',       message: 'Give me a reconciliation summary across all bank accounts' },
]

// ─── Markdown renderer ────────────────────────────────────────────────────────

const MD_COMPONENTS = {
  p:      ({ children }) => <p style={{ margin: '0 0 8px' }}>{children}</p>,
  ul:     ({ children }) => <ul style={{ margin: '4px 0', paddingLeft: '18px' }}>{children}</ul>,
  ol:     ({ children }) => <ol style={{ margin: '4px 0', paddingLeft: '18px' }}>{children}</ol>,
  li:     ({ children }) => <li style={{ margin: '2px 0', color: '#ccc' }}>{children}</li>,
  strong: ({ children }) => <strong style={{ color: '#fff', fontWeight: 600 }}>{children}</strong>,
  code:   ({ children }) => (
    <code style={{
      background: '#111', border: '1px solid #222', borderRadius: '3px',
      padding: '1px 5px', fontFamily: '"JetBrains Mono", monospace',
      fontSize: '12px', color: '#a0a0a0',
    }}>{children}</code>
  ),
  table: ({ children }) => (
    <div style={{ overflowX: 'auto', margin: '8px 0' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '13px' }}>{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th style={{
      border: '1px solid #222', padding: '6px 10px', textAlign: 'left',
      background: '#0d0d0d', color: '#888', fontWeight: 500,
      fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em',
    }}>{children}</th>
  ),
  td: ({ children }) => (
    <td style={{ border: '1px solid #1a1a1a', padding: '6px 10px', color: '#ccc' }}>{children}</td>
  ),
  h1: ({ children }) => <h1 style={{ fontSize: '16px', fontWeight: 600, color: '#fff', margin: '12px 0 6px' }}>{children}</h1>,
  h2: ({ children }) => <h2 style={{ fontSize: '14px', fontWeight: 600, color: '#fff', margin: '10px 0 4px' }}>{children}</h2>,
  h3: ({ children }) => <h3 style={{ fontSize: '13px', fontWeight: 600, color: '#ddd', margin: '8px 0 4px' }}>{children}</h3>,
  hr: () => <hr style={{ border: 'none', borderTop: '1px solid #222', margin: '10px 0' }} />,
  blockquote: ({ children }) => (
    <blockquote style={{
      borderLeft: '3px solid #333', margin: '6px 0', paddingLeft: '12px', color: '#888',
    }}>{children}</blockquote>
  ),
}

// ─── Action Confirmation Card ─────────────────────────────────────────────────

function ConfirmationCard({ content, onConfirm, onCancel, confirmed, cancelled }) {
  const previewText = content.replace(CONFIRM_PHRASE, '').trim()

  if (confirmed) {
    return (
      <div style={{ color: '#e0e0e0', fontSize: '14px', lineHeight: '1.65' }}>
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>{previewText}</ReactMarkdown>
        <div style={{
          marginTop: '10px', display: 'flex', alignItems: 'center', gap: '6px',
          fontSize: '12px', color: '#60a57e', fontFamily: '"JetBrains Mono", monospace',
        }}>
          <CheckCircle2 size={13} />
          Executing…
        </div>
      </div>
    )
  }

  if (cancelled) {
    return (
      <div style={{ color: '#e0e0e0', fontSize: '14px', lineHeight: '1.65' }}>
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>{previewText}</ReactMarkdown>
        <div style={{
          marginTop: '10px', display: 'flex', alignItems: 'center', gap: '6px',
          fontSize: '12px', color: '#666', fontFamily: '"JetBrains Mono", monospace',
        }}>
          <XCircle size={13} />
          Cancelled
        </div>
      </div>
    )
  }

  return (
    <div style={{ color: '#e0e0e0', fontSize: '14px', lineHeight: '1.65' }}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>{previewText}</ReactMarkdown>
      <div style={{
        marginTop: '14px',
        border: '1px solid rgba(243,202,15,0.3)',
        borderLeft: '3px solid #f3ca0f',
        borderRadius: '6px',
        padding: '12px 14px',
        background: 'rgba(243,202,15,0.04)',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: '6px',
          marginBottom: '10px', fontSize: '12px',
          color: '#f3ca0f', fontFamily: '"JetBrains Mono", monospace',
        }}>
          <AlertTriangle size={13} />
          Write operation — requires confirmation
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={onConfirm}
            style={{
              padding: '7px 14px', fontSize: '12px', fontWeight: 600,
              background: '#f3ca0f', color: '#000', border: 'none',
              borderRadius: '5px', cursor: 'pointer',
              fontFamily: '"JetBrains Mono", monospace', letterSpacing: '0.04em',
            }}
          >
            Confirm & Execute
          </button>
          <button
            onClick={onCancel}
            style={{
              padding: '7px 14px', fontSize: '12px',
              background: 'transparent', color: '#666',
              border: '1px solid #333', borderRadius: '5px', cursor: 'pointer',
              fontFamily: '"JetBrains Mono", monospace', letterSpacing: '0.04em',
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Message bubble ───────────────────────────────────────────────────────────

function MessageBubble({ msg, onConfirm, onCancel }) {
  const isUser = msg.role === 'user'
  const needsConfirm = !isUser && msg.content?.includes(CONFIRM_PHRASE)

  return (
    <div style={{
      display: 'flex',
      justifyContent: isUser ? 'flex-end' : 'flex-start',
    }}>
      <div style={{
        maxWidth: isUser ? '70%' : '100%',
        background: isUser ? '#111' : 'transparent',
        border: isUser ? '1px solid #222' : 'none',
        borderRadius: '8px',
        padding: isUser ? '10px 14px' : '0',
        color: msg.isError ? '#f87171' : '#e0e0e0',
        fontSize: '14px',
        lineHeight: '1.65',
      }}>
        {isUser ? (
          msg.content
        ) : needsConfirm ? (
          <ConfirmationCard
            content={msg.content}
            onConfirm={onConfirm}
            onCancel={onCancel}
            confirmed={msg.confirmed}
            cancelled={msg.cancelled}
          />
        ) : (
          <div style={{ color: msg.isError ? '#f87171' : '#e0e0e0' }}>
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
              {msg.content}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Tool activity indicator ──────────────────────────────────────────────────

function ThinkingIndicator() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '4px 0' }}>
      <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
        {[0, 1, 2].map(i => (
          <div
            key={i}
            style={{
              width: '5px', height: '5px', borderRadius: '50%',
              background: '#444',
              animation: `xero-pulse 1.2s ease-in-out ${i * 0.2}s infinite`,
            }}
          />
        ))}
      </div>
      <span style={{
        fontSize: '12px', color: '#555',
        fontFamily: '"JetBrains Mono", monospace',
      }}>
        Querying Xero…
      </span>
    </div>
  )
}

// ─── Quick actions bar ────────────────────────────────────────────────────────

function QuickActionsBar({ onAction, disabled }) {
  return (
    <div style={{
      display: 'flex', gap: '6px', flexWrap: 'wrap',
      padding: '10px 0 0',
    }}>
      {QUICK_ACTIONS.map(({ label, message }) => (
        <button
          key={label}
          onClick={() => !disabled && onAction(message)}
          disabled={disabled}
          style={{
            padding: '5px 10px',
            fontSize: '11px',
            fontFamily: '"JetBrains Mono", monospace',
            background: '#0d0d0d',
            border: '1px solid #1e1e1e',
            borderRadius: '4px',
            color: disabled ? '#333' : '#666',
            cursor: disabled ? 'not-allowed' : 'pointer',
            transition: 'border-color 120ms, color 120ms',
            whiteSpace: 'nowrap',
          }}
          onMouseEnter={e => { if (!disabled) { e.currentTarget.style.borderColor = '#333'; e.currentTarget.style.color = '#aaa' } }}
          onMouseLeave={e => { if (!disabled) { e.currentTarget.style.borderColor = '#1e1e1e'; e.currentTarget.style.color = '#666' } }}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

// ─── Sessions sidebar ─────────────────────────────────────────────────────────

function SessionsSidebar({ sessions, currentId, onSelect, onNew, onDelete, loading }) {
  const [hoveredId, setHoveredId] = useState(null)

  return (
    <div style={{
      width: '220px',
      flexShrink: 0,
      borderRight: '1px solid #1a1a1a',
      display: 'flex',
      flexDirection: 'column',
      background: '#050505',
      overflow: 'hidden',
    }}>
      {/* New conversation button */}
      <div style={{ padding: '10px', borderBottom: '1px solid #111', flexShrink: 0 }}>
        <button
          onClick={onNew}
          disabled={loading}
          style={{
            width: '100%', padding: '7px 10px',
            background: '#0d0d0d', border: '1px solid #1e1e1e',
            borderRadius: '5px', color: loading ? '#333' : '#666',
            fontSize: '12px', cursor: loading ? 'not-allowed' : 'pointer',
            fontFamily: '"JetBrains Mono", monospace',
            transition: 'color 120ms, border-color 120ms',
            textAlign: 'left',
          }}
          onMouseEnter={e => { if (!loading) { e.currentTarget.style.color = '#aaa'; e.currentTarget.style.borderColor = '#333' } }}
          onMouseLeave={e => { if (!loading) { e.currentTarget.style.color = '#666'; e.currentTarget.style.borderColor = '#1e1e1e' } }}
        >
          + New conversation
        </button>
      </div>

      {/* Session list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '6px' }}>
        {sessions.length === 0 && (
          <div style={{
            fontSize: '11px', color: '#2a2a2a', padding: '10px 8px',
            fontFamily: '"JetBrains Mono", monospace', lineHeight: 1.5,
          }}>
            No history yet
          </div>
        )}
        {sessions.map(s => {
          const isActive = s.id === currentId
          const isHovered = s.id === hoveredId
          return (
            <div
              key={s.id}
              style={{ position: 'relative', marginBottom: '2px' }}
              onMouseEnter={() => setHoveredId(s.id)}
              onMouseLeave={() => setHoveredId(null)}
            >
              <button
                onClick={() => onSelect(s)}
                style={{
                  width: '100%', textAlign: 'left',
                  padding: '8px 28px 8px 10px',
                  background: isActive ? 'rgba(243,202,15,0.06)' : isHovered ? 'rgba(255,255,255,0.02)' : 'transparent',
                  border: `1px solid ${isActive ? 'rgba(243,202,15,0.2)' : 'transparent'}`,
                  borderRadius: '5px', cursor: 'pointer',
                  transition: 'background 120ms',
                }}
              >
                <div style={{
                  fontSize: '12px',
                  color: isActive ? '#e0e0e0' : '#666',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  lineHeight: '1.4',
                }}>
                  {s.title}
                </div>
                <div style={{
                  fontSize: '10px', color: '#2a2a2a', marginTop: '2px',
                  fontFamily: '"JetBrains Mono", monospace',
                }}>
                  {new Date(s.updated_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
                </div>
              </button>

              {/* Delete button — visible on hover */}
              {isHovered && (
                <button
                  onClick={e => { e.stopPropagation(); onDelete(s.id) }}
                  title="Delete conversation"
                  style={{
                    position: 'absolute', right: '4px', top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: '#444', padding: '3px',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    borderRadius: '3px',
                    transition: 'color 120ms',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.color = '#f87171' }}
                  onMouseLeave={e => { e.currentTarget.style.color = '#444' }}
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Error boundary ───────────────────────────────────────────────────────────

class XeroChatErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(error) {
    return { error }
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{
          height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: '#000', color: '#f87171', fontFamily: '"JetBrains Mono", monospace',
          fontSize: '13px', padding: '40px', textAlign: 'center', flexDirection: 'column', gap: '12px',
        }}>
          <AlertTriangle size={24} />
          <div>Something went wrong with the Xero Assistant.</div>
          <button
            onClick={() => this.setState({ error: null })}
            style={{
              padding: '6px 14px', fontSize: '11px', background: '#111',
              border: '1px solid #333', borderRadius: '4px', color: '#888', cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

// ─── Not-connected screen ─────────────────────────────────────────────────────

function NotConnectedScreen({ onConnect, onCheckConnection, connecting, error }) {
  return (
    <div style={{
      height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#000', flexDirection: 'column', gap: '0',
    }}>
      <div style={{ textAlign: 'center', maxWidth: '400px', padding: '0 24px' }}>
        <div style={{
          width: '56px', height: '56px', borderRadius: '14px',
          background: '#0d0d0d', border: '1px solid #1a1a1a',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 24px',
        }}>
          <Link2 size={24} color="#555" />
        </div>

        <h2 style={{
          fontSize: '16px', fontWeight: 600, color: '#fff',
          margin: '0 0 8px', letterSpacing: '0.02em',
        }}>
          Connect to Xero
        </h2>
        <p style={{
          fontSize: '13px', color: '#555', lineHeight: '1.6', margin: '0 0 28px',
          fontFamily: '"Inter", system-ui, sans-serif',
        }}>
          Authorise the AGA portal to access your Xero organisation. You'll be redirected to Xero to grant permission.
        </p>

        {error && (
          <div style={{
            marginBottom: '20px', padding: '10px 14px',
            background: 'rgba(248,113,113,0.06)', border: '1px solid rgba(248,113,113,0.2)',
            borderRadius: '6px', fontSize: '12px', color: '#f87171',
            fontFamily: '"JetBrains Mono", monospace', textAlign: 'left',
          }}>
            {error}
          </div>
        )}

        <button
          onClick={onConnect}
          disabled={connecting}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: '8px',
            padding: '10px 20px', fontSize: '13px', fontWeight: 600,
            background: connecting ? '#0d0d0d' : '#13b5ea',
            color: connecting ? '#555' : '#000',
            border: 'none', borderRadius: '7px',
            cursor: connecting ? 'not-allowed' : 'pointer',
            transition: 'background 150ms',
            fontFamily: '"Inter", system-ui, sans-serif',
          }}
        >
          {connecting
            ? <><Loader2 size={14} style={{ animation: 'xero-spin 1s linear infinite' }} /> Opening Xero…</>
            : <><ExternalLink size={14} /> Connect with Xero</>
          }
        </button>

        <p style={{
          marginTop: '16px', fontSize: '11px', color: '#333',
          fontFamily: '"JetBrains Mono", monospace', lineHeight: '1.5',
        }}>
          A new tab will open for Xero authorisation.<br />
          Return here once you've approved access, then click below.
        </p>

        <button
          onClick={onCheckConnection}
          style={{
            marginTop: '12px', fontSize: '11px', color: '#444', background: 'none',
            border: '1px solid #222', borderRadius: '4px', padding: '5px 12px',
            cursor: 'pointer', fontFamily: '"JetBrains Mono", monospace',
          }}
        >
          I've approved — check connection
        </button>
      </div>
    </div>
  )
}

// ─── Main chat component ──────────────────────────────────────────────────────

function XeroChatInner() {
  const [connectionStatus, setConnectionStatus] = useState('checking')
  const [connectError, setConnectError] = useState(null)
  const [connecting, setConnecting] = useState(false)
  const [tenantName, setTenantName] = useState(null)

  const [messages, setMessages] = useState([])
  const [apiHistory, setApiHistory] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  // Session management
  const [sessions, setSessions] = useState([])
  const [sessionId, setSessionId] = useState(null)

  const bottomRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const xeroConnected = params.get('xero_connected')
    const xeroError = params.get('xero_error')

    if (xeroConnected || xeroError) {
      window.history.replaceState(null, '', window.location.pathname)
    }

    if (xeroError) {
      setConnectError(decodeURIComponent(xeroError))
      setConnectionStatus('not_connected')
      return
    }

    checkConnection(xeroConnected === '1')
  }, [])

  async function getValidSession() {
    const { data: { session } } = await supabase.auth.getSession()
    return session
  }

  async function checkConnection(justConnected = false) {
    try {
      const session = await getValidSession()
      if (!session) {
        setConnectError('Your portal session has expired. Please refresh the page and sign in again.')
        setConnectionStatus('not_connected')
        return
      }
      const res = await supabase.functions.invoke('xero-chat', {
        body: { action: 'check_connection' },
      })
      if (res.data?.not_connected) {
        setConnectionStatus('not_connected')
      } else if (!res.error) {
        setTenantName(res.data?.tenant_name ?? null)
        setConnectionStatus('connected')
        if (justConnected) setConnectError(null)
        loadSessions()
      } else {
        setConnectionStatus('not_connected')
      }
    } catch {
      setConnectionStatus('not_connected')
    }
  }

  async function handleConnect() {
    setConnecting(true)
    setConnectError(null)
    try {
      const session = await getValidSession()
      if (!session) {
        setConnectError('Your portal session has expired. Please refresh the page and sign in again.')
        return
      }
      const res = await supabase.functions.invoke('xero-oauth-init')
      if (res.error) throw new Error(res.error.message)
      const { url } = res.data
      if (!url) throw new Error('No authorisation URL returned.')
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (err) {
      setConnectError(err.message || 'Failed to initiate Xero connection.')
    } finally {
      setConnecting(false)
    }
  }

  // ─── Session helpers ───────────────────────────────────────────────────────

  async function loadSessions() {
    const { data } = await supabase
      .from('xero_chat_sessions')
      .select('id, title, created_at, updated_at')
      .order('updated_at', { ascending: false })
      .limit(50)
    if (data) setSessions(data)
  }

  async function saveSession(msgs, hist, currentSid) {
    const authSession = await getValidSession()
    if (!authSession) return

    const title = msgs.find(m => m.role === 'user')?.content?.slice(0, 60) ?? 'Conversation'
    const now = new Date().toISOString()
    const payload = { title, messages: msgs, api_history: hist, updated_at: now }

    if (currentSid) {
      await supabase.from('xero_chat_sessions').update(payload).eq('id', currentSid)
      setSessions(prev =>
        prev
          .map(s => s.id === currentSid ? { ...s, title, updated_at: now } : s)
          .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
      )
    } else {
      const { data } = await supabase
        .from('xero_chat_sessions')
        .insert({ ...payload, user_id: authSession.user.id })
        .select('id, title, created_at, updated_at')
        .single()
      if (data) {
        setSessionId(data.id)
        setSessions(prev => [data, ...prev])
        return data.id
      }
    }
    return currentSid
  }

  async function handleSelectSession(s) {
    if (s.id === sessionId) return
    const { data } = await supabase
      .from('xero_chat_sessions')
      .select('id, messages, api_history')
      .eq('id', s.id)
      .single()
    if (data) {
      setSessionId(data.id)
      setMessages(data.messages ?? [])
      setApiHistory(data.api_history ?? [])
      setError(null)
    }
  }

  async function handleDeleteSession(id) {
    await supabase.from('xero_chat_sessions').delete().eq('id', id)
    setSessions(prev => prev.filter(s => s.id !== id))
    if (id === sessionId) {
      setSessionId(null)
      setMessages([])
      setApiHistory([])
      setError(null)
    }
  }

  function handleNewConversation() {
    setSessionId(null)
    setMessages([])
    setApiHistory([])
    setError(null)
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  // ─── Messaging ─────────────────────────────────────────────────────────────

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  async function send(text) {
    const userText = (text ?? input).trim()
    if (!userText || loading) return

    const newMessages = [...messages, { role: 'user', content: userText }]
    setInput('')
    setError(null)
    setMessages(newMessages)
    setLoading(true)

    // Capture sessionId at call time to avoid closure issues
    const currentSid = sessionId

    try {
      const res = await supabase.functions.invoke('xero-chat', {
        body: {
          message: userText,
          conversation_history: apiHistory,
        },
      })

      if (res.error) {
        let detail = res.error.message
        try {
          const body = await res.error.context?.json?.()
          if (body?.error) detail = body.error
        } catch {}
        throw new Error(detail)
      }

      if (res.data?.not_connected) {
        setConnectionStatus('not_connected')
        setConnectError('Xero token expired or was revoked. Please reconnect.')
        setLoading(false)
        return
      }

      const responseText = res.data?.text ?? res.data?.error ?? 'No response received.'
      const returnedHistory = res.data?.history
      const finalMessages = [...newMessages, { role: 'assistant', content: responseText }]

      setMessages(finalMessages)

      if (returnedHistory) {
        setApiHistory(returnedHistory)
        // Fire and forget — don't block the UI
        saveSession(finalMessages, returnedHistory, currentSid)
      }
    } catch (err) {
      const errMsg = err.message || 'An unexpected error occurred.'
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Error: ${errMsg}`,
        isError: true,
      }])
    } finally {
      setLoading(false)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }

  function handleConfirm(msgIndex) {
    setMessages(prev => prev.map((m, i) => i === msgIndex ? { ...m, confirmed: true } : m))
    send('Yes, execute.')
  }

  function handleCancel(msgIndex) {
    setMessages(prev => prev.map((m, i) => i === msgIndex ? { ...m, cancelled: true } : m))
    send('Cancel — do not execute.')
  }

  function handleKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  if (connectionStatus === 'checking') {
    return (
      <div style={{
        height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#000',
      }}>
        <Loader2 size={20} color="#333" style={{ animation: 'xero-spin 1s linear infinite' }} />
        <style>{`@keyframes xero-spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    )
  }

  if (connectionStatus === 'not_connected') {
    return (
      <>
        <NotConnectedScreen
          onConnect={handleConnect}
          onCheckConnection={() => checkConnection(true)}
          connecting={connecting}
          error={connectError}
        />
        <style>{`@keyframes xero-spin { to { transform: rotate(360deg) } }`}</style>
      </>
    )
  }

  const hasMessages = messages.length > 0

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: '#000',
      color: '#fff',
      fontFamily: '"Inter", system-ui, sans-serif',
    }}>
      {/* Header */}
      <div style={{
        flexShrink: 0,
        padding: '12px 24px',
        borderBottom: '1px solid #1a1a1a',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
      }}>
        <div style={{
          width: '7px', height: '7px', borderRadius: '50%', background: '#22c55e',
          boxShadow: '0 0 5px #22c55e', flexShrink: 0,
        }} />
        <span style={{ fontSize: '12px', fontWeight: 600, letterSpacing: '0.08em', color: '#fff' }}>
          XERO ASSISTANT
        </span>
        <span style={{ fontSize: '11px', color: '#444', fontFamily: '"JetBrains Mono", monospace' }}>
          {tenantName ?? 'Automotive Group Australia'}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '6px', alignItems: 'center' }}>
          <button
            onClick={() => { setConnectionStatus('not_connected'); setConnectError(null) }}
            title="Reconnect Xero"
            style={{
              fontSize: '11px', color: '#333', background: 'none',
              border: '1px solid #1a1a1a', borderRadius: '4px', padding: '3px 8px',
              cursor: 'pointer', fontFamily: '"JetBrains Mono", monospace',
              transition: 'color 120ms, border-color 120ms',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = '#666'; e.currentTarget.style.borderColor = '#2a2a2a' }}
            onMouseLeave={e => { e.currentTarget.style.color = '#333'; e.currentTarget.style.borderColor = '#1a1a1a' }}
          >
            Reconnect
          </button>
        </div>
      </div>

      {/* Body: sidebar + chat */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* Sessions sidebar */}
        <SessionsSidebar
          sessions={sessions}
          currentId={sessionId}
          onSelect={handleSelectSession}
          onNew={handleNewConversation}
          onDelete={handleDeleteSession}
          loading={loading}
        />

        {/* Chat column */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

          {/* Messages */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
            {!hasMessages ? (
              <div style={{ maxWidth: '620px', margin: '0 auto' }}>
                <p style={{ fontSize: '13px', color: '#444', marginBottom: '24px', lineHeight: 1.6 }}>
                  Ask anything about AGA's Xero data — invoices, payments, reconciliation, reports, or create and manage records.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {[
                    'Give me the reconciliation summary across all bank accounts',
                    'Show me the P&L for this financial year',
                    'List all overdue invoices',
                    'What payments were received this month?',
                  ].map(s => (
                    <button
                      key={s}
                      onClick={() => send(s)}
                      style={{
                        textAlign: 'left', background: '#080808',
                        border: '1px solid #1a1a1a', borderRadius: '6px',
                        padding: '10px 14px', color: '#555', fontSize: '13px',
                        cursor: 'pointer', transition: 'border-color 150ms, color 150ms',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(243,202,15,0.3)'; e.currentTarget.style.color = '#ccc' }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = '#1a1a1a'; e.currentTarget.style.color = '#555' }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div style={{ maxWidth: '720px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '18px' }}>
                {messages.map((msg, i) => {
                  const isConfirmMsg = !msg.isError && msg.role === 'assistant' && msg.content?.includes(CONFIRM_PHRASE)
                  return (
                    <MessageBubble
                      key={i}
                      msg={msg}
                      onConfirm={isConfirmMsg ? () => handleConfirm(i) : undefined}
                      onCancel={isConfirmMsg ? () => handleCancel(i) : undefined}
                    />
                  )
                })}
                {loading && <ThinkingIndicator />}
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input area */}
          <div style={{
            flexShrink: 0,
            padding: '12px 24px 16px',
            borderTop: '1px solid #1a1a1a',
          }}>
            <div style={{ maxWidth: '720px', margin: '0 auto' }}>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKey}
                  placeholder="Ask about invoices, payments, reconciliation…"
                  rows={1}
                  disabled={loading}
                  style={{
                    flex: 1, background: '#080808', border: '1px solid #1e1e1e',
                    borderRadius: '6px', padding: '10px 14px', color: '#fff',
                    fontSize: '14px', fontFamily: 'inherit', resize: 'none',
                    outline: 'none', lineHeight: '1.5', minHeight: '40px',
                    maxHeight: '120px', overflow: 'auto',
                    transition: 'border-color 150ms',
                  }}
                  onFocus={e => { e.currentTarget.style.borderColor = '#2a2a2a' }}
                  onBlur={e => { e.currentTarget.style.borderColor = '#1e1e1e' }}
                />
                <button
                  onClick={() => send()}
                  disabled={!input.trim() || loading}
                  style={{
                    width: '40px', height: '40px', borderRadius: '6px', flexShrink: 0,
                    background: input.trim() && !loading ? '#f3ca0f' : '#0d0d0d',
                    border: '1px solid #222',
                    color: input.trim() && !loading ? '#000' : '#333',
                    cursor: input.trim() && !loading ? 'pointer' : 'default',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'background 150ms, color 150ms',
                  }}
                >
                  {loading ? <Loader2 size={14} style={{ animation: 'xero-spin 1s linear infinite' }} /> : <Send size={14} />}
                </button>
              </div>

              <QuickActionsBar onAction={send} disabled={loading} />

              <p style={{
                margin: '8px 0 0',
                fontSize: '10px', color: '#2a2a2a',
                fontFamily: '"JetBrains Mono", monospace',
              }}>
                Enter to send · Shift+Enter for new line · Write operations require confirmation
              </p>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes xero-spin { to { transform: rotate(360deg) } }
        @keyframes xero-pulse {
          0%, 80%, 100% { opacity: 0.2; transform: scale(0.8); }
          40% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  )
}

// ─── Export (wrapped in error boundary) ──────────────────────────────────────

export default function XeroChat() {
  return (
    <XeroChatErrorBoundary>
      <XeroChatInner />
    </XeroChatErrorBoundary>
  )
}
