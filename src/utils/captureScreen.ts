// Captures the visible text of the current screen so the Ask AI chat can act
// on "what I'm looking at" (e.g. "make a task for John re this").
//
// Walks the live DOM rather than cloning so visibility checks work. Skips:
//   - anything inside [data-ai-ignore] (the chat UI itself, task dock, etc.)
//   - script/style/noscript
//   - elements hidden via display:none / visibility:hidden

const MAX_CHARS = 6000

export interface ScreenContext {
  path:  string
  title: string
  text:  string
}

export function captureScreenText(maxChars = MAX_CHARS): string {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const el = node.parentElement
      if (!el) return NodeFilter.FILTER_REJECT
      if (el.closest('[data-ai-ignore], script, style, noscript')) return NodeFilter.FILTER_REJECT
      const style = window.getComputedStyle(el)
      if (style.display === 'none' || style.visibility === 'hidden') return NodeFilter.FILTER_REJECT
      return NodeFilter.FILTER_ACCEPT
    },
  })

  const parts: string[] = []
  let length = 0
  while (walker.nextNode() && length < maxChars) {
    const text = walker.currentNode.textContent?.replace(/\s+/g, ' ').trim()
    if (text) {
      parts.push(text)
      length += text.length + 1
    }
  }
  return parts.join('\n').slice(0, maxChars)
}

export function captureScreen(): ScreenContext {
  return {
    path:  window.location.pathname + window.location.search,
    title: document.title,
    text:  captureScreenText(),
  }
}
