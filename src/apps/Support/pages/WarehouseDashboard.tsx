import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { LogOut, Clock, ChevronDown, ExternalLink, Loader2, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { notifyActionItemAssigned } from '@/lib/notifyGoogleChat';
import type { ActionItem } from '@/lib/types';

function LiveClock() {
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return <span className="text-sm text-muted-foreground font-mono">{format(time, 'h:mm:ss a')}</span>;
}

interface PickItem {
  sku: string;
  name: string;
  qty: number;
}

interface WarehouseActionItem extends ActionItem {
  cases?: { case_number: string; title: string; customer_name: string | null } | null;
  manual_pick_requests?: Array<{
    customer_name: string | null;
    phone: string | null;
    address_line1: string | null;
    address_line2: string | null;
    city: string | null;
    state: string | null;
    postcode: string | null;
    country: string | null;
    items: PickItem[];
    notes: string | null;
  }> | null;
}

function PickOrderCard({ item, readOnly }: { item: WarehouseActionItem; readOnly: boolean }) {
  const queryClient = useQueryClient();
  const { teamMember } = useAuth();
  const pick = item.manual_pick_requests?.[0];
  const pickItems: PickItem[] = (pick?.items || []) as PickItem[];
  const [checkedItems, setCheckedItems] = useState<boolean[]>(pickItems.map(() => false));
  const [showSkipConfirm, setShowSkipConfirm] = useState(false);

  const allChecked = checkedItems.length > 0 && checkedItems.every(Boolean);
  const checkedCount = checkedItems.filter(Boolean).length;

  const caseNum = item.cases?.case_number || '—';
  const caseTitle = item.cases?.title || '';

  const toggleItem = (idx: number) => {
    if (readOnly) return;
    const next = [...checkedItems];
    next[idx] = !next[idx];
    setCheckedItems(next);

    // Auto-mark picked when all checked
    if (next.every(Boolean) && !item.picked_at) {
      supabase.from('action_items').update({ picked_at: new Date().toISOString() } as any).eq('id', item.id).then();
    } else if (!next.every(Boolean) && item.picked_at) {
      supabase.from('action_items').update({ picked_at: null } as any).eq('id', item.id).then();
    }
  };

  const sendToShipStation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('shipstation-create-order', {
        body: {
          caseId: item.case_id,
          caseNumber: caseNum,
          caseTitle,
          actionItemId: item.id,
          customerName: pick?.customer_name || '',
          phone: pick?.phone || '',
          address: {
            street1: pick?.address_line1 || '',
            street2: pick?.address_line2 || '',
            city: pick?.city || '',
            state: pick?.state || '',
            postalCode: pick?.postcode || '',
            country: pick?.country || 'AU',
          },
          items: pickItems,
          originalOrderNumber: item.cases?.case_number || '',
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: async (data) => {
      // Auto-mark as dispatched after successful ShipStation order
      const now = new Date().toISOString();
      await supabase.from('action_items').update({
        status: 'done' as any,
        completed_at: now,
        dispatched_at: now,
      }).eq('id', item.id);

      // Log activity
      const msg = `Order dispatched — SS ${data.orderNumber}\nBy: ${teamMember?.name || 'Warehouse'}`;
      await supabase.from('case_updates').insert({
        case_id: item.case_id,
        author_type: 'system',
        author_name: teamMember?.name || 'Warehouse',
        message: msg,
      });

      // Chat notification deferred — sent by shipstation-webhook once tracking is received

      queryClient.invalidateQueries({ queryKey: ['warehouse-tasks'] });
      toast.success(`ShipStation order created: ${data.orderNumber} — marked as dispatched`);
    },
    onError: () => toast.error('ShipStation order failed — try again or create manually'),
  });

  const markDispatched = useMutation({
    mutationFn: async () => {
      const now = new Date().toISOString();
      await supabase.from('action_items').update({
        status: 'done' as any,
        completed_at: now,
        dispatched_at: now,
      }).eq('id', item.id);

      // Log activity
      const ssNum = item.shipstation_order_number;
      const msg = ssNum
        ? `Order dispatched — SS ${ssNum}\nBy: ${teamMember?.name || 'Warehouse'}`
        : `Order dispatched (no SS order)\nBy: ${teamMember?.name || 'Warehouse'}`;
      await supabase.from('case_updates').insert({
        case_id: item.case_id,
        author_type: 'system',
        author_name: teamMember?.name || 'Warehouse',
        message: msg,
      });

      // Chat notification deferred — sent by shipstation-webhook once tracking is received
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['warehouse-tasks'] });
      toast.success('Marked as dispatched');
    },
  });

  return (
    <div className="bg-card border border-border p-5" style={{ borderLeftWidth: '4px', borderLeftColor: '#1A6FA8' }}>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[11px] font-medium px-2 py-0.5 border" style={{ backgroundColor: '#1A6FA815', color: '#1A6FA8', borderColor: '#1A6FA830' }}>Pick order</span>
        <span className="text-xs text-muted-foreground">#{caseNum}</span>
        {item.priority === 'urgent' && <span className="text-[11px] font-medium px-2 py-0.5 bg-status-urgent/15 text-status-urgent border border-status-urgent/30">Urgent</span>}
      </div>

      {pick && (
        <div className="mb-4 text-sm">
          <p className="text-foreground font-medium">{pick.customer_name}</p>
          {pick.phone && <p className="text-xs text-muted-foreground">{pick.phone}</p>}
          <p className="text-xs text-muted-foreground">
            {[pick.address_line1, pick.address_line2, pick.city, pick.state, pick.postcode].filter(Boolean).join(', ')}
          </p>
          {pick.notes && <p className="text-xs text-muted-foreground italic mt-1">Note: {pick.notes}</p>}
        </div>
      )}

      {/* Line items table */}
      {pickItems.length > 0 && (
        <div className="border border-border mb-3">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-3 py-2 text-xs text-muted-foreground font-medium">SKU</th>
                <th className="text-left px-3 py-2 text-xs text-muted-foreground font-medium">Product</th>
                <th className="text-right px-3 py-2 text-xs text-muted-foreground font-medium">Qty</th>
                {!readOnly && <th className="text-right px-3 py-2 w-10"></th>}
              </tr>
            </thead>
            <tbody>
              {pickItems.map((pi, idx) => (
                <tr key={idx} className={cn('border-b border-border last:border-0', checkedItems[idx] && 'opacity-50')}>
                  <td className={cn('px-3 py-2 font-mono text-xs', checkedItems[idx] && 'line-through')}>{pi.sku || '—'}</td>
                  <td className={cn('px-3 py-2', checkedItems[idx] && 'line-through')}>{pi.name}</td>
                  <td className={cn('px-3 py-2 text-right', checkedItems[idx] && 'line-through')}>{pi.qty}</td>
                  {!readOnly && (
                    <td className="px-3 py-2 text-right">
                      <input type="checkbox" checked={checkedItems[idx]} onChange={() => toggleItem(idx)} className="accent-status-resolved" />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Progress */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-1">
          <span className={cn('text-xs', allChecked ? 'text-status-resolved font-medium' : 'text-muted-foreground')}>
            {allChecked ? 'All items picked — ready to dispatch' : `${checkedCount} of ${pickItems.length} items picked`}
          </span>
        </div>
        <div className="flex gap-0.5">
          {pickItems.map((_, idx) => (
            <div key={idx} className={cn('h-1.5 flex-1 transition-colors', checkedItems[idx] ? 'bg-status-resolved' : 'bg-border')} />
          ))}
        </div>
      </div>

      {readOnly && <span className="text-xs text-muted-foreground">View only</span>}

      {!readOnly && !allChecked && (
        <p className="text-xs text-muted-foreground">Tick all items above to unlock dispatch</p>
      )}

      {!readOnly && allChecked && !item.shipstation_order_number && !item.dispatched_at && (
        <div className="flex items-center gap-3 mt-3">
          <button
            onClick={() => sendToShipStation.mutate()}
            disabled={sendToShipStation.isPending}
            className="flex items-center gap-2 bg-status-progress text-foreground px-4 py-2 text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {sendToShipStation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Send to ShipStation
          </button>
          <button
            onClick={() => setShowSkipConfirm(true)}
            className="text-xs text-muted-foreground hover:text-foreground underline transition-colors"
          >
            Skip
          </button>
        </div>
      )}

      {showSkipConfirm && !item.dispatched_at && (
        <div className="mt-3">
          <button
            onClick={() => markDispatched.mutate()}
            disabled={markDispatched.isPending}
            className="w-full bg-status-resolved text-foreground py-2.5 text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {markDispatched.isPending ? 'Dispatching...' : 'Mark as dispatched'}
          </button>
        </div>
      )}

      {item.shipstation_order_number && !item.dispatched_at && (
        <div className="mt-3 space-y-2">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">SS Order:</span>
            <span className="text-foreground font-medium">{item.shipstation_order_number}</span>
            <a
              href={`https://ship14.shipstation.com/orders/all?quickSearch=${item.shipstation_order_number}`}
              target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              View in ShipStation <ExternalLink className="h-3 w-3" />
            </a>
          </div>
          <button
            onClick={() => markDispatched.mutate()}
            disabled={markDispatched.isPending}
            className="w-full bg-status-resolved text-foreground py-2.5 text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {markDispatched.isPending ? 'Dispatching...' : 'Mark as dispatched'}
          </button>
        </div>
      )}
    </div>
  );
}

function GeneralTaskCard({ item, readOnly }: { item: WarehouseActionItem; readOnly: boolean }) {
  const queryClient = useQueryClient();
  const { teamMember } = useAuth();
  const [note, setNote] = useState('');
  const caseNum = item.cases?.case_number || '—';

  const markDone = useMutation({
    mutationFn: async () => {
      const now = new Date().toISOString();
      await supabase.from('action_items').update({
        status: 'done' as any,
        completed_at: now,
        warehouse_result: note || null,
      }).eq('id', item.id);

      const msg = note
        ? `Warehouse: ${item.description}\nNote: ${note}\nBy: ${teamMember?.name || 'Warehouse'}`
        : `Warehouse: ${item.description}\nCompleted by: ${teamMember?.name || 'Warehouse'}`;
      await supabase.from('case_updates').insert({
        case_id: item.case_id,
        author_type: 'system',
        author_name: teamMember?.name || 'Warehouse',
        message: msg,
      });

      notifyActionItemAssigned({
        caseId: item.case_id,
        caseNumber: caseNum,
        caseTitle: item.description,
        assigneeName: teamMember?.name || 'Warehouse',
        taskDescription: `Completed: ${item.description}`,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['warehouse-tasks'] });
      toast.success('Task marked done');
    },
  });

  const isUrgent = item.priority === 'urgent';

  return (
    <div className="bg-card border border-border p-5" style={{ borderLeftWidth: '4px', borderLeftColor: isUrgent ? '#C0392B' : '#5A5A5A' }}>
      <div className="flex items-center gap-2 mb-3">
        <span className={cn(
          'text-[11px] font-medium px-2 py-0.5 border',
          isUrgent ? 'bg-status-urgent/15 text-status-urgent border-status-urgent/30' : 'bg-muted text-muted-foreground border-border'
        )}>
          {isUrgent ? 'Task · Urgent' : 'Task'}
        </span>
        <span className="text-xs text-muted-foreground">#{caseNum}</span>
      </div>

      <p className="text-base text-foreground mb-2">{item.description}</p>
      <p className="text-xs text-muted-foreground mb-4">
        Assigned by {item.created_by_name}
        {item.due_date && <> · Due {format(new Date(item.due_date), 'dd MMM')}</>}
      </p>

      {readOnly ? (
        <span className="text-xs text-muted-foreground">View only</span>
      ) : (
        <>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Add a note (optional)"
            rows={2}
            className="w-full bg-background border border-input text-sm px-3 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-foreground transition-colors resize-none mb-3"
          />
          <button
            onClick={() => markDone.mutate()}
            disabled={markDone.isPending}
            className="w-full bg-status-resolved text-foreground py-2.5 text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {markDone.isPending ? 'Completing...' : 'Mark done'}
          </button>
        </>
      )}
    </div>
  );
}

export default function WarehouseDashboard() {
  const { teamMember, isWarehouse, isAdmin, signOut } = useAuth();
  const navigate = useNavigate();
  const readOnly = !isWarehouse && !isAdmin;
  const queryClient = useQueryClient();

  // Esc to go back to dashboard (non-warehouse users only)
  useEffect(() => {
    if (isWarehouse) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        navigate('/support');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isWarehouse, navigate]);

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ['warehouse-tasks'],
    queryFn: async () => {
      const { data, error } = await (supabase
        .from('action_items')
        .select('*, cases(case_number, title, customer_name)') as any)
        .eq('is_warehouse_task', true)
        .order('created_at', { ascending: true });
      if (error) throw error;

      // Fetch manual pick requests separately for replacement picks
      const items = (data || []) as WarehouseActionItem[];
      const pickItems = items.filter(t => t.is_replacement_pick);
      if (pickItems.length > 0) {
        for (const pi of pickItems) {
          const { data: picks } = await supabase
            .from('manual_pick_requests')
            .select('*')
            .eq('case_id', pi.case_id)
            .order('created_at', { ascending: false })
            .limit(1);
          pi.manual_pick_requests = (picks || []) as any;
        }
      }
      return items;
    },
  });

  // Realtime
  useEffect(() => {
    const channel = supabase
      .channel('warehouse-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'action_items' }, (payload) => {
        queryClient.invalidateQueries({ queryKey: ['warehouse-tasks'] });
        if (payload.eventType === 'INSERT' && (payload.new as any)?.is_warehouse_task) {
          toast.info('New warehouse task received');
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'manual_pick_requests' }, () => {
        queryClient.invalidateQueries({ queryKey: ['warehouse-tasks'] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const activeTasks = tasks.filter(t => t.status !== 'done');
  const doneToday = tasks.filter(t => t.status === 'done' && t.completed_at && new Date(t.completed_at) >= today);
  const pickOrders = activeTasks.filter(t => t.is_replacement_pick);
  const generalTasks = activeTasks.filter(t => !t.is_replacement_pick);

  // Sort: urgent first, then oldest
  const sortedGeneral = [...generalTasks].sort((a, b) => {
    if (a.priority === 'urgent' && b.priority !== 'urgent') return -1;
    if (b.priority === 'urgent' && a.priority !== 'urgent') return 1;
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });

  const todoCount = activeTasks.filter(t => t.status === 'todo').length;
  const inProgressCount = activeTasks.filter(t => t.status === 'in_progress').length;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img src="/icons/icon-192.png" alt="Support Hub" className="h-6 w-6" />
          <h1 className="text-lg font-heading tracking-wider text-foreground">WAREHOUSE</h1>
          {readOnly && <span className="text-xs text-muted-foreground border border-border px-2 py-0.5">View only</span>}
        </div>
        <div className="flex items-center gap-4">
          {!isWarehouse && (
            <button onClick={() => navigate('/support')} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
              <ArrowLeft className="h-4 w-4" /> Dashboard
            </button>
          )}
          <LiveClock />
          {teamMember && (
            <button
              onClick={() => navigate('/support/warehouse/profile')}
              className="flex items-center gap-2 hover:opacity-80 transition-opacity"
              title="Profile settings"
            >
              <div className="h-6 w-6 flex items-center justify-center text-[10px] font-medium" style={{ backgroundColor: teamMember.avatar_colour, borderRadius: '2px' }}>
                {teamMember.name.split(' ').map(n => n[0]).join('')}
              </div>
              <span className="text-sm text-foreground">{teamMember.name}</span>
            </button>
          )}
          <button onClick={signOut} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      </header>

      <main className="max-w-[1100px] mx-auto px-6 py-6">
        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 mb-8">
          <div className="bg-card border border-border px-4 py-3" style={{ borderTopWidth: '3px', borderTopColor: '#5A5A5A' }}>
            <span className="text-2xl font-heading text-foreground">{todoCount}</span>
            <span className="text-xs text-muted-foreground uppercase tracking-wide font-heading block mt-0.5">To do</span>
          </div>
          <div className="bg-card border border-border px-4 py-3" style={{ borderTopWidth: '3px', borderTopColor: '#1A6FA8' }}>
            <span className="text-2xl font-heading text-foreground">{inProgressCount}</span>
            <span className="text-xs text-muted-foreground uppercase tracking-wide font-heading block mt-0.5">In progress</span>
          </div>
          <div className="bg-card border border-border px-4 py-3" style={{ borderTopWidth: '3px', borderTopColor: '#2E7D32' }}>
            <span className="text-2xl font-heading text-foreground">{doneToday.length}</span>
            <span className="text-xs text-muted-foreground uppercase tracking-wide font-heading block mt-0.5">Done today</span>
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => <div key={i} className="bg-card border border-border h-32 animate-pulse" />)}
          </div>
        ) : (
          <>
            {/* Pick Orders */}
            {pickOrders.length > 0 && (
              <div className="mb-8">
                <h2 className="text-xs font-heading tracking-wider text-muted-foreground mb-3">PICK ORDERS</h2>
                <div className="space-y-3">
                  {pickOrders.map(t => <PickOrderCard key={t.id} item={t} readOnly={readOnly} />)}
                </div>
              </div>
            )}

            {/* Tasks */}
            {sortedGeneral.length > 0 && (
              <div className="mb-8">
                <h2 className="text-xs font-heading tracking-wider text-muted-foreground mb-3">TASKS</h2>
                <div className="space-y-3">
                  {sortedGeneral.map(t => <GeneralTaskCard key={t.id} item={t} readOnly={readOnly} />)}
                </div>
              </div>
            )}

            {activeTasks.length === 0 && (
              <div className="text-center py-16 text-muted-foreground">
                <p className="text-sm">No tasks right now — check back soon.</p>
              </div>
            )}

            {/* Done today accordion */}
            {doneToday.length > 0 && (
              <details className="mt-8">
                <summary className="text-xs font-heading tracking-wider text-muted-foreground cursor-pointer hover:text-foreground py-2 flex items-center gap-2">
                  <ChevronDown className="h-3.5 w-3.5" />
                  Done today ({doneToday.length})
                </summary>
                <div className="space-y-2 mt-2 opacity-60">
                  {doneToday.map(t => (
                    <div key={t.id} className="bg-card border border-border p-3 text-sm">
                      <span className="text-foreground">{t.description}</span>
                      <span className="text-xs text-muted-foreground ml-2">#{t.cases?.case_number}</span>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </>
        )}
      </main>
    </div>
  );
}
