import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { notifyEscalation } from '@/lib/notifyGoogleChat';

interface Props {
  caseId: string;
  caseNumber: string;
  caseTitle: string;
  onClose: () => void;
}

export function EscalationPanel({ caseId, caseNumber, caseTitle, onClose }: Props) {
  const { teamMember } = useAuth();
  const queryClient = useQueryClient();
  const [assigneeId, setAssigneeId] = useState('');
  const [note, setNote] = useState('');

  const { data: admins = [] } = useQuery({
    queryKey: ['admin-members'],
    queryFn: async () => {
      const { data, error } = await supabase.from('team_members').select('*').eq('role', 'admin').eq('status', 'active').order('name');
      if (error) throw error;
      return data;
    },
  });

  const selectedAdmin = admins.find(a => a.id === assigneeId);

  const escalateMutation = useMutation({
    mutationFn: async () => {
      if (!assigneeId || !note.trim()) throw new Error('Select an admin and provide a reason');

      await supabase.from('cases').update({
        is_escalated: true,
        escalated_to_id: assigneeId,
        escalated_at: new Date().toISOString(),
        escalation_note: note,
        priority: 'urgent',
      } as any).eq('id', caseId);

      const admin = admins.find(a => a.id === assigneeId);

      await supabase.from('case_updates').insert({
        case_id: caseId,
        author_type: 'system',
        author_name: teamMember?.name || 'System',
        message: `Case escalated to ${admin?.name || 'Admin'} by ${teamMember?.name || 'Staff'} — ${note}`,
      });

      // Google Chat
      notifyEscalation({
        caseId,
        caseNumber,
        caseTitle,
        adminName: admin?.name || 'Admin',
        reason: note,
      });

      // Email via notify-mention
      if (admin) {
        await supabase.functions.invoke('notify-mention', {
          body: {
            caseNumber,
            caseTitle,
            message: `ESCALATED: ${note}`,
            authorName: teamMember?.name || 'Staff',
            taggedEmails: [admin.email],
            taggedNames: [admin.name],
          },
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['case', caseId] });
      queryClient.invalidateQueries({ queryKey: ['case-updates', caseId] });
      queryClient.invalidateQueries({ queryKey: ['cases'] });
      toast.success(`Case escalated to ${selectedAdmin?.name}`);
      onClose();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div className="bg-card border border-border p-4 mb-4" style={{ borderLeftWidth: '4px', borderLeftColor: '#C0392B' }}>
      <h3 className="text-sm font-heading mb-3">Escalate this case?</h3>

      <div className="mb-3">
        <label className="text-xs text-muted-foreground block mb-1.5">Escalate to</label>
        <div className="space-y-1 max-h-32 overflow-y-auto border border-border">
          {admins.map(a => (
            <button
              key={a.id}
              type="button"
              onClick={() => setAssigneeId(a.id)}
              className={cn(
                'w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left transition-colors',
                a.id === assigneeId ? 'bg-surface-elevated text-foreground' : 'text-muted-foreground hover:bg-surface-elevated'
              )}
            >
              <div className="h-5 w-5 flex items-center justify-center text-[9px] font-medium shrink-0" style={{ backgroundColor: a.avatar_colour, borderRadius: '2px' }}>
                {a.name.split(' ').map((n: string) => n[0]).join('')}
              </div>
              <span>{a.name}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="mb-3">
        <label className="text-xs text-muted-foreground block mb-1.5">Why does this need escalation?</label>
        <textarea
          value={note}
          onChange={e => setNote(e.target.value.slice(0, 300))}
          rows={3}
          placeholder="Required — max 300 characters"
          className="w-full bg-background border border-input text-sm px-3 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-foreground transition-colors resize-none"
        />
        <p className="text-[11px] text-muted-foreground mt-1">{note.length}/300</p>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => escalateMutation.mutate()}
          disabled={!assigneeId || !note.trim() || escalateMutation.isPending}
          className={cn(
            'px-4 py-2 text-sm font-medium text-foreground flex items-center gap-2 transition-opacity',
            (!assigneeId || !note.trim() || escalateMutation.isPending) ? 'opacity-40 cursor-not-allowed' : 'hover:opacity-90'
          )}
          style={{ backgroundColor: '#C0392B' }}
        >
          {escalateMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          Escalate
        </button>
        <button onClick={onClose} className="px-4 py-2 text-sm border border-border text-muted-foreground hover:text-foreground transition-colors">
          Cancel
        </button>
      </div>
    </div>
  );
}
