// Community app types — same shapes as Atomic CRM (marmelab/atomic-crm) so the
// contact page can be ported almost 1:1. Tags are plain strings here rather
// than tag ids, and synced calls / emails / orders are notes with a `kind`.

export type ContactType = 'Work' | 'Home' | 'Other';

export interface EmailAndType { email: string; type: ContactType }
export interface PhoneNumberAndType { number: string; type: ContactType }

export type ContactStatus = 'cold' | 'warm' | 'hot' | 'in-contract';

export interface Contact {
  id: string;
  first_name: string | null;
  last_name: string | null;
  title: string | null;
  company_name: string | null;
  email_jsonb: EmailAndType[];
  phone_jsonb: PhoneNumberAndType[];
  linkedin_url: string | null;
  gender: string | null;
  has_newsletter: boolean;
  background: string | null;
  status: ContactStatus | string;
  tags: string[];
  avatar_url: string | null;
  address: Record<string, string | null> | null;
  sales_id: string | null;
  first_seen: string;
  last_seen: string;
  shopify_customer_id: string | null;
  nb_orders: number;
  total_spent: number;
  last_order_at: string | null;
  nb_calls: number;
  last_call_at: string | null;
  avg_csat: number | null;
  nb_emails: number;
  last_email_at: string | null;
  nb_tasks: number;
  ai_summary: string | null;
  ai_summary_at: string | null;
  created_at: string;
  updated_at: string;
}

export type NoteKind = 'note' | 'call' | 'email' | 'order';

export interface ContactNote {
  id: string;
  contact_id: string;
  kind: NoteKind;
  text: string;
  date: string;
  sales_id: string | null;
  status: string;
  source_ref: string | null;
  meta: Record<string, unknown>;
  attachments: unknown[];
  created_at: string;
}

export interface Task {
  id: string;
  contact_id: string;
  type: string;
  text: string;
  due_date: string | null;
  done_date: string | null;
  sales_id: string | null;
  created_at: string;
}

/** A staff member who can own contacts / notes (from public.profiles). */
export interface Sale {
  id: string;
  full_name: string | null;
  email: string | null;
}

export const CONTACT_TYPES: ContactType[] = ['Work', 'Home', 'Other'];
export const GENDERS = ['male', 'female', 'nonbinary'] as const;
export const STATUSES: { value: ContactStatus; label: string }[] = [
  { value: 'cold', label: 'Cold' },
  { value: 'warm', label: 'Warm' },
  { value: 'hot', label: 'Hot' },
  { value: 'in-contract', label: 'In contract' },
];
export const TASK_TYPES = ['None', 'Email', 'Call', 'Follow-up', 'Meeting', 'Ship', 'Other'];

export const contactName = (c: Pick<Contact, 'first_name' | 'last_name' | 'company_name' | 'email_jsonb' | 'phone_jsonb'>) =>
  [c.first_name, c.last_name].filter(Boolean).join(' ').trim()
  || c.company_name
  || c.email_jsonb?.[0]?.email
  || c.phone_jsonb?.[0]?.number
  || 'Unnamed contact';

export const contactInitials = (c: Pick<Contact, 'first_name' | 'last_name' | 'company_name'>) => {
  const a = (c.first_name ?? '').trim()[0];
  const b = (c.last_name ?? '').trim()[0];
  const s = `${a ?? ''}${b ?? ''}`.toUpperCase();
  return s || (c.company_name ?? '?').trim().slice(0, 2).toUpperCase();
};
