import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, CalendarIcon, Loader2 } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { format, addBusinessDays } from 'date-fns';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { notifyActionItemAssigned } from '@/lib/notifyGoogleChat';

interface Props {
  caseId: string;
  caseNumber: string;
  caseTitle: string;
  customerName?: string | null;
  orderNumber?: string | null;
  productName?: string | null;
  open: boolean;
  onClose: () => void;
}

export function AddActionItemDrawer({ caseId, caseNumber, caseTitle, customerName, orderNumber, productName, open, onClose }: Props) {
  const { teamMember } = useAuth();
  const queryClient = useQueryClient();
  const [description, setDescription] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [dueDate, setDueDate] = useState<Date | undefined>(() => addBusinessDays(new Date(), 1));
  const [priority, setPriority] = useState<'normal' | 'urgent'>('normal');
  const [notify, setNotify] = useState(true);
  const [assigneeSearch, setAssigneeSearch] = useState('');

  const { data: teamMembers = [] } = useQuery({
    queryKey: ['team-members-active'],
    queryFn: async () => {
      const { data, error } = await supabase.from('team_members').select('*').eq('status', 'active').order('name');
      if (error) throw error;
      return data;
    },
    enabled: open,
  });

  // Pin current user at top
  const sortedMembers = [...teamMembers].sort((a, b) => {
    if (a.id === teamMember?.id) return -1;
    if (b.id === teamMember?.id) return 1;
    return a.name.localeCompare(b.name);
  });

  const filteredMembers = sortedMembers.filter(m =>
    m.name.toLowerCase().includes(assigneeSearch.toLowerCase())
  );

  const selectedMember = teamMembers.find(m => m.id === assigneeId);

  useEffect(() => {
    if (open) {
      setDescription('');
      setAssigneeId('');
      setDueDate(addBusinessDays(new Date(), 1));
      setPriority('normal');
      setNotify(true);
      setAssigneeSearch('');
    }
  }, [open]);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) onClose();
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [open, onClose]);

  const mutation = useMutation({
    mutationFn: async () => {
      const member = teamMembers.find(m => m.id === assigneeId);
      if (!member) throw new Error('Select an assignee');

      const isWarehouseAssignee = (member.role as string) === 'warehouse';
      const hasWarehouseTag = description.toLowerCase().includes('@warehouse');
      const isWarehouseTask = isWarehouseAssignee || hasWarehouseTag;

      // For warehouse tasks, prepend case context so they have full info
      let finalDescription = description;
      if (isWarehouseTask) {
        const contextLines = [
          `📋 Case #${caseNumber}: ${caseTitle}`,
          customerName ? `Customer: ${customerName}` : null,
          orderNumber ? `Order: ${orderNumber}` : null,
          productName ? `Product: ${productName}` : null,
          `---`,
          description,
        ].filter(Boolean).join('\n');
        finalDescription = contextLines;
      }

      const { error } = await supabase.from('action_items').insert({
        case_id: caseId,
        description: finalDescription,
        assigned_to_name: member.name,
        assigned_to_email: member.email,
        due_date: dueDate ? format(dueDate, 'yyyy-MM-dd') : null,
        priority,
        created_by_name: teamMember?.name || 'Staff',
        is_warehouse_task: isWarehouseTask,
      } as any);
      if (error) throw error;

      // Log activity
      await supabase.from('case_updates').insert({
        case_id: caseId,
        author_type: 'system',
        author_name: teamMember?.name || 'System',
        message: `Action item created: "${description}" — assigned to ${member.name}`,
      });

      // Send email notification
      if (notify) {
        await supabase.functions.invoke('notify-mention', {
          body: {
            caseNumber,
            caseTitle,
            message: `New action item assigned to you: "${description}"${dueDate ? ` — Due ${format(dueDate, 'dd MMM yyyy')}` : ''}${priority === 'urgent' ? ' (URGENT)' : ''}`,
            authorName: teamMember?.name || 'Staff',
            taggedEmails: [member.email],
            taggedNames: [member.name],
          },
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['action-items', caseId] });
      queryClient.invalidateQueries({ queryKey: ['case-updates', caseId] });
      queryClient.invalidateQueries({ queryKey: ['my-action-items-count'] });

      // Google Chat — action item assigned
      const member = teamMembers.find(m => m.id === assigneeId);
      if (member) {
        notifyActionItemAssigned({
          caseId,
          caseNumber,
          caseTitle,
          assigneeName: member.name,
          taskDescription: description,
        });
      }

      toast.success(notify && selectedMember ? `Action item created · Email sent to ${selectedMember.name}` : 'Action item created');
      onClose();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 z-40"
          />
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
            className="fixed right-0 top-0 bottom-0 w-full max-w-md bg-card border-l border-border z-50 flex flex-col"
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h3 className="text-sm font-heading tracking-wider">ADD ACTION ITEM</h3>
              <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
              {/* Description */}
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">Task description</label>
                <textarea
                  value={description}
                  onChange={e => setDescription(e.target.value.slice(0, 200))}
                  rows={3}
                  placeholder="What needs to be done?"
                  className="w-full bg-background border border-input text-sm px-3 py-2.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-foreground transition-colors resize-none"
                />
                <p className="text-[11px] text-muted-foreground mt-1">{description.length}/200</p>
              </div>

              {/* Assignee */}
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">Assign to</label>
                <input
                  type="text"
                  value={assigneeSearch}
                  onChange={e => setAssigneeSearch(e.target.value)}
                  placeholder="Search team members..."
                  className="w-full bg-background border border-input text-sm px-3 py-2.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-foreground transition-colors mb-2"
                />
                <div className="max-h-36 overflow-y-auto border border-border">
                  {filteredMembers.map(m => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => { setAssigneeId(m.id); setAssigneeSearch(''); }}
                      className={cn(
                        'w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left transition-colors',
                        m.id === assigneeId ? 'bg-surface-elevated text-foreground' : 'text-muted-foreground hover:bg-surface-elevated'
                      )}
                    >
                      <div
                        className="h-5 w-5 flex items-center justify-center text-[9px] font-medium shrink-0"
                        style={{ backgroundColor: m.avatar_colour, borderRadius: '2px' }}
                      >
                        {m.name.split(' ').map(n => n[0]).join('')}
                      </div>
                      <span>{m.id === teamMember?.id ? `${m.name} (Me)` : m.name}</span>
                    </button>
                  ))}
                </div>
                {selectedMember && (
                  <>
                    <p className="text-xs text-muted-foreground mt-1.5">
                      Selected: <span className="text-foreground">{selectedMember.name}</span>
                    </p>
                    {(selectedMember as any).role === 'warehouse' && (
                      <p className="text-xs text-status-progress mt-1 border border-status-progress/30 bg-status-progress/10 px-2 py-1">
                        This will appear on the Warehouse Dashboard
                      </p>
                    )}
                  </>
                )}
              </div>

              {/* Due date */}
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">Due date</label>
                <Popover>
                  <PopoverTrigger asChild>
                    <button className={cn(
                      'w-full flex items-center gap-2 bg-background border border-input text-sm px-3 py-2.5 text-left transition-colors',
                      !dueDate && 'text-muted-foreground'
                    )}>
                      <CalendarIcon className="h-4 w-4 text-muted-foreground" />
                      {dueDate ? format(dueDate, 'dd MMM yyyy') : 'Pick a date'}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={dueDate}
                      onSelect={setDueDate}
                      disabled={(date) => date < new Date()}
                      initialFocus
                      className="p-3 pointer-events-auto"
                    />
                  </PopoverContent>
                </Popover>
              </div>

              {/* Priority */}
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">Priority</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setPriority('normal')}
                    className={cn(
                      'flex-1 py-2 text-sm border transition-colors',
                      priority === 'normal' ? 'border-foreground text-foreground bg-surface-elevated' : 'border-border text-muted-foreground hover:border-[hsl(0,0%,25%)]'
                    )}
                  >
                    Normal
                  </button>
                  <button
                    type="button"
                    onClick={() => setPriority('urgent')}
                    className={cn(
                      'flex-1 py-2 text-sm border transition-colors',
                      priority === 'urgent' ? 'border-status-urgent text-status-urgent bg-status-urgent/10' : 'border-border text-muted-foreground hover:border-[hsl(0,0%,25%)]'
                    )}
                  >
                    Urgent
                  </button>
                </div>
              </div>

              {/* Notify toggle */}
              <div className="flex items-center justify-between">
                <label className="text-xs text-muted-foreground">
                  Notify {selectedMember?.name || 'assignee'} by email
                </label>
                <button
                  type="button"
                  onClick={() => setNotify(!notify)}
                  className={cn(
                    'relative w-9 h-5 rounded-full transition-colors',
                    notify ? 'bg-status-progress' : 'bg-muted'
                  )}
                >
                  <span className={cn(
                    'absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-foreground transition-transform',
                    notify && 'translate-x-4'
                  )} />
                </button>
              </div>
            </div>

            <div className="px-5 py-4 border-t border-border">
              <button
                onClick={() => mutation.mutate()}
                disabled={!description.trim() || !assigneeId || mutation.isPending}
                className={cn(
                  'w-full bg-primary text-primary-foreground py-2.5 text-sm font-medium flex items-center justify-center gap-2 transition-opacity',
                  (!description.trim() || !assigneeId || mutation.isPending) && 'opacity-40 cursor-not-allowed'
                )}
              >
                {mutation.isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Creating...</> : 'Create action item'}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
