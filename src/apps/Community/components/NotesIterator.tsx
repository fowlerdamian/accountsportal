import { useState } from 'react';
import { format, formatDistanceToNowStrict } from 'date-fns';
import { StickyNote, PhoneIncoming, PhoneOutgoing, PhoneMissed, Mail, ShoppingBag, ExternalLink, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ContactNote, Sale } from '../types';

const kindIcon = (n: ContactNote) => {
  if (n.kind === 'call') {
    if (n.meta?.status !== 'answered') return PhoneMissed;
    return n.meta?.direction === 'inbound' ? PhoneIncoming : PhoneOutgoing;
  }
  if (n.kind === 'email') return Mail;
  if (n.kind === 'order') return ShoppingBag;
  return StickyNote;
};

const KIND_LABEL: Record<string, string> = { note: 'Note', call: 'Call', email: 'Email', order: 'Order' };

function Csat({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" title={`CSAT ${value}/5`}>
      <span className="inline-flex gap-[2px]">
        {[1, 2, 3, 4, 5].map((i) => <span key={i} className={cn('block h-1.5 w-1.5 rounded-full', i <= value ? (value <= 2 ? 'bg-destructive' : 'bg-primary') : 'bg-border')} />)}
      </span>
      {value}/5
    </span>
  );
}

export function Note({ note, sales, canDelete, onDelete }: { note: ContactNote; sales: Sale[]; canDelete: boolean; onDelete: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const Icon = kindIcon(note);
  const author = sales.find((s) => s.id === note.sales_id);
  const date = new Date(note.date);
  const meta = note.meta ?? {};
  const lines = note.text.split('\n');
  const long = lines.length > 4 || note.text.length > 420;
  const shown = expanded || !long ? note.text : lines.slice(0, 4).join('\n').slice(0, 420) + '…';
  const url = typeof meta.url === 'string' ? meta.url : null;

  return (
    <li className="group flex gap-4 py-5">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{KIND_LABEL[note.kind] ?? note.kind}</span>
          {note.kind === 'note' && author && <span>by {author.full_name ?? author.email}</span>}
          {note.kind === 'call' && typeof meta.agent === 'string' && <span>with {meta.agent}</span>}
          {note.kind === 'email' && typeof meta.direction === 'string' && <span>{meta.direction === 'inbound' ? 'from the customer' : 'sent by us'}</span>}
          <span title={format(date, 'PPpp')}>{formatDistanceToNowStrict(date, { addSuffix: true })}</span>
          {typeof meta.csat === 'number' && <Csat value={meta.csat} />}
          {typeof meta.followup_status === 'string' && meta.followup_status !== 'resolved' && meta.followup_status !== 'no_follow_up' && (
            <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[11px]">{String(meta.followup_status).replace('_', ' ')}</span>
          )}
          {Array.isArray(meta.flags) && (meta.flags as string[]).filter((f) => ['complaint', 'escalation_risk', 'churn_risk', 'unresolved'].includes(f)).map((f) => (
            <span key={f} className="rounded-sm bg-destructive/10 px-1.5 py-0.5 text-[11px] text-destructive">{f.replace('_', ' ')}</span>
          ))}
        </div>
        <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">{shown}</p>
        <div className="mt-1 flex items-center gap-3 text-xs">
          {long && (
            <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => setExpanded((v) => !v)}>
              {expanded ? 'Show less' : 'Show more'}
            </button>
          )}
          {url && (
            <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
              {note.kind === 'order' ? 'Open in Shopify' : note.kind === 'email' ? 'Open in Gmail' : 'Open'} <ExternalLink className="h-3 w-3" />
            </a>
          )}
          {canDelete && (
            <Button variant="ghost" size="sm" className="h-6 px-1.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" onClick={() => onDelete(note.id)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>
    </li>
  );
}

export function NotesIterator({ notes, sales, currentUserId, onDelete, onLoadMore, hasMore, loading }: {
  notes: ContactNote[]; sales: Sale[]; currentUserId: string | null; onDelete: (id: string) => void;
  onLoadMore?: () => void; hasMore?: boolean; loading?: boolean;
}) {
  if (!notes.length && !loading) {
    return <p className="py-10 text-center text-sm text-muted-foreground">No activity yet. Notes, calls, emails and orders will show up here.</p>;
  }
  return (
    <div>
      <ul className="divide-y divide-border/60">
        {notes.map((n) => <Note key={n.id} note={n} sales={sales} canDelete={n.kind === 'note' && (!n.sales_id || n.sales_id === currentUserId)} onDelete={onDelete} />)}
      </ul>
      {hasMore && (
        <div className="py-4 text-center">
          <Button variant="outline" size="sm" onClick={onLoadMore} disabled={loading}>{loading ? 'Loading…' : 'Load older activity'}</Button>
        </div>
      )}
    </div>
  );
}
