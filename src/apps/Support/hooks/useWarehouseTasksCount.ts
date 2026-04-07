import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export function useWarehouseTasksCount() {
  const [count, setCount] = useState(0);

  const { data } = useQuery({
    queryKey: ['warehouse-tasks-count'],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('action_items')
        .select('*', { count: 'exact', head: true })
        .eq('is_warehouse_task', true)
        .neq('status', 'done');
      if (error) throw error;
      return count || 0;
    },
  });

  useEffect(() => {
    if (data !== undefined) setCount(data);
  }, [data]);

  useEffect(() => {
    const channel = supabase
      .channel('warehouse-badge')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'action_items' }, () => {
        supabase
          .from('action_items')
          .select('*', { count: 'exact', head: true })
          .eq('is_warehouse_task', true)
          .neq('status', 'done')
          .then(({ count: c }) => { if (c !== null) setCount(c); });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  return count;
}
