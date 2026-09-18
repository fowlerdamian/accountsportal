import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNowStrict } from 'date-fns';
import { RefreshCw, Search, ShoppingBag, Phone, Mail } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { getSyncStatus, listContacts, runSync, type ContactFilter } from '../lib/api';
import { contactInitials, contactName, type Contact } from '../types';

const PAGE = 50;
const FILTERS: { key: ContactFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'customers', label: 'Ordered' },
  { key: 'called', label: 'Called' },
  { key: 'emailed', label: 'Emailed' },
  { key: 'tasks', label: 'With tasks' },
  { key: 'attention', label: 'Angry & waiting' },
];
const STATUS_DOT: Record<string, string> = { cold: 'bg-muted-foreground/40', waiting: 'bg-primary/70', angry: 'bg-destructive', 'in-contract': 'bg-primary' };
const STALE_MS = 30 * 60 * 1000;

export default function ContactList() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [debounced, setDebounced] = useState(q);
  const [filter, setFilter] = useState<ContactFilter>((params.get('f') as ContactFilter) || 'all');
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState('');
  const autoSynced = useRef(false);

  useEffect(() => { const t = setTimeout(() => setDebounced(q), 250); return () => clearTimeout(t); }, [q]);
  useEffect(() => {
    const next = new URLSearchParams();
    if (debounced) next.set('q', debounced);
    if (filter !== 'all') next.set('f', filter);
    setParams(next, { replace: true });
  }, [debounced, filter, setParams]);

  const { data, fetchNextPage, hasNextPage, isFetching, isLoading } = useInfiniteQuery({
    queryKey: ['community', 'contacts', debounced, filter],
    queryFn: ({ pageParam = 0 }) => listContacts({ q: debounced, filter, limit: PAGE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => (last.length === PAGE ? pages.length * PAGE : undefined),
  });
  const contacts: Contact[] = data?.pages.flat() ?? [];

  const { data: status } = useQuery({ queryKey: ['community', 'sync-status'], queryFn: getSyncStatus, staleTime: 60_000 });
  const lastRun = status?.state.find((s) => s.key === 'last_run')?.value as { at?: string } | undefined;

  const sync = async (manual = false) => {
    setSyncing(true);
    setSyncNote(manual ? 'Syncing Shopify, Dialpad and the inbox…' : 'Checking for new activity…');
    try {
      const r = await runSync();
      const orders = (r.orders as any)?.processed ?? 0, calls = (r.calls as any)?.processed ?? 0;
      const emails = Object.values((r.emails as Record<string, any>) ?? {}).reduce((s, v) => s + (v?.processed ?? 0), 0);
      setSyncNote(`Synced ${orders} orders, ${calls} calls, ${emails} emails`);
      await qc.invalidateQueries({ queryKey: ['community'] });
    } catch (e) {
      setSyncNote(e instanceof Error ? e.message : 'Sync failed');
    } finally { setSyncing(false); }
  };
  useEffect(() => {
    if (!status || autoSynced.current) return;
    autoSynced.current = true;
    const at = lastRun?.at ? new Date(lastRun.at).getTime() : 0;
    if (Date.now() - at > STALE_MS) void sync(false);
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Customer Service</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {status?.contacts != null ? `${status.contacts.toLocaleString()} contacts` : 'Contacts'} built from Shopify orders, Dialpad calls and the inbox
            {lastRun?.at && <span> · synced {formatDistanceToNowStrict(new Date(lastRun.at), { addSuffix: true })}</span>}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {syncNote && <span className="text-xs text-muted-foreground">{syncNote}</span>}
          <Button variant="outline" size="sm" onClick={() => sync(true)} disabled={syncing}>
            <RefreshCw className={cn('mr-1.5 h-3.5 w-3.5', syncing && 'animate-spin')} /> {syncing ? 'Syncing' : 'Sync now'}
          </Button>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-80">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, company, email or phone (any format)" className="pl-9" />
        </div>
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={cn('rounded-full px-3 py-1 text-xs transition-colors', filter === f.key ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <ul className="mt-6 divide-y divide-border/60">
        {isLoading && <li className="py-10 text-center text-sm text-muted-foreground">Loading…</li>}
        {!isLoading && contacts.length === 0 && (
          <li className="py-10 text-center text-sm text-muted-foreground">{debounced ? 'No contacts match.' : 'No contacts yet — run a sync.'}</li>
        )}
        {contacts.map((c) => (
          <li key={c.id}>
            <Link to={`/community/contacts/${c.id}`} className="-mx-3 flex items-center gap-4 rounded-md px-3 py-3 transition-colors hover:bg-muted/60">
              <Avatar className="h-9 w-9"><AvatarFallback className="bg-muted text-xs text-muted-foreground">{contactInitials(c)}</AvatarFallback></Avatar>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', STATUS_DOT[c.status] ?? STATUS_DOT.cold)} title={c.status_reason ? `${c.status} — ${c.status_reason}` : c.status} />
                  <span className="truncate text-sm font-medium">{contactName(c)}</span>
                  {c.company_name && [c.first_name, c.last_name].some(Boolean) && <span className="truncate text-sm text-muted-foreground">· {c.company_name}</span>}
                </div>
                <div className="mt-0.5 truncate text-xs text-muted-foreground">
                  {[c.email_jsonb?.[0]?.email, c.phone_jsonb?.[0]?.number].filter(Boolean).join(' · ') || 'No contact details'}
                </div>
              </div>
              <div className="hidden items-center gap-1 sm:flex">
                {c.tags.slice(0, 3).map((t) => <Badge key={t} variant="secondary" className="rounded-full font-normal">{t}</Badge>)}
              </div>
              <div className="hidden w-40 items-center justify-end gap-3 text-xs text-muted-foreground md:flex">
                {c.nb_orders > 0 && <span className="inline-flex items-center gap-1" title="Orders"><ShoppingBag className="h-3.5 w-3.5" />{c.nb_orders}</span>}
                {c.nb_calls > 0 && <span className="inline-flex items-center gap-1" title="Calls"><Phone className="h-3.5 w-3.5" />{c.nb_calls}</span>}
                {c.nb_emails > 0 && <span className="inline-flex items-center gap-1" title="Emails"><Mail className="h-3.5 w-3.5" />{c.nb_emails}</span>}
              </div>
              <div className="w-24 shrink-0 text-right text-xs text-muted-foreground">{formatDistanceToNowStrict(new Date(c.last_seen), { addSuffix: true })}</div>
            </Link>
          </li>
        ))}
      </ul>
      {hasNextPage && (
        <div className="py-6 text-center">
          <Button variant="outline" size="sm" onClick={() => fetchNextPage()} disabled={isFetching}>{isFetching ? 'Loading…' : 'Load more'}</Button>
        </div>
      )}
    </div>
  );
}
