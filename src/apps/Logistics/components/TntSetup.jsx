import { useCallback, useState } from 'react'
import { mono, card, sectionLabel } from '../utils/ui.jsx'

// The "Fill TNT form" bookmarklet — reads the JSON payload from the TNT form
// URL fragment (set by TntQueryPanel's "Open TNT form") and fills the fields.
export const BOOKMARKLET =
  "javascript:(function(){try{var d=JSON.parse(decodeURIComponent(location.hash.slice(1)));" +
  "var f=document.getElementById('InvoiceQuery')||document;var n=0;" +
  "Object.keys(d).forEach(function(k){var el=f.querySelector('[name=\"'+k+'\"]');if(!el)return;" +
  "el.value=d[k];el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));n++;});" +
  "alert('AGA: '+n+' fields filled. Solve the reCAPTCHA and click Submit.');}" +
  "catch(e){alert('AGA fill failed: '+e.message);}})();"

// One-time setup card for the TNT invoice-query auto-fill bookmarklet.
export default function TntSetup() {
  const [copied, setCopied] = useState(false)
  const bmRef = useCallback(node => { if (node) node.setAttribute('href', BOOKMARKLET) }, [])
  const copy = () => { navigator.clipboard.writeText(BOOKMARKLET); setCopied(true); setTimeout(() => setCopied(false), 2000) }

  return (
    <div style={{ marginTop: '32px' }}>
      <p style={sectionLabel}>TNT invoice-query auto-fill</p>
      <div style={{ ...card, padding: '16px 18px', maxWidth: '640px' }}>
        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '0 0 12px', lineHeight: 1.7 }}>
          TNT disputes are lodged on TNT's own invoice-query form (reCAPTCHA-protected). This one-time
          bookmarklet fills that form for you from each query in the Disputes tab.
        </p>
        <p style={{ margin: '0 0 8px', fontSize: '13px', color: 'var(--text-primary)' }}>
          <strong>1.</strong> Show your bookmarks bar (<span style={{ fontFamily: mono, fontSize: '12px' }}>Ctrl+Shift+B</span>), then <strong>drag</strong> this button onto it:
        </p>
        <div style={{ margin: '0 0 8px' }}>
          <a
            ref={bmRef}
            onClick={e => e.preventDefault()}
            draggable
            style={{ display: 'inline-block', fontSize: '13px', fontWeight: 600, padding: '7px 16px', borderRadius: '6px', color: 'var(--accent-text)', background: 'var(--brand-accent)', textDecoration: 'none', cursor: 'grab' }}
          >
            ⭑ Fill TNT form
          </a>
        </div>
        <p style={{ margin: '0 0 12px', fontSize: '12px', color: 'var(--text-tertiary)' }}>
          Can’t drag? <button onClick={copy} style={{ background: 'none', border: 'none', color: 'var(--brand-accent)', cursor: 'pointer', fontFamily: mono, fontSize: '12px', padding: 0, textDecoration: 'underline' }}>{copied ? 'Copied ✓' : 'Copy the code'}</button> → new bookmark → paste as the URL.
        </p>
        <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-primary)' }}>
          <strong>2.</strong> In <strong>Disputes → Queries</strong>: click <strong>Open TNT form</strong>, then on the TNT tab click your <strong>⭑ Fill TNT form</strong> bookmark, solve the reCAPTCHA, and Submit.
        </p>
      </div>
    </div>
  )
}
