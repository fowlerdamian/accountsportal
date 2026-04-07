import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { formatDistanceToNow } from 'date-fns';
import { AlertTriangle } from 'lucide-react';

interface Props {
  orderNumber: string;
  onContinue: () => void;
}

export function DuplicateCaseWarning({ orderNumber, onContinue }: Props) {
  const { data: duplicates = [], isLoading } = useQuery({
    queryKey: ['duplicate-check', orderNumber],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cases')
        .select('id, case_number, title, status, created_at, user_id')
        .eq('cin7_order_number', orderNumber)
        .neq('status', 'closed');
      if (error) throw error;

      // Get creator names
      if (data && data.length > 0) {
        const userIds = [...new Set(data.map(c => c.user_id))];
        const { data: members } = await supabase
          .from('team_members')
          .select('id, name')
          .in('id', userIds);
        const nameMap = new Map((members || []).map(m => [m.id, m.name]));
        return data.map(c => ({ ...c, creator_name: nameMap.get(c.user_id) || 'Unknown' }));
      }
      return [];
    },
    enabled: !!orderNumber,
  });

  if (isLoading || duplicates.length === 0) return null;

  const statusLabels: Record<string, string> = {
    open: 'New', actioned: 'Actioned', in_hand: 'In hand',
    reviewing: 'Reviewing', awaiting_customer: 'Awaiting customer',
    resolution_sent: 'Resolution sent',
  };

  return (
    <div className="border border-status-warning/40 bg-status-warning/10 p-4 mt-3 mb-1">
      <div className="flex items-start gap-2 mb-2">
        <AlertTriangle className="h-4 w-4 text-status-warning shrink-0 mt-0.5" />
        <p className="text-sm text-status-warning font-medium">
          Open case{duplicates.length > 1 ? 's' : ''} already exist{duplicates.length === 1 ? 's' : ''} for this order
        </p>
      </div>
      <div className="space-y-2 ml-6">
        {duplicates.map(c => (
          <div key={c.id} className="text-sm">
            <p className="text-foreground">
              <span className="font-medium">{c.case_number}</span> — {c.title}
            </p>
            <p className="text-xs text-muted-foreground">
              Status: {statusLabels[c.status] || c.status} · Created {formatDistanceToNow(new Date(c.created_at), { addSuffix: true })} by {c.creator_name}
            </p>
            <a
              href={`/cases/${c.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-status-progress hover:underline"
            >
              View existing case
            </a>
          </div>
        ))}
      </div>
      <button
        onClick={onContinue}
        className="mt-3 ml-6 text-xs text-muted-foreground hover:text-foreground underline transition-colors"
      >
        Continue anyway
      </button>
    </div>
  );
}
