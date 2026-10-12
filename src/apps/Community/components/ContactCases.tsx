import { Link } from 'react-router-dom';
import { formatDistanceToNowStrict } from 'date-fns';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CaseOriginBadge, PriorityBadge, StatusLabel, getLeftBorderColor } from '@/components/StatusBadge';
import type { CasePriority, CaseStatus, CaseType, ErrorOrigin } from '@/lib/types';
import type { ContactCase } from '../types';

/** The customer's cases — open ones first — with a shortcut to file a new one against them. */
export function ContactCases({ contactId, cases }: { contactId: string; cases: ContactCase[] }) {
  const sorted = [...cases].sort((a, b) => Number(a.status === 'closed') - Number(b.status === 'closed'));
  const open = cases.filter((c) => c.status !== 'closed').length;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Cases{cases.length > 0 && <span className="ml-2 normal-case tracking-normal">{open} open · {cases.length - open} closed</span>}
        </h2>
        <Button asChild variant="outline" size="sm" className="h-8">
          <Link to={`/support/cases/new?contact=${contactId}`}><Plus className="mr-1.5 h-3.5 w-3.5" /> New case</Link>
        </Button>
      </div>
      {sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground">No cases for this customer.</p>
      ) : (
        <ul className="space-y-2">
          {sorted.map((c) => (
            <li key={c.id}>
              <Link
                to={`/support/cases/${c.id}`}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 border border-border bg-card px-3 py-2.5 transition-colors hover:bg-muted/60"
                style={{ borderLeft: `3px solid ${getLeftBorderColor({ type: c.type as CaseType, priority: c.priority as CasePriority, status: c.status as CaseStatus })}` }}
              >
                <span className="font-mono text-xs text-muted-foreground">{c.case_number}</span>
                <span className="min-w-0 flex-1 truncate text-sm">{c.title}</span>
                <PriorityBadge priority={c.priority as CasePriority} />
                <CaseOriginBadge type={c.type as CaseType} origin={c.error_origin as ErrorOrigin} />
                <StatusLabel status={c.status as CaseStatus} />
                <span className="w-20 text-right text-xs text-muted-foreground">{formatDistanceToNowStrict(new Date(c.created_at), { addSuffix: true })}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
