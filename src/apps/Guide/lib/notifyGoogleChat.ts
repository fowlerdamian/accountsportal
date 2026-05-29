// Fire-and-forget Google Chat notifications for Guide feedback.
// Mirrors the pattern at src/apps/Support/lib/notifyGoogleChat.ts so the
// shared `notify-google-chat` edge function is the single delivery path.

const SITE_URL = 'https://app.automotivegroup.com.au';
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';

function truncate(text: string, max: number): string {
  if (!text) return '';
  return text.length > max ? text.slice(0, max) + '…' : text;
}

function feedbackLink(): string {
  return `<${SITE_URL}/guide/feedback|Open feedback>`;
}

async function invokeFunction(name: string, body: unknown): Promise<void> {
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON,
        Authorization: `Bearer ${SUPABASE_ANON}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.warn(`[guide] notify-${name} failed:`, err);
  }
}

function sendToChat(text: string): void {
  void invokeFunction('notify-google-chat', { text });
}

export function notifyGuideComment(opts: { guideTitle: string; comment: string; rating?: number | null }): void {
  if (!opts.comment?.trim()) return;
  const stars = opts.rating ? ` · ${'★'.repeat(opts.rating)}${'☆'.repeat(Math.max(0, 5 - opts.rating))}` : '';
  const text = `💬 *${opts.guideTitle}* — Comment${stars}\n"${truncate(opts.comment.trim(), 280)}"\n${feedbackLink()}`;
  sendToChat(text);
}

export function notifyGuideFlag(opts: { guideTitle: string; stepNumber: number | null; description: string }): void {
  if (!opts.description?.trim()) return;
  const step = opts.stepNumber ? ` (Step ${opts.stepNumber})` : '';
  const text = `🚩 *${opts.guideTitle}*${step} — Flagged\n"${truncate(opts.description.trim(), 280)}"\n${feedbackLink()}`;
  sendToChat(text);
}
