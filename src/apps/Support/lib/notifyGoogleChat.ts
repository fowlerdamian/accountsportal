const SITE_URL = 'https://app.automotivegroup.com.au/support';
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';

export function buildCaseUrl(caseId: string): string {
  return `${SITE_URL}/cases/${caseId}`;
}

function truncate(text: string, max: number): string {
  if (!text) return '';
  return text.length > max ? text.slice(0, max) + '...' : text;
}

function caseLink(caseId: string, caseNumber: string): string {
  return `<${buildCaseUrl(caseId)}|${caseNumber}>`;
}

async function invokeFunction(name: string, body: any): Promise<any> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON,
        Authorization: `Bearer ${SUPABASE_ANON}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    return await res.json();
  } catch (err) {
    console.warn(`Edge function ${name} failed:`, err);
    return null;
  }
}

/** Fetch or generate AI summary for a case. */
async function getAiSummary(caseId: string, fallbackTitle: string): Promise<string> {
  const data = await invokeFunction('generate-case-summary', { caseId });
  return data?.summary || truncate(fallbackTitle, 80);
}

/**
 * Fire-and-forget Google Chat notification.
 * Never throws — silently logs errors so it never blocks the main action.
 */
function sendToChat(text: string): void {
  invokeFunction('notify-google-chat', { text });
}

// ── Notification builders ──

export async function notifyNewCase(opts: {
  caseId: string;
  caseNumber: string;
  caseTitle: string;
  caseType: string;
  errorOrigin?: string | null;
  orderNumber?: string | null;
  customerName?: string | null;
}): Promise<void> {
  const summary = await getAiSummary(opts.caseId, opts.caseTitle);
  const link = caseLink(opts.caseId, opts.caseNumber);
  const so = opts.orderNumber || '—';
  const cust = opts.customerName || '—';
  const typeLabel = getTypeLabel(opts.caseType, opts.errorOrigin);
  const text = `🆕 *${link}* — ${typeLabel}\n${summary}\n${so} · ${cust}`;
  sendToChat(text);
}

function getTypeLabel(type: string, errorOrigin?: string | null): string {
  if (type === 'order_error' || type === 'Order Error') {
    if (errorOrigin === 'warehouse') return 'Warehouse Error';
    return 'Order Entry Error';
  }
  return type;
}

export async function notifyActionItemAssigned(opts: {
  caseId: string;
  caseNumber: string;
  caseTitle: string;
  assigneeName: string;
  taskDescription: string;
}): Promise<void> {
  const summary = await getAiSummary(opts.caseId, opts.caseTitle);
  const link = caseLink(opts.caseId, opts.caseNumber);
  const task = truncate(opts.taskDescription, 80);
  const text = `📋 *${link}* → ${opts.assigneeName}\n${summary}\nTASK: ${task}`;
  sendToChat(text);
}

export async function notifyEscalation(opts: {
  caseId: string;
  caseNumber: string;
  caseTitle: string;
  adminName: string;
  reason: string;
}): Promise<void> {
  const summary = await getAiSummary(opts.caseId, opts.caseTitle);
  const link = caseLink(opts.caseId, opts.caseNumber);
  const reason = truncate(opts.reason, 60);
  const text = `🔴 *ESCALATED — ${link}*\n${summary}\n→ ${opts.adminName} · ${reason}`;
  sendToChat(text);
}
