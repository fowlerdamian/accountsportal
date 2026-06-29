import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { processMentions, type CreatedMentionTask } from '../utils/mentionTasks'

// ─────────────────────────────────────────────────────────────────────────────
// Portal-wide @mention support. Mount once in App.jsx.
//
// Typing "@" in ANY plain text field (textarea / input[type=text]) anywhere in
// the portal pops a staff autocomplete; picking a name inserts "@Full Name ".
// When the field is committed (blur), text containing staff @mentions is fed
// to the mention-to-task pipeline, which creates a task for each mentioned
// person with context from the text + current screen.
//
// Opt-out via the data-mentions attribute (on the field or any ancestor):
//   data-mentions="native"  → field has its own picker AND its own task
//                             handling (Tasks comment box, Support update bar)
//   data-mentions="submit"  → picker shown, but task creation is handled by
//                             the field's submit code, not blur (Support
//                             notes, Ask AI input)
// ─────────────────────────────────────────────────────────────────────────────

type Field = HTMLTextAreaElement | HTMLInputElement

interface Profile { id: string; full_name: string | null; email: string | null }

interface ActiveMention {
  el: Field
  at: number       // index of the '@' in the field value
  query: string
}

// Word boundary before '@' so email addresses never trigger.
const TOKEN_RE = /(^|[^A-Za-z0-9._%+-])@([A-Za-z][A-Za-z'’-]*(?: [A-Za-z][A-Za-z'’-]*)?)?$/
const BODY_MENTION_RE = /(^|[^A-Za-z0-9._%+-])@[A-Za-z]/

// Texts already sent to mention-to-task this session (auto-save fields blur
// repeatedly with identical content — never create the same task twice).
const processed = new Set<string>()

function isField(t: EventTarget | null): t is Field {
  if (t instanceof HTMLTextAreaElement) return !t.readOnly && !t.disabled
  if (t instanceof HTMLInputElement) return t.type === 'text' && !t.readOnly && !t.disabled
  return false
}

function modeOf(el: Field): 'native' | 'submit' | 'full' {
  const v = el.closest('[data-mentions]')?.getAttribute('data-mentions')
  return v === 'native' || v === 'submit' ? v : 'full'
}

export function GlobalMentions() {
  const { user } = useAuth()
  const [active, setActive] = useState<ActiveMention | null>(null)
  const [highlight, setHighlight] = useState(0)
  const [profiles, setProfiles] = useState<Profile[] | null>(null)
  const [confirmations, setConfirmations] = useState<CreatedMentionTask[]>([])
  const loadingRef = useRef(false)

  // Lazy-load staff once, on the first '@'.
  function ensureProfiles() {
    if (profiles || loadingRef.current) return
    loadingRef.current = true
    supabase.from('profiles').select('id, full_name, email')
      .then(({ data }) => setProfiles((data as Profile[]) ?? []))
  }

  const matches = useMemo(() => {
    if (!active || !profiles) return []
    const q = active.query.toLowerCase()
    return profiles
      .filter(p => p.id !== user?.id)
      .filter(p =>
        !q ||
        (p.full_name ?? '').toLowerCase().startsWith(q) ||
        (p.full_name ?? '').toLowerCase().split(' ').some(w => w.startsWith(q)) ||
        (p.email ?? '').toLowerCase().split('@')[0].startsWith(q)
      )
      .slice(0, 6)
  }, [active, profiles, user?.id])

  // Refs so document-level listeners always see current state.
  const activeRef = useRef(active);       activeRef.current = active
  const matchesRef = useRef(matches);     matchesRef.current = matches
  const highlightRef = useRef(highlight); highlightRef.current = highlight

  function insertMention(p: Profile) {
    const a = activeRef.current
    if (!a) return
    const el = a.el
    const name = p.full_name ?? p.email?.split('@')[0] ?? ''
    const caret = el.selectionStart ?? el.value.length
    const next = `${el.value.slice(0, a.at)}@${name} ${el.value.slice(caret)}`
    // Native setter + input event so React controlled fields pick up the change.
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, next)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    const pos = a.at + name.length + 2
    el.focus()
    el.setSelectionRange(pos, pos)
    setActive(null)
  }

  useEffect(() => {
    function onInput(e: Event) {
      const el = e.target
      if (!isField(el) || modeOf(el) === 'native') { setActive(null); return }
      const caret = el.selectionStart ?? el.value.length
      const m = TOKEN_RE.exec(el.value.slice(0, caret))
      if (!m) { setActive(null); return }
      ensureProfiles()
      const query = m[2] ?? ''
      setActive({ el, at: caret - query.length - 1, query })
      setHighlight(0)
    }

    function onKeyDown(e: KeyboardEvent) {
      const list = matchesRef.current
      if (!activeRef.current || list.length === 0) return
      if (e.key === 'ArrowDown') {
        e.preventDefault(); e.stopPropagation()
        setHighlight(i => Math.min(i + 1, list.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault(); e.stopPropagation()
        setHighlight(i => Math.max(i - 1, 0))
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault(); e.stopPropagation()
        insertMention(list[highlightRef.current])
      } else if (e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation()
        setActive(null)
      }
    }

    function onFocusOut(e: FocusEvent) {
      setActive(null)
      const el = e.target
      if (!isField(el) || modeOf(el) !== 'full') return
      const text = el.value
      if (!text || !BODY_MENTION_RE.test(text)) return
      const signature = `${window.location.pathname}|${text.trim()}`
      if (processed.has(signature)) return
      processed.add(signature)
      if (processed.size > 200) processed.delete(processed.values().next().value!)
      processMentions(text, {
        label: document.title,
        url:   window.location.pathname,
      }).then(created => {
        if (created.length === 0) return
        setConfirmations(prev => [...prev, ...created])
        setTimeout(() => {
          setConfirmations(prev => prev.filter(c => !created.includes(c)))
        }, 5000)
      })
    }

    function onScroll() { setActive(null) }

    document.addEventListener('input', onInput, true)
    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('focusout', onFocusOut, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      document.removeEventListener('input', onInput, true)
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('focusout', onFocusOut, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!user) return null

  const rect = active && matches.length > 0 ? active.el.getBoundingClientRect() : null

  return (
    <div data-ai-ignore data-mentions="native">
      {/* ── Autocomplete dropdown ─────────────────────────────── */}
      {rect && (
        <div
          data-mentions-open="true"
          onMouseDown={e => e.preventDefault()}
          style={{
            position: 'fixed',
            top: Math.min(rect.bottom + 4, window.innerHeight - 220),
            left: Math.min(rect.left, window.innerWidth - 240),
            width: '220px', maxHeight: '210px', overflowY: 'auto',
            zIndex: 9999,
            background: '#111', border: '1px solid #2a2a2a', borderRadius: '8px',
            boxShadow: '0 8px 30px rgba(0,0,0,0.5)',
            padding: '4px',
          }}
        >
          {matches.map((p, i) => (
            <button
              key={p.id}
              onClick={() => insertMention(p)}
              onMouseEnter={() => setHighlight(i)}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '7px 10px', borderRadius: '5px',
                background: i === highlight ? '#222' : 'none',
                border: 'none', cursor: 'pointer',
                fontSize: '13px', color: '#e0e0e0',
              }}
            >
              {p.full_name ?? p.email}
              <span style={{ display: 'block', fontSize: '10px', color: '#666' }}>
                creates a task for them
              </span>
            </button>
          ))}
        </div>
      )}

      {/* ── Task-created confirmations ────────────────────────── */}
      {confirmations.length > 0 && (
        <div style={{
          position: 'fixed', left: '50%', transform: 'translateX(-50%)',
          bottom: 'calc(16px + var(--task-dock-h, 0px))', zIndex: 9999,
          display: 'flex', flexDirection: 'column', gap: '6px',
        }}>
          {confirmations.map((c, i) => (
            <div key={`${c.task_id}-${i}`} style={{
              padding: '8px 14px', borderRadius: '8px',
              background: '#111', border: '1px solid #2a2a2a',
              boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
              fontSize: '12px', color: '#e0e0e0',
            }}>
              <span style={{ color: 'var(--brand-accent)', fontWeight: 600 }}>✓ Task for {c.assignee}:</span> {c.title}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
