import { useState, useRef, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { Sparkles, X, Send, Loader2, Trash2, ChevronDown } from 'lucide-react'
import { SparklesIcon } from '@portal/components/icons'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

// Context detection + visibility live in src/config/aiChat.ts — the chat shows
// on every authenticated route by default, so new apps get it automatically.
import { detectChatContext, shouldShowChat } from '../config/aiChat'
import { captureScreen } from '../utils/captureScreen'
import { processMentions } from '../utils/mentionTasks'
import { useQueryClient } from '@tanstack/react-query'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Message {
  role: 'user' | 'assistant'
  content: string
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function GlobalChat() {
  const { user } = useAuth()
  const { pathname } = useLocation()
  const queryClient = useQueryClient()

  const [open, setOpen]         = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput]       = useState('')
  const [loading, setLoading]   = useState(false)

  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef  = useRef<HTMLTextAreaElement>(null)

  const { context, label: contextLabel, suggestions } = detectChatContext(pathname)

  // Tracks the CURRENT context so an in-flight request from a previous app
  // can detect the switch and drop its stale reply.
  const contextRef = useRef(context)

  // Reset conversation when context changes (user navigates to a different app)
  useEffect(() => {
    contextRef.current = context
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

    // Universal @mention → staff task pipeline (runs alongside the AI reply;
    // the AI is told not to double-create tasks for @mentions).
    processMentions(content, { label: 'Ask AI chat', url: pathname }).then(created => {
      if (created.length === 0) return
      queryClient.invalidateQueries({ queryKey: ['staff_tasks'] })
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: created.map(t => `✓ Task created for ${t.assignee}: **${t.title}**`).join('\n'),
      }])
    })

    try {
      const { data, error } = await supabase.functions.invoke('chat', {
        body: {
          messages: history,
          context,
          userEmail: user?.email ?? 'Staff',
          // What the user is looking at right now — lets the AI create tasks
          // like "make a task for John re this" from the on-screen content.
          screen: captureScreen(),
        },
      })

      if (error) throw error

      // The chat can now write (create/update tasks, comments) — refresh any
      // task queries so the dock and Tasks app reflect changes immediately.
      if (data?.didWrite) {
        queryClient.invalidateQueries({ queryKey: ['staff_tasks'] })
        queryClient.invalidateQueries({ queryKey: ['staff_task'] })
        queryClient.invalidateQueries({ queryKey: ['staff_task_comments'] })
        queryClient.invalidateQueries({ queryKey: ['staff_task_comments_thread'] })
      }

      // If the user navigated to a different app while this request was in
      // flight, the conversation was reset — drop the stale answer rather
      // than injecting a reply about the OLD context into the new one.
      if (contextRef.current !== context) return

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: data?.reply ?? 'No response.',
      }])
    } catch {
      if (contextRef.current !== context) return
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
          data-ai-ignore
          onClick={() => setOpen(true)}
          style={{
            position: 'fixed', bottom: 'calc(16px + var(--task-dock-h, 0px))', right: '24px', zIndex: 50,
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
        data-ai-ignore
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
              <SparklesIcon style={{ width: '28px', height: '28px', color: '#333', margin: '0 auto 12px' }} />
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
                  <div className="prose prose-sm prose-invert max-w-none [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5 [&_code]:text-xs [&_code]:bg-black/40 [&_code]:px-1 [&_code]:rounded [&_table]:w-full [&_table]:border-collapse [&_table]:text-xs [&_th]:border [&_th]:border-white/20 [&_th]:bg-white/10 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_td]:border [&_td]:border-white/20 [&_td]:px-2 [&_td]:py-1">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
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
                <Loader2 className="animate-spin" style={{ width: '12px', height: '12px', color: '#555' }} />
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
              data-mentions="submit"
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
