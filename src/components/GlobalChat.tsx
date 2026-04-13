import { useState, useRef, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { Sparkles, X, Send, Loader2, Trash2, ChevronDown } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import ReactMarkdown from 'react-markdown'

// ── Context detection ─────────────────────────────────────────────────────────

type AppContext =
  | 'dashboard' | 'support' | 'sales-support' | 'logistics'
  | 'compliance' | 'accounts' | 'purchase-orders' | 'projects' | 'guide'

function detectContext(pathname: string): AppContext {
  if (pathname.startsWith('/sales-support')) return 'sales-support'
  if (pathname.startsWith('/support'))       return 'support'
  if (pathname.startsWith('/logistics'))     return 'logistics'
  if (pathname.startsWith('/projects'))      return 'projects'
  if (pathname.startsWith('/compliance'))    return 'compliance'
  if (pathname.startsWith('/accounts'))      return 'accounts'
  if (pathname.startsWith('/purchase-orders')) return 'purchase-orders'
  if (pathname.startsWith('/guide'))         return 'guide'
  return 'dashboard'
}

const CONTEXT_LABELS: Record<AppContext, string> = {
  'dashboard':       'Portal',
  'support':         'Customer Service',
  'sales-support':   'Sales Support',
  'logistics':       'Logistics',
  'compliance':      'Compliance',
  'accounts':        'Accounts',
  'purchase-orders': 'Purchasing',
  'projects':        'Projects',
  'guide':           'Guide Portal',
}

const CONTEXT_SUGGESTIONS: Record<AppContext, string[]> = {
  'dashboard':       ["What needs attention today?", "Show me open cases", "What's on the call list?"],
  'support':         ["How many open cases?", "What's overdue?", "Show me urgent cases"],
  'sales-support':   ["What's on today's call list?", "Show me top leads by score", "How many leads per channel?"],
  'logistics':       ["Show disputed invoices", "What's our freight spend this month?", "Any unresolved disputes?"],
  'compliance':      ["Which documents need updating?", "What's our ISO audit status?", "Show incomplete sections"],
  'accounts':        ["Show me the latest profit report", "Flag any low-margin lines", "Compare this month to last"],
  'purchase-orders': ["What POs are overdue?", "Show POs due this week", "Any critical outstanding orders?"],
  'projects':        ["What tasks are overdue?", "Show active projects", "Who has the most open tasks?"],
  'guide':           ["How many guides are published?", "Show recent feedback", "Which guides need updating?"],
}

// Routes where the chat should not appear
const HIDDEN_ROUTES = ['/login']
const APP_ROUTE_PREFIXES = [
  '/dashboard', '/accounts', '/logistics', '/purchase-orders',
  '/sales-support', '/support', '/projects', '/guide', '/compliance', '/settings',
]

function shouldShowChat(pathname: string, isAuthenticated: boolean): boolean {
  if (!isAuthenticated) return false
  if (HIDDEN_ROUTES.includes(pathname)) return false
  return APP_ROUTE_PREFIXES.some(r => pathname === r || pathname.startsWith(r + '/'))
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface Message {
  role: 'user' | 'assistant'
  content: string
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function GlobalChat() {
  const { user } = useAuth()
  const { pathname } = useLocation()

  const [open, setOpen]         = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput]       = useState('')
  const [loading, setLoading]   = useState(false)

  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef  = useRef<HTMLTextAreaElement>(null)

  const context     = detectContext(pathname)
  const contextLabel = CONTEXT_LABELS[context]
  const suggestions  = CONTEXT_SUGGESTIONS[context]

  // Reset conversation when context changes (user navigates to a different app)
  useEffect(() => {
    setMessages([])
  }, [context])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, loading])

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) setOpen(false)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open])

  if (!shouldShowChat(pathname, !!user)) return null

  async function sendMessage(text?: string) {
    const content = (text ?? input).trim()
    if (!content || loading) return

    const userMsg: Message = { role: 'user', content }
    const history = [...messages, userMsg]
    setMessages(history)
    setInput('')
    setLoading(true)

    try {
      const { data, error } = await supabase.functions.invoke('chat', {
        body: {
          messages: history,
          context,
          userEmail: user?.email ?? 'Staff',
        },
      })

      if (error) throw error

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: data?.reply ?? 'No response.',
      }])
    } catch {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: '⚠️ Something went wrong. Please try again.',
      }])
    } finally {
      setLoading(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  return (
    <>
      {/* ── Floating trigger ──────────────────────────────────── */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          style={{
            position: 'fixed', bottom: '24px', right: '24px', zIndex: 50,
            display: 'flex', alignItems: 'center', gap: '8px',
            padding: '10px 16px', borderRadius: '24px',
            background: '#f3ca0f', color: '#000000',
            border: 'none', cursor: 'pointer',
            fontSize: '13px', fontWeight: 600,
            boxShadow: '0 4px 24px rgba(243,202,15,0.35)',
            transition: 'opacity 150ms, transform 150ms',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '0.9' }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '1' }}
        >
          <Sparkles style={{ width: '15px', height: '15px' }} />
          Ask AI
        </button>
      )}

      {/* ── Slide-in panel ────────────────────────────────────── */}
      <div
        style={{
          position: 'fixed', top: 0, right: 0, bottom: 0,
          width: '420px', zIndex: 50,
          display: 'flex', flexDirection: 'column',
          background: '#0a0a0a', borderLeft: '1px solid #222222',
          boxShadow: '-8px 0 40px rgba(0,0,0,0.6)',
          transform: open ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 250ms cubic-bezier(0.16,1,0.3,1)',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 16px', height: '48px', flexShrink: 0,
          borderBottom: '1px solid #1a1a1a',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Sparkles style={{ width: '14px', height: '14px', color: '#f3ca0f' }} />
            <span style={{ fontSize: '12px', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#ffffff' }}>
              AI Assistant
            </span>
            <span style={{
              fontSize: '10px', padding: '2px 6px', borderRadius: '3px',
              background: '#1a1a1a', color: '#666', fontFamily: '"JetBrains Mono", monospace',
            }}>
              {contextLabel}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            {messages.length > 0 && (
              <button
                onClick={() => setMessages([])}
                title="Clear conversation"
                style={{ padding: '6px', background: 'none', border: 'none', cursor: 'pointer', color: '#444', borderRadius: '4px' }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = '#888' }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = '#444' }}
              >
                <Trash2 style={{ width: '13px', height: '13px' }} />
              </button>
            )}
            <button
              onClick={() => setOpen(false)}
              style={{ padding: '6px', background: 'none', border: 'none', cursor: 'pointer', color: '#444', borderRadius: '4px' }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = '#888' }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = '#444' }}
            >
              <ChevronDown style={{ width: '15px', height: '15px' }} />
            </button>
          </div>
        </div>

        {/* Messages */}
        <div
          ref={scrollRef}
          style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}
        >
          {messages.length === 0 && (
            <div style={{ textAlign: 'center', paddingTop: '32px' }}>
              <Sparkles style={{ width: '28px', height: '28px', color: '#333', margin: '0 auto 12px' }} />
              <p style={{ fontSize: '13px', color: '#555', marginBottom: '20px' }}>
                Ask anything about {contextLabel.toLowerCase()}
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {suggestions.map(q => (
                  <button
                    key={q}
                    onClick={() => sendMessage(q)}
                    style={{
                      textAlign: 'left', padding: '8px 12px',
                      background: '#111', border: '1px solid #222',
                      borderRadius: '6px', cursor: 'pointer',
                      fontSize: '12px', color: '#888',
                      transition: 'border-color 120ms, color 120ms',
                    }}
                    onMouseEnter={e => {
                      (e.currentTarget as HTMLButtonElement).style.borderColor = '#333'
                      ;(e.currentTarget as HTMLButtonElement).style.color = '#aaa'
                    }}
                    onMouseLeave={e => {
                      (e.currentTarget as HTMLButtonElement).style.borderColor = '#222'
                      ;(e.currentTarget as HTMLButtonElement).style.color = '#888'
                    }}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
                gap: '8px',
                alignItems: 'flex-start',
              }}
            >
              {msg.role === 'assistant' && (
                <div style={{
                  width: '22px', height: '22px', borderRadius: '50%',
                  background: 'rgba(243,202,15,0.15)', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: '2px',
                }}>
                  <Sparkles style={{ width: '11px', height: '11px', color: '#f3ca0f' }} />
                </div>
              )}
              <div
                style={{
                  maxWidth: '85%',
                  padding: '8px 12px',
                  borderRadius: msg.role === 'user' ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                  background: msg.role === 'user' ? '#1a1a1a' : '#111',
                  border: `1px solid ${msg.role === 'user' ? '#2a2a2a' : '#1a1a1a'}`,
                  fontSize: '13px',
                  color: '#e0e0e0',
                  lineHeight: '1.5',
                }}
              >
                {msg.role === 'assistant' ? (
                  <div className="prose prose-sm prose-invert max-w-none [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5 [&_code]:text-xs [&_code]:bg-black/40 [&_code]:px-1 [&_code]:rounded">
                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                  </div>
                ) : (
                  <p style={{ margin: 0 }}>{msg.content}</p>
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
              <div style={{
                width: '22px', height: '22px', borderRadius: '50%',
                background: 'rgba(243,202,15,0.15)', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Sparkles style={{ width: '11px', height: '11px', color: '#f3ca0f' }} />
              </div>
              <div style={{
                padding: '8px 12px', borderRadius: '12px 12px 12px 2px',
                background: '#111', border: '1px solid #1a1a1a',
                display: 'flex', alignItems: 'center', gap: '6px',
              }}>
                <Loader2 style={{ width: '12px', height: '12px', color: '#555', animation: 'spin 1s linear infinite' }} />
                <span style={{ fontSize: '12px', color: '#555' }}>Thinking…</span>
              </div>
            </div>
          )}
        </div>

        {/* Input */}
        <div style={{ padding: '12px 16px', borderTop: '1px solid #1a1a1a', flexShrink: 0 }}>
          <div style={{ position: 'relative' }}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={`Ask about ${contextLabel.toLowerCase()}…`}
              rows={3}
              disabled={loading}
              style={{
                width: '100%', resize: 'none', boxSizing: 'border-box',
                background: '#111', border: '1px solid #222', borderRadius: '8px',
                padding: '10px 40px 10px 12px',
                fontSize: '13px', color: '#e0e0e0',
                outline: 'none', fontFamily: 'inherit',
                transition: 'border-color 120ms',
              }}
              onFocus={e => { e.currentTarget.style.borderColor = '#333' }}
              onBlur={e => { e.currentTarget.style.borderColor = '#222' }}
            />
            <button
              onClick={() => sendMessage()}
              disabled={!input.trim() || loading}
              style={{
                position: 'absolute', bottom: '8px', right: '8px',
                padding: '5px', borderRadius: '5px',
                background: 'none', border: 'none', cursor: 'pointer',
                color: input.trim() && !loading ? '#f3ca0f' : '#333',
                transition: 'color 120ms',
              }}
            >
              <Send style={{ width: '14px', height: '14px' }} />
            </button>
          </div>
          <p style={{ fontSize: '10px', color: '#333', margin: '6px 0 0', textAlign: 'center', fontFamily: '"JetBrains Mono", monospace' }}>
            Enter to send · Shift+Enter for new line
          </p>
        </div>
      </div>

      {/* Backdrop */}
      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 49,
            background: 'rgba(0,0,0,0.4)',
            backdropFilter: 'blur(2px)',
          }}
        />
      )}
    </>
  )
}
