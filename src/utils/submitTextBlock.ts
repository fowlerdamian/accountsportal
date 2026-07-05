// ─────────────────────────────────────────────────────────────────────────────
// Ctrl/Cmd+Enter → submit the focused text block.
//
// Given a focused <textarea> (or contentEditable compose box), figure out how
// this particular block gets submitted and trigger it. Called by the portal-
// wide keyboard handler in useGlobalKeyboardShortcuts, so it must work for the
// grab-bag of ways compose boxes are wired across the apps — some sit in a
// <form>, some declare themselves a compose box with data-mentions="submit"
// (the same marker GlobalMentions uses), most are just a textarea next to a
// "Post" / "Send" / "Save" button.
//
// Design goals:
//   • Never click the WRONG button. When unsure, do nothing and let the field's
//     own handler (or a harmless newline) happen — returning false is safe.
//   • Never double-submit. The caller only preventDefault/stopImmediatePropagation
//     when we return true, so a field's own Ctrl+Enter handler still fires when
//     we decline.
//
// Opt out on the field or any ancestor with  data-no-submit-on-enter.
// Force a specific button with  data-submit-on-ctrl-enter  on that button.
// ─────────────────────────────────────────────────────────────────────────────

// Verbs that mark a button as "the submit for this text block".
const SUBMIT_RE  = /\b(post|send|reply|comment|save|submit|add|create|update|log|share|run|publish|confirm)\b/i;
// Verbs that mean the opposite — never auto-click these.
const EXCLUDE_RE = /\b(cancel|discard|delete|remove|close|back|attach|upload|browse|choose|clear|reset|edit|filter|sort|expand|collapse|copy|download|export|print|assign|snooze|dismiss|skip|previous|next)\b/i;

// Stop climbing when we hit one of these — a text block never submits a control
// that lives outside its own form / dialog / card / section.
const BOUNDARY = new Set(["FORM", "DIALOG", "SECTION", "MAIN", "BODY", "HTML"]);
const MAX_CLIMB = 4;

type Clickable = HTMLElement;

function isDisabled(el: Clickable): boolean {
  return (
    (el as HTMLButtonElement).disabled === true ||
    el.getAttribute("aria-disabled") === "true"
  );
}

function isVisible(el: Clickable): boolean {
  return el.getClientRects().length > 0;
}

function labelOf(el: Clickable): string {
  return (el.getAttribute("aria-label") || el.textContent || "").trim();
}

function isCandidate(el: Clickable): boolean {
  return !isDisabled(el) && isVisible(el) && !EXCLUDE_RE.test(labelOf(el));
}

// Does `btn` come after `field` in document order? Compose buttons sit below /
// to the right of their textarea, so this keeps us from grabbing a toolbar
// button that happens to sit above the field.
function follows(field: HTMLElement, btn: Clickable): boolean {
  return !!(field.compareDocumentPosition(btn) & Node.DOCUMENT_POSITION_FOLLOWING);
}

// Walk up a bounded number of ancestors looking for the button that submits
// this block. `relaxed` (declared compose boxes) accepts the sole action button
// even when it's icon-only / has no submit verb (e.g. a paper-plane Send icon).
function findComposeButton(field: HTMLElement, relaxed: boolean): Clickable | null {
  let node: HTMLElement | null = field.parentElement;
  for (let depth = 0; node && depth < MAX_CLIMB; depth++) {
    const buttons = Array.from(
      node.querySelectorAll<HTMLElement>('button, [role="button"], input[type="submit"]'),
    ).filter(isCandidate);

    if (buttons.length) {
      const after = buttons.filter((b) => follows(field, b));
      const pool  = after.length ? after : relaxed ? buttons : [];

      // Prefer an explicit submit verb…
      const verb = pool.find((b) => SUBMIT_RE.test(labelOf(b)));
      if (verb) return verb;
      // …then, for declared compose boxes, the last action button (usually the
      // primary one — icon-only Send, etc.).
      if (relaxed && pool.length) return pool[pool.length - 1];
    }

    if (BOUNDARY.has(node.tagName)) break;
    node = node.parentElement;
  }
  return null;
}

/**
 * Submit the text block that `field` belongs to. Returns true if a submit was
 * triggered (caller should then swallow the keystroke), false if nothing was
 * found (caller should let the event through untouched).
 */
export function submitFocusedTextBlock(field: HTMLElement): boolean {
  if (field.closest("[data-no-submit-on-enter]")) return false;

  // Explicit opt-in button always wins — precise, never a guess.
  const explicit = field
    .closest<HTMLElement>("form, [data-submit-scope], [data-mentions='submit']")
    ?.querySelector<HTMLElement>("[data-submit-on-ctrl-enter]");
  if (explicit && isCandidate(explicit)) { explicit.click(); return true; }

  // A native <form> is the cleanest signal: fire its real submit path.
  const form = (field as HTMLTextAreaElement).form ?? field.closest("form");
  if (form) {
    const submitBtn = form.querySelector<HTMLElement>(
      'button[type="submit"], input[type="submit"]',
    );
    if (submitBtn && isCandidate(submitBtn)) { submitBtn.click(); return true; }
    if (typeof form.requestSubmit === "function") { form.requestSubmit(); return true; }
  }

  // Portal compose boxes declare themselves with data-mentions="submit" (or an
  // explicit data-submit-scope). For those, accept the sole action button even
  // if it's icon-only. Everything else must have a clear submit-verb button
  // sitting next to it, or we leave the keystroke alone.
  const declaredCompose = !!field.closest("[data-mentions='submit'], [data-submit-scope]");
  const btn = findComposeButton(field, declaredCompose);
  if (btn) { btn.click(); return true; }

  return false;
}
