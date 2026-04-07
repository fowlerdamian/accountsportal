import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export function useActionItemsCount() {
  const { teamMember } = useAuth();
  const [count, setCount] = useState(0);

  const { data } = useQuery({
    queryKey: ['my-action-items-count'],
    queryFn: async () => {
      if (!teamMember) return 0;
      const { count, error } = await supabase
        .from('action_items')
        .select('*', { count: 'exact', head: true })
        .eq('assigned_to_email', teamMember.email)
        .neq('status', 'done');
      if (error) throw error;
      return count || 0;
    },
    enabled: !!teamMember,
  });

  useEffect(() => {
    if (data !== undefined) setCount(data);
  }, [data]);

  // Realtime subscription
  useEffect(() => {
    if (!teamMember) return;
    const channel = supabase
      .channel('action-items-badge')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'action_items' },
        () => {
          // Refetch count on any change
          supabase
            .from('action_items')
            .select('*', { count: 'exact', head: true })
            .eq('assigned_to_email', teamMember.email)
            .neq('status', 'done')
            .then(({ count: c }) => { if (c !== null) setCount(c); });
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [teamMember]);

  return count;
}
