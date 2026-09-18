// Data access for the Community app — plain Supabase calls wrapped for react-query.
import { supabase } from '@portal/lib/supabase';
import { isPhoneQuery, phoneDigits, phoneSearchToken } from './phone';
import type { Contact, ContactNote, Task, Sale } from '../types';

const sb = supabase as any;

export const CONTACT_COLUMNS =
  'id,first_name,last_name,title,company_name,email_jsonb,phone_jsonb,linkedin_url,gender,has_newsletter,background,status,tags,avatar_url,address,sales_id,first_seen,last_seen,shopify_customer_id,nb_orders,total_spent,last_order_at,nb_calls,last_call_at,avg_csat,nb_emails,last_email_at,nb_tasks,ai_summary,ai_summary_at,created_at,updated_at';

export type ContactFilter = 'all' | 'customers' | 'called' | 'emailed' | 'attention' | 'tasks';

/**
 * Contacts whose E.164 identity ends with these digits. Covers numbers that were
 * only ever seen on a call, so they never reached the contact's phone list.
 */
async function contactIdsByPhone(digits: string): Promise<string[]> {
  if (digits.length < 6) return [];
  const suffix = digits.length >= 9 ? digits.slice(-9) : digits;
  const { data, error } = await sb.from('community_identities').select('contact_id').eq('kind', 'phone').like('value', `%${suffix}`);
  if (error) return [];
  return [...new Set((data ?? []).map((r: { contact_id: string }) => r.contact_id))].slice(0, 50); // keep the URL short
}

export async function listContacts(opts: { q?: string; filter?: ContactFilter; limit?: number; offset?: number }): Promise<Contact[]> {
  let query = sb.from('community_contacts').select(CONTACT_COLUMNS).order('last_seen', { ascending: false });
  const raw = opts.q?.trim() ?? '';
  if (raw) {
    // A phone-shaped query is reduced to digits so every format — 0410 849 548,
    // 0410849548, +61 410 849 548, (02) 6190 2894 — hits the same tokens.
    const term = (isPhoneQuery(raw) ? phoneSearchToken(raw) : raw.toLowerCase()).replace(/[%_,]/g, '');
    if (isPhoneQuery(raw)) {
      const ids = await contactIdsByPhone(phoneDigits(raw));
      query = ids.length
        ? query.or(`search_text.ilike.%${term}%,id.in.(${ids.join(',')})`)
        : query.ilike('search_text', `%${term}%`);
    } else if (term) {
      query = query.ilike('search_text', `%${term}%`);
    }
  }
  switch (opts.filter) {
    case 'customers': query = query.gt('nb_orders', 0); break;
    case 'called': query = query.gt('nb_calls', 0); break;
    case 'emailed': query = query.gt('nb_emails', 0); break;
    case 'tasks': query = query.gt('nb_tasks', 0); break;
    case 'attention': query = query.in('status', ['angry', 'waiting']); break;
  }
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  const { data, error } = await query.range(offset, offset + limit - 1);
  if (error) throw error;
  return (data ?? []) as Contact[];
}

export async function searchContacts(q: string, excludeId?: string): Promise<Contact[]> {
  const rows = await listContacts({ q, limit: 8 });
  return rows.filter((r) => r.id !== excludeId);
}

export async function getContact(id: string): Promise<Contact | null> {
  const { data, error } = await sb.from('community_contacts').select(CONTACT_COLUMNS).eq('id', id).maybeSingle();
  if (error) throw error;
  return (data as Contact) ?? null;
}

export async function updateContact(id: string, patch: Partial<Contact>): Promise<Contact> {
  const { data, error } = await sb.from('community_contacts').update(patch).eq('id', id).select(CONTACT_COLUMNS).single();
  if (error) throw error;
  return data as Contact;
}

export async function deleteContact(id: string): Promise<void> {
  const { error } = await sb.from('community_contacts').delete().eq('id', id);
  if (error) throw error;
}

export async function mergeContacts(keepId: string, dropId: string): Promise<string> {
  const { data, error } = await sb.rpc('community_merge_contacts', { p_keep: keepId, p_drop: dropId });
  if (error) throw error;
  return data as string;
}

export async function listNotes(contactId: string, limit = 60, before?: string): Promise<ContactNote[]> {
  let q = sb.from('community_notes').select('*').eq('contact_id', contactId).order('date', { ascending: false }).limit(limit);
  if (before) q = q.lt('date', before);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as ContactNote[];
}

export async function createNote(input: { contact_id: string; text: string; sales_id: string | null; status?: string }): Promise<ContactNote> {
  const { data, error } = await sb.from('community_notes').insert({ ...input, kind: 'note', status: input.status ?? 'note' }).select('*').single();
  if (error) throw error;
  await sb.from('community_contacts').update({ last_seen: new Date().toISOString() }).eq('id', input.contact_id);
  return data as ContactNote;
}

export async function updateNote(id: string, patch: Partial<ContactNote>): Promise<void> {
  const { error } = await sb.from('community_notes').update(patch).eq('id', id);
  if (error) throw error;
}

export async function deleteNote(id: string): Promise<void> {
  const { error } = await sb.from('community_notes').delete().eq('id', id);
  if (error) throw error;
}

export async function listTasks(contactId: string): Promise<Task[]> {
  const { data, error } = await sb.from('community_tasks').select('*').eq('contact_id', contactId).order('due_date', { ascending: true, nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as Task[];
}

export async function createTask(input: { contact_id: string; text: string; type: string; due_date: string | null; sales_id: string | null }): Promise<Task> {
  const { data, error } = await sb.from('community_tasks').insert(input).select('*').single();
  if (error) throw error;
  await sb.rpc('community_recompute_stats', { p_contact: input.contact_id });
  return data as Task;
}

export async function updateTask(id: string, contactId: string, patch: Partial<Task>): Promise<void> {
  const { error } = await sb.from('community_tasks').update(patch).eq('id', id);
  if (error) throw error;
  await sb.rpc('community_recompute_stats', { p_contact: contactId });
}

export async function deleteTask(id: string, contactId: string): Promise<void> {
  const { error } = await sb.from('community_tasks').delete().eq('id', id);
  if (error) throw error;
  await sb.rpc('community_recompute_stats', { p_contact: contactId });
}

export async function listSales(): Promise<Sale[]> {
  const { data, error } = await sb.from('profiles').select('id,full_name,email').order('full_name');
  if (error) throw error;
  return (data ?? []) as Sale[];
}

export async function listAllTags(): Promise<string[]> {
  const { data, error } = await sb.from('community_contacts').select('tags').not('tags', 'eq', '{}').limit(1000);
  if (error) throw error;
  const set = new Set<string>();
  for (const row of data ?? []) for (const t of row.tags ?? []) set.add(t);
  return [...set].sort((a, b) => a.localeCompare(b));
}

export interface SyncStatus { contacts: number | null; state: { key: string; value: Record<string, unknown>; updated_at: string }[] }

export async function getSyncStatus(): Promise<SyncStatus | null> {
  const { data, error } = await sb.from('community_sync_state').select('key,value,updated_at');
  if (error) return null;
  const { count } = await sb.from('community_contacts').select('id', { count: 'exact', head: true });
  return { contacts: count ?? null, state: data ?? [] };
}

export async function runSync(phases?: string[]): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.functions.invoke('community-sync', { body: { action: 'sync', phases } });
  if (error) throw error;
  return data as Record<string, unknown>;
}
