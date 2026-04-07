import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Loader2 } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { CaseStatus, STATUS_LABELS } from '@/lib/types';
import { cn } from '@/lib/utils';


const ALL_STATUSES: CaseStatus[] = ['open', 'actioned', 'in_hand', 'closed'];

interface Props {
  caseId: string;
  currentStatus: CaseStatus;
  caseNumber?: string;
  caseTitle?: string;
}

export function CaseStatusDropdown({ caseId, currentStatus, caseNumber, caseTitle }: Props) {
  const { teamMember } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState<CaseStatus | null>(null);
  const [note, setNote] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      if (!selectedStatus) return;
      const updates: Record<string, unknown> = { status: selectedStatus };

      const { error } = await supabase.from('cases').update(updates).eq('id', caseId);
      if (error) throw error;

      // Log activity
      const msg = `Status changed from ${STATUS_LABELS[currentStatus]} → ${STATUS_LABELS[selectedStatus]}${note ? ` · ${note}` : ''}`;
      await supabase.from('case_updates').insert({
        case_id: caseId,
        author_type: 'system',
        author_name: teamMember?.name || 'System',
        message: msg,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['case', caseId] });
      queryClient.invalidateQueries({ queryKey: ['case-updates', caseId] });
      queryClient.invalidateQueries({ queryKey: ['cases'] });


      toast.success(`Status updated to ${STATUS_LABELS[selectedStatus!]}`);
      setOpen(false);
      setSelectedStatus(null);
      setNote('');
    },
    onError: () => toast.error('Failed to update status'),
  });

  const handleSelect = (status: CaseStatus) => {
    if (status === currentStatus) return;
    setSelectedStatus(status);
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 border border-border px-3 py-1.5 text-sm text-foreground hover:border-[hsl(0,0%,25%)] transition-colors"
      >
        Update status <ChevronDown className="h-3.5 w-3.5" />
      </button>

      <AnimatePresence>
        {open && !selectedStatus && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            className="absolute top-full left-0 mt-1 w-56 bg-card border border-border shadow-lg z-50"
          >
            {ALL_STATUSES.map(s => (
              <button
                key={s}
                onClick={() => handleSelect(s)}
                disabled={s === currentStatus}
                className={cn(
                  'w-full text-left px-3 py-2 text-sm transition-colors',
                  s === currentStatus ? 'text-muted-foreground opacity-50' : 'text-foreground hover:bg-surface-elevated'
                )}
              >
                {STATUS_LABELS[s]}
              </button>
            ))}
          </motion.div>
        )}

        {selectedStatus && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            className="absolute top-full left-0 mt-1 w-72 bg-card border border-border shadow-lg z-50 p-4"
          >
            <p className="text-sm text-foreground mb-3">
              Change status to <span className="font-medium">{STATUS_LABELS[selectedStatus]}</span>?
            </p>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              maxLength={selectedStatus === 'closed' ? 300 : undefined}
              rows={3}
              placeholder={selectedStatus === 'closed' ? 'How was this resolved? (required)' : 'Add a note (optional)'}
              className="w-full bg-background border border-input text-sm px-3 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-foreground transition-colors resize-none mb-3"
            />
            {selectedStatus === 'closed' && (
              <p className="text-[11px] text-muted-foreground mb-3">{note.length}/300</p>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => { setSelectedStatus(null); setNote(''); setOpen(false); }}
                className="px-3 py-1.5 text-sm border border-border text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => mutation.mutate()}
                disabled={mutation.isPending || (selectedStatus === 'closed' && !note.trim())}
                className={cn(
                  'px-3 py-1.5 text-sm bg-primary text-primary-foreground flex items-center gap-2 transition-opacity',
                  (mutation.isPending || (selectedStatus === 'closed' && !note.trim())) && 'opacity-40 cursor-not-allowed'
                )}
              >
                {mutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Confirm
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
