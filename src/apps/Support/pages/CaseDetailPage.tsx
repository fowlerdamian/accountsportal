import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Send, CheckCircle2, Circle, Loader2, MoreVertical } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { STATUS_LABELS, ActionItemStatus } from '@/lib/types';
import { CaseOriginBadge, PriorityBadge, getLeftBorderColor } from '@/components/StatusBadge';
import { ResponseTimer } from '@/components/ResponseTimer';
import { InlineEdit } from '@/components/InlineEdit';
import { InteractiveProgressBar } from '@/components/InteractiveProgressBar';
import { AddActionItemDrawer } from '@/components/AddActionItemDrawer';
import { OrderDetailsPanel } from '@/components/OrderDetailsPanel';
import { CustomerReferenceLink } from '@/components/CustomerReferenceLink';
import { ShopifyOrderPanel } from '@/components/ShopifyOrderPanel';
import { ManualPickForm } from '@/components/ManualPickForm';
import { ReplacementTrackingPanel } from '@/components/ReplacementTrackingPanel';
import { EscalationPanel } from '@/components/EscalationPanel';
import { formatDistanceToNow, format } from 'date-fns';
import { useState, useRef, useCallback, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { Case, CaseUpdate, ActionItem } from '@/lib/types';

const statusIcons: Record<ActionItemStatus, typeof Circle> = {
  todo: Circle,
  in_progress: Loader2,
  done: CheckCircle2,
};

interface MentionSuggestion {
  id: string;
  name: string;
  email: string;
  avatar_colour: string;
  role: 'admin' | 'staff' | 'warehouse';
}

type DetailTab = 'activity' | 'notes';

export default function CaseDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { teamMember, isAdmin } = useAuth();
  const [message, setMessage] = useState('');
  const [showMentions, setShowMentions] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionIndex, setMentionIndex] = useState(0);
  const [taggedMembers, setTaggedMembers] = useState<MentionSuggestion[]>([]);
  const [activeTab, setActiveTab] = useState<DetailTab>('activity');
  const [noteText, setNoteText] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [kebabOpen, setKebabOpen] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showEscalation, setShowEscalation] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Queries
  const { data: caseData, isLoading: caseLoading } = useQuery({
    queryKey: ['case', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('cases').select('*').eq('id', id!).single();
      if (error) throw error;
      return data as unknown as Case;
    },
    enabled: !!id,
  });

  const { data: updates = [] } = useQuery({
    queryKey: ['case-updates', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('case_updates').select('*').eq('case_id', id!)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data as unknown as CaseUpdate[];
    },
    enabled: !!id,
  });

  const { data: actionItems = [] } = useQuery({
    queryKey: ['action-items', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('action_items').select('*').eq('case_id', id!)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data as unknown as ActionItem[];
    },
    enabled: !!id,
  });

  const { data: teamMembers = [] } = useQuery({
    queryKey: ['team-members'],
    queryFn: async () => {
      const { data, error } = await supabase.from('team_members').select('*').eq('status', 'active');
      if (error) throw error;
      return data as MentionSuggestion[];
    },
  });

  // cin7 query removed — handled by OrderDetailsPanel

  // Delete case mutation
  const deleteCaseMutation = useMutation({
    mutationFn: async () => {
      // 1. Delete attachments (files from storage would go here if bucket exists)
      await supabase.from('case_attachments').delete().eq('case_id', id!);
      // 2. Delete action items
      await supabase.from('action_items').delete().eq('case_id', id!);
      // 3. Delete case updates
      await supabase.from('case_updates').delete().eq('case_id', id!);
      // 4. Delete the case
      const { error } = await supabase.from('cases').delete().eq('id', id!);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Case deleted');
      queryClient.invalidateQueries({ queryKey: ['cases'] });
      navigate('/support');
    },
    onError: () => toast.error('Failed to delete case'),
  });

  // Mention filtering
  const mentionSuggestions = teamMembers.filter(m =>
    m.name.toLowerCase().includes(mentionQuery.toLowerCase()) &&
    !taggedMembers.find(t => t.id === m.id)
  );

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setMessage(val);
    const lastAt = val.lastIndexOf('@');
    if (lastAt !== -1 && (lastAt === 0 || val[lastAt - 1] === ' ')) {
      const query = val.substring(lastAt + 1);
      if (!query.includes(' ')) {
        setMentionQuery(query);
        setShowMentions(true);
        setMentionIndex(0);
        return;
      }
    }
    setShowMentions(false);
  };

  const insertMention = useCallback((member: MentionSuggestion) => {
    const lastAt = message.lastIndexOf('@');
    const before = message.substring(0, lastAt);
    const newMsg = `${before}@${member.name} `;
    setMessage(newMsg);
    setShowMentions(false);
    setTaggedMembers(prev => [...prev.filter(m => m.id !== member.id), member]);
    inputRef.current?.focus();
  }, [message]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showMentions && mentionSuggestions.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIndex(i => Math.min(i + 1, mentionSuggestions.length - 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setMentionIndex(i => Math.max(i - 1, 0)); }
      else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insertMention(mentionSuggestions[mentionIndex]); }
      else if (e.key === 'Escape') { setShowMentions(false); }
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (message.trim()) sendMessageMutation.mutate(message.trim());
    }
  };

  const sendMessageMutation = useMutation({
    mutationFn: async (msg: string) => {
      const { error } = await supabase.from('case_updates').insert({
        case_id: id!,
        author_type: 'staff',
        author_name: teamMember?.name || 'Staff',
        message: msg,
      });
      if (error) throw error;

      // Auto-create warehouse action items for @mentioned warehouse members
      const warehouseTagged = taggedMembers.filter(m => m.role === 'warehouse');
      if (warehouseTagged.length > 0 && caseData) {
        const contextLines = [
          `📋 Case #${caseData.case_number}: ${caseData.title}`,
          caseData.customer_name ? `Customer: ${caseData.customer_name}` : null,
          caseData.order_number ? `Order: ${caseData.order_number}` : null,
          caseData.product_name ? `Product: ${caseData.product_name}` : null,
          `---`,
          msg,
        ].filter(Boolean).join('\n');

        await Promise.all(
          warehouseTagged.map(wm =>
            supabase.from('action_items').insert({
              case_id: id!,
              description: contextLines,
              assigned_to_name: wm.name,
              assigned_to_email: wm.email,
              created_by_name: teamMember?.name || 'Staff',
              is_warehouse_task: true,
              priority: caseData.priority || 'normal',
              status: 'todo',
            })
          )
        );
      }

      if (taggedMembers.length > 0 && caseData) {
        await supabase.functions.invoke('notify-mention', {
          body: {
            caseId: id, caseNumber: caseData.case_number, caseTitle: caseData.title,
            message: msg, authorName: teamMember?.name || 'Staff',
            taggedEmails: taggedMembers.map(m => m.email), taggedNames: taggedMembers.map(m => m.name),
          },
        });
      }
    },
    onSuccess: () => {
      const warehouseCount = taggedMembers.filter(m => m.role === 'warehouse').length;
      const tagged = taggedMembers.length;
      setMessage(''); setTaggedMembers([]);
      queryClient.invalidateQueries({ queryKey: ['case-updates', id] });
      queryClient.invalidateQueries({ queryKey: ['warehouse-tasks'] });
      const parts = [];
      if (tagged > 0) parts.push(`${tagged} notified`);
      if (warehouseCount > 0) parts.push(`${warehouseCount} warehouse task${warehouseCount > 1 ? 's' : ''} created`);
      toast.success(parts.length > 0 ? `Update posted · ${parts.join(' · ')}` : 'Update posted');
    },
    onError: () => toast.error('Failed to post update'),
  });

  // Post internal note
  const postNoteMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('case_updates').insert({
        case_id: id!,
        author_type: 'staff',
        author_name: teamMember?.name || 'Staff',
        message: `[Internal note] ${noteText}`,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setNoteText('');
      queryClient.invalidateQueries({ queryKey: ['case-updates', id] });
      toast.success('Note added');
    },
    onError: () => toast.error('Failed to add note'),
  });

  // Toggle action item status
  const toggleActionStatus = useMutation({
    mutationFn: async ({ itemId, currentStatus }: { itemId: string; currentStatus: ActionItemStatus }) => {
      const next: ActionItemStatus = currentStatus === 'todo' ? 'in_progress' : currentStatus === 'in_progress' ? 'done' : 'todo';
      const updates: Record<string, unknown> = { status: next };
      if (next === 'done') updates.completed_at = new Date().toISOString();
      else updates.completed_at = null;
      const { data, error } = await supabase.from('action_items').update(updates).eq('id', itemId).select();
      if (error) throw error;
      if (!data || data.length === 0) throw new Error('No rows updated — RLS may be blocking this action');
      return next;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['action-items', id] });
      queryClient.invalidateQueries({ queryKey: ['my-action-items-count'] });
    },
    onError: (err) => {
      console.error('Action item toggle failed:', err);
      toast.error('Failed to update action item');
    },
  });

  if (caseLoading) {
    return <div className="space-y-4">{[1, 2, 3].map(i => <div key={i} className="bg-card border border-border h-24 animate-pulse" />)}</div>;
  }
  if (!caseData) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <p>Case not found</p>
        <button onClick={() => navigate('/support')} className="mt-4 text-sm underline hover:text-foreground">Back to dashboard</button>
      </div>
    );
  }

  const borderColor = getLeftBorderColor(caseData);
  const openActions = actionItems.filter(a => a.status !== 'done');
  const doneActions = actionItems.filter(a => a.status === 'done');
  const internalNotes = updates.filter(u => u.message.startsWith('[Internal note]'));
  const activityUpdates = updates.filter(u => !u.message.startsWith('[Internal note]'));

  const getAuthorAvatar = (name: string) => {
    const member = teamMembers.find(m => m.name === name);
    return member?.avatar_colour || '#5A5A5A';
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim()) return;
    sendMessageMutation.mutate(message.trim());
  };

  const renderMessage = (msg: string) => {
    const cleaned = msg.replace(/^\[Internal note\]\s*/, '');
    const parts = cleaned.split(/(@\w[\w\s]*?\b)/g);
    return parts.map((part, i) => {
      if (part.startsWith('@')) {
        const name = part.substring(1);
        const member = teamMembers.find(m => m.name === name);
        if (member) return <span key={i} className="text-status-progress font-medium">{part}</span>;
      }
      return <span key={i}>{part}</span>;
    });
  };

  return (
    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.25 }}>
      <button onClick={() => navigate('/support')} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors">
        <ArrowLeft className="h-4 w-4" /> Back to dashboard
      </button>

      {/* Resolution panel */}
      {caseData.status === 'closed' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="bg-card border border-border p-4 mb-4" style={{ borderLeftWidth: '4px', borderLeftColor: 'hsl(122, 46%, 33%)' }}>
          <span className="inline-flex items-center px-2 py-0.5 text-[11px] font-medium border bg-status-resolved/15 text-status-resolved border-status-resolved/30 mb-2">Resolved</span>
          <p className="text-sm text-muted-foreground">Closed {formatDistanceToNow(new Date(caseData.updated_at), { addSuffix: true })}</p>
        </motion.div>
      )}

      {/* Escalation panel */}
      {showEscalation && (
        <EscalationPanel
          caseId={id!}
          caseNumber={caseData.case_number}
          caseTitle={caseData.title}
          onClose={() => setShowEscalation(false)}
        />
      )}

      {/* Delete confirmation panel */}
      <AnimatePresence>
        {showDeleteConfirm && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden mb-4"
          >
            <div className="bg-card border border-border p-4" style={{ borderLeftWidth: '4px', borderLeftColor: 'hsl(4, 63%, 46%)' }}>
              <p className="text-sm font-medium text-foreground mb-1">Permanently delete this case?</p>
              <p className="text-xs text-muted-foreground mb-3">This cannot be undone. All attachments, action items, notes and activity will be removed.</p>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="px-3 py-1.5 text-sm border border-border text-muted-foreground hover:text-foreground transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => deleteCaseMutation.mutate()}
                  disabled={deleteCaseMutation.isPending}
                  className="px-3 py-1.5 text-sm text-white font-medium flex items-center gap-2 transition-opacity"
                  style={{ backgroundColor: '#C0392B' }}
                >
                  {deleteCaseMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Yes, delete permanently
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Status header */}
      <div className="bg-card border border-border p-5 mb-4" style={{ borderLeftWidth: '4px', borderLeftColor: borderColor }}>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <CaseOriginBadge type={caseData.type} origin={caseData.error_origin} />
          <PriorityBadge priority={caseData.priority} />
          {caseData.is_escalated && (
            <span className="inline-flex items-center px-2 py-0.5 text-[11px] font-medium border bg-status-urgent/15 text-status-urgent border-status-urgent/30">Escalated</span>
          )}
          <span className="text-xs text-muted-foreground">#{caseData.case_number}</span>
        </div>
        <InlineEdit caseId={id!} field="title" value={caseData.title} className="text-lg font-heading mb-2" />
        <div className="flex items-center gap-4 mb-4 flex-wrap">
          <ResponseTimer createdAt={caseData.created_at} status={caseData.status} />

          {/* Kebab menu */}
          <div className="relative ml-auto">
            <button
              onClick={() => setKebabOpen(!kebabOpen)}
              className="p-1.5 text-muted-foreground hover:text-foreground transition-colors"
            >
              <MoreVertical className="h-4 w-4" />
            </button>
            <AnimatePresence>
              {kebabOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 4 }}
                  className="absolute top-full right-0 mt-1 w-44 bg-card border border-border shadow-lg z-50"
                >
                  <button
                    onClick={() => { setKebabOpen(false); setShowEscalation(true); }}
                    className="w-full text-left px-3 py-2 text-sm text-foreground hover:bg-surface-elevated transition-colors"
                  >
                    Escalate case
                  </button>
                  {isAdmin && (
                    <button
                      onClick={() => { setKebabOpen(false); setShowDeleteConfirm(true); }}
                      className="w-full text-left px-3 py-2 text-sm text-status-urgent hover:bg-surface-elevated transition-colors"
                    >
                      Delete case
                    </button>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
        <InteractiveProgressBar caseId={id!} currentStatus={caseData.status} caseNumber={caseData.case_number} caseTitle={caseData.title} />
      </div>

      {/* Description */}
      <div className="bg-card border border-border p-4 mb-4">
        <h3 className="text-xs font-heading tracking-wider text-muted-foreground mb-2">DESCRIPTION</h3>
        <InlineEdit caseId={id!} field="description" value={caseData.description} placeholder="Click to add a description..." multiline className="text-sm text-muted-foreground" />
      </div>

      {/* Order info */}
      <div className="bg-card border border-border p-4 mb-4">
        <h3 className="text-xs font-heading tracking-wider text-muted-foreground mb-3">ORDER DETAILS</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
          <div><span className="text-muted-foreground text-xs block mb-0.5">Order</span><span className="text-foreground">{caseData.order_number || '—'}</span></div>
          <div><span className="text-muted-foreground text-xs block mb-0.5">Customer</span><span className="text-foreground">{caseData.customer_name || '—'}</span></div>
          <div><span className="text-muted-foreground text-xs block mb-0.5">Product</span><span className="text-foreground">{caseData.product_name || '—'}</span></div>
          {caseData.purchase_date && (
            <div><span className="text-muted-foreground text-xs block mb-0.5">Order date</span><span className="text-foreground">{format(new Date(caseData.purchase_date), 'dd MMM yyyy')}</span></div>
          )}
          {caseData.customer_reference && (
            <div><span className="text-muted-foreground text-xs block mb-0.5">Customer ref</span><CustomerReferenceLink reference={caseData.customer_reference} className="text-foreground text-sm" /></div>
          )}
        </div>
      </div>

      {/* Cin7 live order details */}
      <OrderDetailsPanel
        cin7SaleId={caseData.cin7_sale_id}
        cin7OrderNumber={caseData.cin7_order_number}
        fallbackOrderNumber={caseData.order_number}
        fallbackPurchaseDate={caseData.purchase_date}
        fallbackCustomerReference={caseData.customer_reference}
      />

      {/* Shopify order panel */}
      <ShopifyOrderPanel customerReference={caseData.customer_reference} />


      {/* Replacement order — warehouse errors and warranty claims */}
      {(caseData.type === 'warranty_claim' || (caseData.type === 'order_error' && caseData.error_origin === 'warehouse')) && (
        <div className="bg-card border border-border p-4 mb-4">
          <h3 className="text-xs font-heading tracking-wider text-muted-foreground mb-3">REPLACEMENT ORDER</h3>
          <p className="text-sm text-muted-foreground mb-3">
            {caseData.type === 'warranty_claim'
              ? 'Arrange a replacement shipment for this warranty claim.'
              : 'This was a warehouse pick/pack error — fill out the pick slip below to arrange the correct items.'}
          </p>
          {caseData.cin7_sale_id ? (
            <ManualPickForm caseId={caseData.id} cin7SaleId={caseData.cin7_sale_id} caseNumber={caseData.case_number} />
          ) : (
            <ManualPickForm caseId={caseData.id} cin7SaleId="" caseNumber={caseData.case_number} />
          )}
          <ReplacementTrackingPanel
            trackingNumber={caseData.replacement_tracking_number}
            carrier={caseData.replacement_carrier}
            shipDate={caseData.replacement_ship_date}
            hasReplacementOrder={!!actionItems.some(a => a.is_replacement_pick)}
          />
        </div>
      )}

      <div className="bg-card border border-border p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-heading tracking-wider text-muted-foreground">
            ACTION ITEMS {openActions.length > 0 && <span className="text-foreground ml-1">({openActions.length} open)</span>}
          </h3>
          <button onClick={() => setDrawerOpen(true)} className="text-xs text-muted-foreground hover:text-foreground transition-colors">+ Add action</button>
        </div>
        <div className="space-y-2">
          {openActions.map(item => {
            const Icon = statusIcons[item.status];
            return (
              <div key={item.id} className="flex items-start gap-3 p-3 border border-border" style={{ borderLeftWidth: '3px', borderLeftColor: item.priority === 'urgent' ? 'hsl(4,63%,46%)' : 'hsl(0,0%,35%)' }}>
                <button onClick={() => toggleActionStatus.mutate({ itemId: item.id, currentStatus: item.status })} className="mt-0.5">
                  <Icon className={cn('h-4 w-4 shrink-0', item.status === 'in_progress' ? 'text-status-progress animate-spin' : 'text-muted-foreground hover:text-foreground')} />
                </button>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground">{item.description}</p>
                  <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <span className="h-4 w-4 flex items-center justify-center text-[10px] font-medium" style={{ backgroundColor: getAuthorAvatar(item.assigned_to_name), borderRadius: '2px' }}>
                        {item.assigned_to_name.split(' ').map(n => n[0]).join('')}
                      </span>
                      {item.assigned_to_name}
                    </span>
                    {item.due_date && <span>Due {format(new Date(item.due_date), 'dd MMM')}</span>}
                  </div>
                </div>
              </div>
            );
          })}
          {doneActions.length > 0 && (
            <details className="text-sm">
              <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground py-1">{doneActions.length} completed</summary>
              <div className="mt-2 space-y-2 opacity-60">
                {doneActions.map(item => (
                  <div key={item.id} className="flex items-center gap-3 p-2 text-sm">
                    <CheckCircle2 className="h-4 w-4 text-status-resolved shrink-0" />
                    <span className="line-through">{item.description}</span>
                  </div>
                ))}
              </div>
            </details>
          )}
          {openActions.length === 0 && doneActions.length === 0 && <p className="text-xs text-muted-foreground">No action items yet — add one to assign follow-up tasks to your team.</p>}
        </div>
      </div>

      {/* Internal Notes / Activity tabs */}
      <div className="bg-card border border-border mb-4">
        <div className="flex border-b border-border">
          <button
            onClick={() => setActiveTab('activity')}
            className={cn('px-4 py-2.5 text-sm border-b-2 -mb-px transition-colors', activeTab === 'activity' ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}
          >
            Activity
          </button>
          <button
            onClick={() => setActiveTab('notes')}
            className={cn('px-4 py-2.5 text-sm border-b-2 -mb-px transition-colors', activeTab === 'notes' ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}
          >
            Internal notes {internalNotes.length > 0 && `(${internalNotes.length})`}
          </button>
        </div>

        <div className="p-4">
          {activeTab === 'activity' ? (
            <div className="space-y-4">
              {activityUpdates.map(update => (
                <div key={update.id} className="flex gap-3">
                  <div className="h-6 w-6 shrink-0 flex items-center justify-center text-[10px] font-medium mt-0.5" style={{ backgroundColor: update.author_type === 'system' ? '#5A5A5A' : getAuthorAvatar(update.author_name), borderRadius: '2px' }}>
                    {update.author_type === 'system' ? 'S' : update.author_name.split(' ').map(n => n[0]).join('')}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-foreground font-medium">{update.author_name}</span>
                      <span className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(update.created_at), { addSuffix: true })}</span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5">{renderMessage(update.message)}</p>
                  </div>
                </div>
              ))}
              {activityUpdates.length === 0 && <p className="text-xs text-muted-foreground">No activity yet</p>}
            </div>
          ) : (
            <div>
              <div className="bg-status-warning/10 border border-status-warning/30 px-3 py-2 mb-4 text-xs text-status-warning">
                Only visible to your team — never shared externally
              </div>
              <div className="space-y-4 mb-4">
                {internalNotes.map(note => (
                  <div key={note.id} className="flex gap-3">
                    <div className="h-6 w-6 shrink-0 flex items-center justify-center text-[10px] font-medium mt-0.5" style={{ backgroundColor: getAuthorAvatar(note.author_name), borderRadius: '2px' }}>
                      {note.author_name.split(' ').map(n => n[0]).join('')}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-foreground font-medium">{note.author_name}</span>
                        <span className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(note.created_at), { addSuffix: true })}</span>
                      </div>
                      <p className="text-sm text-muted-foreground mt-0.5">{renderMessage(note.message)}</p>
                    </div>
                  </div>
                ))}
                {internalNotes.length === 0 && <p className="text-xs text-muted-foreground mb-4">No internal notes yet</p>}
              </div>
              <div className="flex gap-2">
                <textarea
                  value={noteText}
                  onChange={e => setNoteText(e.target.value)}
                  rows={2}
                  placeholder="Add an internal note..."
                  className="flex-1 bg-background border border-input text-sm px-3 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-foreground transition-colors resize-none"
                />
                <button
                  onClick={() => postNoteMutation.mutate()}
                  disabled={!noteText.trim() || postNoteMutation.isPending}
                  className={cn('bg-primary text-primary-foreground px-4 py-2 text-sm font-medium self-end transition-opacity', (!noteText.trim() || postNoteMutation.isPending) && 'opacity-40 cursor-not-allowed')}
                >
                  Post
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Reply box with @mention */}
      <form onSubmit={handleSendMessage} className="bg-card border border-border p-4">
        {taggedMembers.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {taggedMembers.map(m => (
              <span key={m.id} className="inline-flex items-center gap-1 bg-status-progress/15 text-status-progress text-xs px-2 py-0.5 border border-status-progress/30">
                @{m.name}
                <button type="button" onClick={() => setTaggedMembers(prev => prev.filter(t => t.id !== m.id))} className="hover:text-foreground ml-0.5">×</button>
              </span>
            ))}
            <span className="text-[10px] text-muted-foreground self-center ml-1">will be notified</span>
          </div>
        )}
        <div className="flex gap-3 relative">
          <div className="h-6 w-6 shrink-0 flex items-center justify-center text-[10px] font-medium" style={{ backgroundColor: teamMember?.avatar_colour || '#5A5A5A', borderRadius: '2px' }}>
            {teamMember?.name?.split(' ').map(n => n[0]).join('') || '?'}
          </div>
          <div className="flex-1 flex gap-2 relative">
            <div className="flex-1 relative">
              <input
                ref={inputRef}
                type="text"
                value={message}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder="Add an update... (type @ to tag someone)"
                className="w-full bg-background border border-input text-sm px-3 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-foreground transition-colors"
              />
              <AnimatePresence>
                {showMentions && mentionSuggestions.length > 0 && (
                  <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }} className="absolute bottom-full left-0 mb-1 w-64 bg-card border border-border shadow-lg z-50 max-h-48 overflow-y-auto">
                    {mentionSuggestions.map((m, i) => (
                      <button key={m.id} type="button" onClick={() => insertMention(m)} className={cn('w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left transition-colors', i === mentionIndex ? 'bg-surface-elevated text-foreground' : 'text-muted-foreground hover:bg-surface-elevated')}>
                        <div className="h-5 w-5 flex items-center justify-center text-[9px] font-medium shrink-0" style={{ backgroundColor: m.avatar_colour, borderRadius: '2px' }}>{m.name.split(' ').map(n => n[0]).join('')}</div>
                        <span>{m.name}</span>
                        {m.role === 'warehouse' && <span className="ml-auto text-[10px] text-status-progress border border-status-progress px-1">warehouse</span>}
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <button type="submit" disabled={sendMessageMutation.isPending} className="bg-primary text-primary-foreground px-3 py-2 hover:opacity-90 transition-opacity">
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      </form>

      {/* Action item drawer */}
      <AddActionItemDrawer
        caseId={id!}
        caseNumber={caseData.case_number}
        caseTitle={caseData.title}
        customerName={caseData.customer_name}
        orderNumber={caseData.order_number}
        productName={caseData.product_name}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      />
    </motion.div>
  );
}
