import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, ChevronRight } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { CaseStatus, STATUS_LABELS } from '@/lib/types';
import { cn } from '@/lib/utils';


const ALL_STAGES: CaseStatus[] = ['open', 'actioned', 'in_hand', 'closed'];

const STAGE_COLORS: Record<CaseStatus, string> = {
  open: '#5A5A5A',
  actioned: '#1A6FA8',
  in_hand: '#6B3FA0',
  closed: '#2E7D32',
};

const MOBILE_LABELS: Record<CaseStatus, string> = {
  open: 'NEW',
  actioned: 'ACT',
  in_hand: 'HAND',
  closed: 'CLOSED',
};

interface Props {
  caseId: string;
  currentStatus: CaseStatus;
  caseNumber?: string;
  caseTitle?: string;
}

export function InteractiveProgressBar({ caseId, currentStatus, caseNumber, caseTitle }: Props) {
  const { teamMember } = useAuth();
  const queryClient = useQueryClient();
  const [selectedStatus, setSelectedStatus] = useState<CaseStatus | null>(null);
  const [note, setNote] = useState('');

  const currentIndex = ALL_STAGES.indexOf(currentStatus);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!selectedStatus) return;
      const { error } = await supabase.from('cases').update({ status: selectedStatus }).eq('id', caseId);
      if (error) throw error;

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
      setSelectedStatus(null);
      setNote('');
    },
    onError: () => toast.error('Failed to update status'),
  });

  const handleTileClick = (status: CaseStatus) => {
    if (status === currentStatus) return;
    setSelectedStatus(status);
    setNote('');
  };

  return (
    <div>
      {/* Tile row */}
      <div className="flex w-full" style={{ borderRadius: '2px', overflow: 'hidden' }}>
        {ALL_STAGES.map((stage, i) => {
          const isCurrent = stage === currentStatus;
          const isCompleted = i < currentIndex;
          const isFuture = i > currentIndex;
          const isSelected = selectedStatus === stage;
          const color = STAGE_COLORS[stage];

          const r = parseInt(color.slice(1, 3), 16);
          const g = parseInt(color.slice(3, 5), 16);
          const b = parseInt(color.slice(5, 7), 16);

          let bgColor: string;
          let textColor: string;
          let numColor: string;

          if (isCurrent) {
            bgColor = color;
            textColor = '#FFFFFF';
            numColor = 'rgba(255,255,255,0.5)';
          } else if (isCompleted) {
            bgColor = `rgba(${r},${g},${b},0.25)`;
            textColor = '#FFFFFF';
            numColor = 'rgba(255,255,255,0.35)';
          } else {
            bgColor = '#161616';
            textColor = 'rgba(255,255,255,0.5)';
            numColor = 'rgba(255,255,255,0.2)';
          }

          const tooltipText = isCurrent
            ? ''
            : isFuture
              ? `Move to ${STATUS_LABELS[stage]}`
              : `Move back to ${STATUS_LABELS[stage]}`;

          return (
            <button
              key={stage}
              onClick={() => handleTileClick(stage)}
              title={tooltipText}
              className={cn(
                'flex-1 relative transition-all duration-200',
                !isCurrent && 'cursor-pointer',
                isCurrent && 'cursor-default',
              )}
              style={{
                backgroundColor: bgColor,
                borderTop: isCurrent ? '2px solid rgba(255,255,255,0.8)' : '2px solid transparent',
                borderBottom: isSelected ? `2px solid ${color}` : '2px solid transparent',
              }}
            >
              {/* Inner content with padding */}
              <div className="flex flex-col items-center justify-center py-3 px-1 md:px-3 min-h-[52px]">
                {/* Step number */}
                <span
                  className="text-[9px] font-medium mb-0.5 tabular-nums"
                  style={{ color: numColor }}
                >
                  {i + 1}
                </span>

                {/* Stage name */}
                <span
                  className={cn(
                    'text-[12px] md:text-sm font-heading font-bold uppercase tracking-[0.08em] leading-tight text-center',
                    isCurrent && 'text-[13px] md:text-[15px]',
                  )}
                  style={{ color: textColor }}
                >
                  <span className={cn(isCurrent ? 'inline' : 'hidden md:inline')}>
                    {STATUS_LABELS[stage].toUpperCase()}
                  </span>
                  {!isCurrent && (
                    <span className="inline md:hidden">
                      {MOBILE_LABELS[stage]}
                    </span>
                  )}
                </span>
              </div>

              {/* Hover overlay for non-current */}
              {!isCurrent && (
                <div
                  className="absolute inset-0 opacity-0 hover:opacity-100 transition-opacity duration-150 pointer-events-none"
                  style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Confirmation panel */}
      <AnimatePresence>
        {selectedStatus && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="border border-border p-4 mt-0" style={{ backgroundColor: '#111111', borderTop: `2px solid ${STAGE_COLORS[selectedStatus]}` }}>
              <div className="flex items-center gap-2 mb-3">
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                <p className="text-sm text-foreground">
                  Change status to <span className="font-heading font-bold uppercase tracking-wide" style={{ color: STAGE_COLORS[selectedStatus] }}>{STATUS_LABELS[selectedStatus]}</span>?
                </p>
              </div>
              <textarea
                value={note}
                onChange={e => setNote(e.target.value)}
                maxLength={selectedStatus === 'closed' ? 300 : undefined}
                rows={2}
                placeholder={selectedStatus === 'closed' ? 'How was this resolved? (required)' : 'Add a note (optional)'}
                className="w-full bg-background border border-input text-sm px-3 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-foreground transition-colors resize-none mb-3"
              />
              {selectedStatus === 'closed' && (
                <p className="text-[11px] text-muted-foreground mb-2">{note.length}/300</p>
              )}
              <div className="flex gap-2">
                <button
                  onClick={() => { setSelectedStatus(null); setNote(''); }}
                  className="px-3 py-1.5 text-sm border border-border text-muted-foreground hover:text-foreground transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => mutation.mutate()}
                  disabled={mutation.isPending || (selectedStatus === 'closed' && !note.trim())}
                  className={cn(
                    'px-4 py-1.5 text-sm font-medium flex items-center gap-2 transition-all',
                    (mutation.isPending || (selectedStatus === 'closed' && !note.trim())) && 'opacity-40 cursor-not-allowed'
                  )}
                  style={{
                    backgroundColor: STAGE_COLORS[selectedStatus],
                    color: '#FFFFFF',
                  }}
                >
                  {mutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  Confirm
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
