import { useState, useRef, useEffect } from 'react'
import { Send, Loader2 } from 'lucide-react'
import { supabase } from '@portal/lib/supabase'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

const SUGGESTIONS = [
  'Give me the reconciliation summary across all bank accounts',
  'Show me the P&L for this financial year',
  'List all overdue invoices',
  'What payments were received this month?',
]

export default function XeroChat() {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  async function send(text) {
    const userText = (text ?? input).trim()
    if (!userText || loading) return

    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: userText }])
    setLoading(true)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const history = messages.map(m => ({ role: m.role, content: m.content }))

      const res = await supabase.functions.invoke('xero-chat', {
        body: { message: userText, conversation_history: history },
        headers: { Authorization: `Bearer ${session?.access_token}` },
      })

      if (res.error) throw new Error(res.error.message)
      setMessages(prev => [...prev, { role: 'assistant', content: res.data.text }])
    } catch (err) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Error: ${err.message}`,
        isError: true,
      }])
    } finally {
      setLoading(false)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }

  function handleKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

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
        padding: '16px 24px',
        borderBottom: '1px solid #1a1a1a',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
      }}>
        <div style={{
          width: '8px', height: '8px', borderRadius: '50%', background: '#22c55e',
          boxShadow: '0 0 6px #22c55e',
        }} />
        <span style={{ fontSize: '13px', fontWeight: 600, letterSpacing: '0.05em', color: '#fff' }}>
          XERO
        </span>
        <span style={{ fontSize: '11px', color: '#555', fontFamily: '"JetBrains Mono", monospace' }}>
          Automotive Group Australia
        </span>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
        {messages.length === 0 ? (
          <div style={{ maxWidth: '600px', margin: '0 auto' }}>
            <p style={{ fontSize: '13px', color: '#555', marginBottom: '20px', lineHeight: 1.6 }}>
              Ask anything about your Xero data — invoices, payments, reconciliation, reports.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {SUGGESTIONS.map(s => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  style={{
                    textAlign: 'left',
                    background: '#0d0d0d',
                    border: '1px solid #222',
                    borderRadius: '6px',
                    padding: '10px 14px',
                    color: '#a0a0a0',
                    fontSize: '13px',
                    cursor: 'pointer',
                    transition: 'border-color 150ms, color 150ms',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.borderColor = 'rgba(243,202,15,0.4)'
                    e.currentTarget.style.color = '#fff'
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.borderColor = '#222'
                    e.currentTarget.style.color = '#a0a0a0'
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ maxWidth: '700px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {messages.map((msg, i) => (
              <div key={i} style={{
                display: 'flex',
                justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
              }}>
                <div style={{
                  maxWidth: msg.role === 'user' ? '70%' : '100%',
                  background: msg.role === 'user' ? '#111' : 'transparent',
                  border: msg.role === 'user' ? '1px solid #222' : 'none',
                  borderRadius: '8px',
                  padding: msg.role === 'user' ? '10px 14px' : '0',
                  color: msg.isError ? '#f87171' : '#e0e0e0',
                  fontSize: '14px',
                  lineHeight: '1.65',
                }}>
                  {msg.role === 'assistant' ? (
                    <div style={{ color: '#e0e0e0' }}>
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          p: ({ children }) => <p style={{ margin: '0 0 10px' }}>{children}</p>,
                          ul: ({ children }) => <ul style={{ margin: '6px 0', paddingLeft: '18px' }}>{children}</ul>,
                          ol: ({ children }) => <ol style={{ margin: '6px 0', paddingLeft: '18px' }}>{children}</ol>,
                          li: ({ children }) => <li style={{ margin: '3px 0', color: '#ccc' }}>{children}</li>,
                          strong: ({ children }) => <strong style={{ color: '#fff', fontWeight: 600 }}>{children}</strong>,
                          code: ({ children }) => (
                            <code style={{
                              background: '#111', border: '1px solid #222',
                              borderRadius: '3px', padding: '1px 5px',
                              fontFamily: '"JetBrains Mono", monospace', fontSize: '12px', color: '#a0a0a0',
                            }}>{children}</code>
                          ),
                          table: ({ children }) => (
                            <div style={{ overflowX: 'auto', margin: '8px 0' }}>
                              <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '13px' }}>{children}</table>
                            </div>
                          ),
                          th: ({ children }) => (
                            <th style={{ border: '1px solid #222', padding: '6px 10px', textAlign: 'left', background: '#0d0d0d', color: '#888', fontWeight: 500, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{children}</th>
                          ),
                          td: ({ children }) => (
                            <td style={{ border: '1px solid #1a1a1a', padding: '6px 10px', color: '#ccc' }}>{children}</td>
                          ),
                        }}
                      >
                        {msg.content}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    msg.content
                  )}
                </div>
              </div>
            ))}

            {loading && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#555' }}>
                <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                <span style={{ fontSize: '13px', fontFamily: '"JetBrains Mono", monospace' }}>Querying Xero…</span>
              </div>
            )}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{
        flexShrink: 0,
        padding: '16px 24px',
        borderTop: '1px solid #1a1a1a',
      }}>
        <div style={{
          maxWidth: '700px',
          margin: '0 auto',
          display: 'flex',
          gap: '8px',
          alignItems: 'flex-end',
        }}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Ask about invoices, payments, reconciliation, reports…"
            rows={1}
            disabled={loading}
            style={{
              flex: 1,
              background: '#0d0d0d',
              border: '1px solid #222',
              borderRadius: '6px',
              padding: '10px 14px',
              color: '#fff',
              fontSize: '14px',
              fontFamily: 'inherit',
              resize: 'none',
              outline: 'none',
              lineHeight: '1.5',
              minHeight: '40px',
              maxHeight: '120px',
              overflow: 'auto',
              transition: 'border-color 150ms',
            }}
            onFocus={e => { e.currentTarget.style.borderColor = '#333' }}
            onBlur={e => { e.currentTarget.style.borderColor = '#222' }}
          />
          <button
            onClick={() => send()}
            disabled={!input.trim() || loading}
            style={{
              width: '40px',
              height: '40px',
              borderRadius: '6px',
              background: input.trim() && !loading ? '#f3ca0f' : '#111',
              border: '1px solid #222',
              color: input.trim() && !loading ? '#000' : '#444',
              cursor: input.trim() && !loading ? 'pointer' : 'default',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              transition: 'background 150ms, color 150ms',
            }}
          >
            <Send size={15} />
          </button>
        </div>
        <p style={{
          maxWidth: '700px',
          margin: '8px auto 0',
          fontSize: '11px',
          color: '#333',
          fontFamily: '"JetBrains Mono", monospace',
        }}>
          Enter to send · Shift+Enter for new line
        </p>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}
