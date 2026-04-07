import { useState, useRef, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface Props {
  caseId: string;
  field: 'title' | 'description';
  value: string | null;
  className?: string;
  placeholder?: string;
  multiline?: boolean;
}

export function InlineEdit({ caseId, field, value, className, placeholder, multiline }: Props) {
  const { teamMember } = useAuth();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value || '');
  const ref = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing) ref.current?.focus();
  }, [editing]);

  const mutation = useMutation({
    mutationFn: async () => {
      const trimmed = text.trim();
      if (trimmed === (value || '')) return;
      const { error } = await supabase.from('cases').update({ [field]: trimmed || null }).eq('id', caseId);
      if (error) throw error;
      await supabase.from('case_updates').insert({
        case_id: caseId,
        author_type: 'system',
        author_name: teamMember?.name || 'System',
        message: `${field === 'title' ? 'Title' : 'Description'} updated`,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['case', caseId] });
      queryClient.invalidateQueries({ queryKey: ['case-updates', caseId] });
      queryClient.invalidateQueries({ queryKey: ['cases'] });
      setEditing(false);
    },
    onError: () => toast.error('Failed to save'),
  });

  const save = () => mutation.mutate();

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !multiline) { e.preventDefault(); save(); }
    if (e.key === 'Escape') { setText(value || ''); setEditing(false); }
  };

  if (!editing) {
    return (
      <div
        onClick={() => { setText(value || ''); setEditing(true); }}
        className={cn('cursor-pointer hover:bg-surface-elevated/50 transition-colors px-1 -mx-1 rounded-sm', className)}
        title="Click to edit"
      >
        {value || <span className="text-muted-foreground italic">{placeholder || 'Click to add'}</span>}
      </div>
    );
  }

  if (multiline) {
    return (
      <textarea
        ref={ref as React.RefObject<HTMLTextAreaElement>}
        value={text}
        onChange={e => setText(e.target.value)}
        onBlur={save}
        onKeyDown={handleKeyDown}
        rows={3}
        className={cn('w-full bg-background border border-foreground text-sm px-2 py-1 text-foreground focus:outline-none resize-none', className)}
      />
    );
  }

  return (
    <input
      ref={ref as React.RefObject<HTMLInputElement>}
      type="text"
      value={text}
      onChange={e => setText(e.target.value)}
      onBlur={save}
      onKeyDown={handleKeyDown}
      className={cn('w-full bg-background border border-foreground text-sm px-2 py-1 text-foreground focus:outline-none', className)}
    />
  );
}
