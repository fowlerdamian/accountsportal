import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { CheckCircle2, Circle, Loader2, Clock, AlertTriangle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';
import { formatDistanceToNow, format, isPast } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import type { ActionItem, ActionItemStatus } from '@/lib/types';

const statusIcons: Record<ActionItemStatus, typeof Circle> = {
  todo: Circle,
  in_progress: Loader2,
  done: CheckCircle2,
};

const STATUS_LABEL: Record<ActionItemStatus, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  done: 'Done',
};

type FilterStatus = 'outstanding' | 'done' | 'all';

interface ActionWithCase extends ActionItem {
  cases?: { case_number: string; title: string } | null;
}

export default function ActionItemsPage() {
  const { teamMember } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<FilterStatus>('outstanding');
  const [assigneeFilter, setAssigneeFilter] = useState<'mine' | 'all'>('mine');

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['all-action-items'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('action_items')
        .select('*, cases(case_number, title)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as unknown as ActionWithCase[];
    },
  });

  const toggleStatus = useMutation({
    mutationFn: async ({ itemId, currentStatus }: { itemId: string; currentStatus: ActionItemStatus }) => {
      const next: ActionItemStatus = currentStatus === 'todo' ? 'in_progress' : currentStatus === 'in_progress' ? 'done' : 'todo';
      const updates: Record<string, unknown> = { status: next };
      if (next === 'done') updates.completed_at = new Date().toISOString();
      else updates.completed_at = null;
      const { error } = await supabase.from('action_items').update(updates).eq('id', itemId);
      if (error) throw error;
      return next;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-action-items'] });
      queryClient.invalidateQueries({ queryKey: ['my-action-items-count'] });
    },
    onError: (err) => {
      console.error('Action item toggle failed:', err);
    },
  });

  // Filter items
  let filtered = items;
  if (assigneeFilter === 'mine' && teamMember) {
    filtered = filtered.filter(i => i.assigned_to_email === teamMember.email);
  }
  if (filter === 'outstanding') {
    filtered = filtered.filter(i => i.status !== 'done');
  } else if (filter === 'done') {
    filtered = filtered.filter(i => i.status === 'done');
  }

  // Sort: overdue first, then by due date, then by created
  filtered.sort((a, b) => {
    if (a.status === 'done' && b.status !== 'done') return 1;
    if (a.status !== 'done' && b.status === 'done') return -1;
    const aOverdue = a.due_date && isPast(new Date(a.due_date)) && a.status !== 'done';
    const bOverdue = b.due_date && isPast(new Date(b.due_date)) && b.status !== 'done';
    if (aOverdue && !bOverdue) return -1;
    if (!aOverdue && bOverdue) return 1;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  const outstandingCount = items.filter(i => i.status !== 'done' && (assigneeFilter === 'all' || i.assigned_to_email === teamMember?.email)).length;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-heading font-bold tracking-wide">Action Items</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{outstandingCount} outstanding</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 mb-4">
        <div className="flex gap-1">
          {(['mine', 'all'] as const).map(f => (
            <button
              key={f}
              onClick={() => setAssigneeFilter(f)}
              className={cn(
                'px-3 py-1.5 text-xs font-medium transition-colors border',
                assigneeFilter === f
                  ? 'bg-foreground text-background border-foreground'
                  : 'text-muted-foreground border-border hover:text-foreground'
              )}
            >
              {f === 'mine' ? 'My items' : 'All team'}
            </button>
          ))}
        </div>

        <div className="h-4 w-px bg-border" />

        <div className="flex gap-1">
          {(['outstanding', 'done', 'all'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                'px-3 py-1.5 text-xs font-medium transition-colors border',
                filter === f
                  ? 'bg-foreground text-background border-foreground'
                  : 'text-muted-foreground border-border hover:text-foreground'
              )}
            >
              {f === 'outstanding' ? 'Outstanding' : f === 'done' ? 'Completed' : 'All'}
            </button>
          ))}
        </div>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="space-y-2">
          {[1, 2, 3].map(i => <div key={i} className="bg-card border border-border h-16 animate-pulse" />)}
        </div>
      )}

      {/* Empty */}
      {!isLoading && filtered.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          <CheckCircle2 className="h-8 w-8 mx-auto mb-3 opacity-40" />
          <p className="text-sm">{filter === 'done' ? 'No completed items' : 'All caught up — no outstanding items'}</p>
        </div>
      )}

      {/* Items list */}
      <div className="space-y-1">
        {filtered.map((item, index) => {
          const Icon = statusIcons[item.status];
          const isOverdue = item.due_date && isPast(new Date(item.due_date)) && item.status !== 'done';
          const isDone = item.status === 'done';

          return (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: isDone ? 0.6 : 1, y: 0 }}
              transition={{ duration: 0.2, delay: index * 0.03 }}
              className={cn(
                'bg-card border border-border p-4 flex items-start gap-3 group',
                isOverdue && 'border-l-2 border-l-status-urgent'
              )}
            >
              {/* Status toggle */}
              <button
                onClick={() => toggleStatus.mutate({ itemId: item.id, currentStatus: item.status })}
                className={cn(
                  'mt-0.5 transition-colors flex-shrink-0',
                  item.status === 'done' ? 'text-status-resolved' : item.status === 'in_progress' ? 'text-status-progress animate-spin' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Icon className="h-4 w-4" />
              </button>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <p className={cn('text-sm text-foreground', isDone && 'line-through text-muted-foreground')}>
                  {item.description}
                </p>
                <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                  {/* Case link */}
                  {item.cases && (
                    <button
                      onClick={() => navigate(`/cases/${item.case_id}`)}
                      className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                    >
                      #{item.cases.case_number}
                    </button>
                  )}

                  {/* Assignee */}
                  <span className="text-[11px] text-muted-foreground">{item.assigned_to_name}</span>

                  {/* Due date */}
                  {item.due_date && (
                    <span className={cn('text-[11px] flex items-center gap-1', isOverdue ? 'text-status-urgent' : 'text-muted-foreground')}>
                      {isOverdue && <AlertTriangle className="h-3 w-3" />}
                      <Clock className="h-3 w-3" />
                      {format(new Date(item.due_date), 'dd MMM')}
                    </span>
                  )}

                  {/* Status label */}
                  <span className={cn(
                    'text-[11px] px-1.5 py-0.5 border',
                    item.status === 'todo' && 'text-muted-foreground border-border',
                    item.status === 'in_progress' && 'text-status-progress border-status-progress/30',
                    item.status === 'done' && 'text-status-resolved border-status-resolved/30',
                  )}>
                    {STATUS_LABEL[item.status]}
                  </span>

                  {/* Priority */}
                  {item.priority === 'urgent' && (
                    <span className="text-[11px] px-1.5 py-0.5 text-status-urgent border border-status-urgent/30">Urgent</span>
                  )}

                  {/* Age */}
                  <span className="text-[11px] text-muted-foreground ml-auto">
                    {formatDistanceToNow(new Date(item.created_at), { addSuffix: true })}
                  </span>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
