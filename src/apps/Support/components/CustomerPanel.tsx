import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { getContact, linkCaseToContact, listContactCases, searchContacts } from '@portal/apps/Community/lib/api';
import { contactName, STATUS_LABEL, type Contact } from '@portal/apps/Community/types';

/**
 * The customer behind a case. Linked automatically from the order number or
 * name (cases_match_contact); when that finds nobody, staff pick the profile here.
 */
export function CustomerPanel({ caseId, contactId, customerName }: { caseId: string; contactId: string | null; customerName: string | null }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Contact[]>([]);
  const [busy, setBusy] = useState(false);

  const { data: contact } = useQuery({ queryKey: ['community', 'contact', contactId], queryFn: () => getContact(contactId!), enabled: !!contactId });
  const { data: cases = [] } = useQuery({ queryKey: ['community', 'cases', contactId], queryFn: () => listContactCases(contactId!), enabled: !!contactId });
  const others = cases.filter((c) => c.id !== caseId);
  const othersOpen = others.filter((c) => c.status !== 'closed').length;

  useEffect(() => {
    if (!open || q.trim().length < 2) { setResults([]); return; }
    const t = setTimeout(() => { searchContacts(q).then(setResults).catch(() => setResults([])); }, 200);
    return () => clearTimeout(t);
  }, [q, open]);

  const link = async (c: Contact) => {
    setBusy(true);
    try {
      await linkCaseToContact(caseId, c.id);
      await Promise.all([qc.invalidateQueries({ queryKey: ['case', caseId] }), qc.invalidateQueries({ queryKey: ['community'] })]);
      setOpen(false);
      toast.success(`Linked to ${contactName(c)}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not link customer');
    } finally { setBusy(false); }
  };

  const openPicker = () => { setQ(customerName ?? ''); setOpen(true); };

  return (
    <div className="bg-card border border-border p-4 mb-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h3 className="text-xs font-heading tracking-wider text-muted-foreground">CUSTOMER</h3>
        <button type="button" onClick={openPicker} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
          {contactId ? 'Change' : 'Link customer'}
        </button>
      </div>

      {contact ? (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
          <div>
            <span className="text-muted-foreground text-xs block mb-0.5">Profile</span>
            <Link to={`/support/customers/${contact.id}`} className="text-foreground underline underline-offset-4 decoration-border hover:decoration-foreground">{contactName(contact)}</Link>
          </div>
          <div>
            <span className="text-muted-foreground text-xs block mb-0.5">Contact</span>
            <span className="text-foreground break-words">{[contact.email_jsonb?.[0]?.email, contact.phone_jsonb?.[0]?.number].filter(Boolean).join(' · ') || '—'}</span>
          </div>
          <div>
            <span className="text-muted-foreground text-xs block mb-0.5">Status</span>
            <span className="text-foreground" title={contact.status_reason ?? undefined}>{STATUS_LABEL[contact.status] ?? contact.status}</span>
          </div>
          <div>
            <span className="text-muted-foreground text-xs block mb-0.5">Other cases</span>
            <span className="text-foreground">{others.length ? `${others.length} (${othersOpen} open)` : 'None'}</span>
          </div>
          <div>
            <span className="text-muted-foreground text-xs block mb-0.5">Orders</span>
            <span className="text-foreground">{contact.nb_orders ? `${contact.nb_orders} · $${Number(contact.total_spent).toLocaleString('en-AU', { maximumFractionDigits: 0 })}` : '—'}</span>
          </div>
          <div>
            <span className="text-muted-foreground text-xs block mb-0.5">Calls / emails</span>
            <span className="text-foreground">{contact.nb_calls} / {contact.nb_emails}{contact.avg_csat ? ` · CSAT ${Number(contact.avg_csat).toFixed(1)}` : ''}</span>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{contactId ? 'Loading…' : 'No customer profile linked to this case.'}</p>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Link a customer</DialogTitle>
            <DialogDescription>The case appears on that customer's profile alongside their calls, emails and orders.</DialogDescription>
          </DialogHeader>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, email, phone (any format) or company" autoFocus />
          {results.length > 0 ? (
            <ul className="max-h-64 divide-y divide-border/60 overflow-y-auto rounded-md border">
              {results.map((r) => (
                <li key={r.id}>
                  <button type="button" disabled={busy} onClick={() => void link(r)} className="w-full px-3 py-2 text-left hover:bg-muted disabled:opacity-50">
                    <div className="truncate text-sm">{contactName(r)}</div>
                    <div className="truncate text-xs text-muted-foreground">{[r.company_name, r.email_jsonb?.[0]?.email, r.phone_jsonb?.[0]?.number].filter(Boolean).join(' · ')}</div>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            q.trim().length >= 2 && <p className="text-sm text-muted-foreground">No customers match.</p>
          )}
          <div className="flex justify-end">
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
