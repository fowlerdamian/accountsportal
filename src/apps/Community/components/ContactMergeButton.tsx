import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { GitMerge } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { mergeContacts, searchContacts } from '../lib/api';
import { contactInitials, contactName, type Contact } from '../types';

/** Merge another contact into this one (this one is kept; the other's notes, tasks and identifiers move across). */
export function ContactMergeButton({ contact }: { contact: Contact }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Contact[]>([]);
  const [picked, setPicked] = useState<Contact | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || q.trim().length < 2) { setResults([]); return; }
    const t = setTimeout(() => { searchContacts(q, contact.id).then(setResults).catch(() => setResults([])); }, 200);
    return () => clearTimeout(t);
  }, [q, open, contact.id]);

  const merge = async () => {
    if (!picked) return;
    setBusy(true); setError(null);
    try {
      const keep = await mergeContacts(contact.id, picked.id);
      await qc.invalidateQueries({ queryKey: ['community'] });
      setOpen(false);
      navigate(`/community/contacts/${keep}`, { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Merge failed');
    } finally { setBusy(false); }
  };

  return (
    <>
      <Button variant="ghost" size="sm" className="h-8 text-muted-foreground" onClick={() => setOpen(true)}>
        <GitMerge className="mr-1.5 h-3.5 w-3.5" /> Merge
      </Button>
      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setPicked(null); setQ(''); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Merge with another contact</DialogTitle>
            <DialogDescription>
              The other contact's notes, calls, emails, orders and tasks move onto <span className="font-medium text-foreground">{contactName(contact)}</span>, then it is deleted.
            </DialogDescription>
          </DialogHeader>
          <Input value={q} onChange={(e) => { setQ(e.target.value); setPicked(null); }} placeholder="Search by name, email, phone (any format) or company" autoFocus />
          {results.length > 0 && !picked && (
            <ul className="max-h-64 divide-y divide-border/60 overflow-y-auto rounded-md border">
              {results.map((r) => (
                <li key={r.id}>
                  <button type="button" onClick={() => setPicked(r)} className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted">
                    <Avatar className="h-7 w-7"><AvatarFallback className="text-[10px]">{contactInitials(r)}</AvatarFallback></Avatar>
                    <div className="min-w-0">
                      <div className="truncate text-sm">{contactName(r)}</div>
                      <div className="truncate text-xs text-muted-foreground">{[r.company_name, r.email_jsonb?.[0]?.email, r.phone_jsonb?.[0]?.number].filter(Boolean).join(' · ')}</div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {picked && (
            <div className={cn('rounded-md border p-3 text-sm')}>
              Merging <span className="font-medium">{contactName(picked)}</span> ({picked.nb_orders} orders · {picked.nb_calls} calls · {picked.nb_emails} emails) into this contact.
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={merge} disabled={!picked || busy}>{busy ? 'Merging…' : 'Merge'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
