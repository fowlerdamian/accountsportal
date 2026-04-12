import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import { auditSupabase } from '../client';
import { useAuth } from '@guide/contexts/AuthContext';

export interface Action {
  id: string;
  document_id: string;
  question_index: number;
  question_text: string;
  answer_text: string;
  ai_feedback: string;
  status: 'open' | 'closed';
  created_by: string;
  created_at: string;
  closed_at: string | null;
}

interface ActionsContextType {
  actions: Action[];
  loading: boolean;
  refreshActions: () => Promise<void>;
  createAction: (action: Omit<Action, 'id' | 'status' | 'created_at' | 'closed_at' | 'created_by'>) => Promise<void>;
  closeAction: (id: string) => Promise<void>;
  reopenAction: (id: string) => Promise<void>;
  deleteAction: (id: string) => Promise<void>;
  getActionsForDocument: (documentId: string) => Action[];
}

const ActionsContext = createContext<ActionsContextType | undefined>(undefined);

export function ActionsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [actions, setActions] = useState<Action[]>([]);
  const [loading, setLoading] = useState(false);

  const refreshActions = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await auditSupabase
        .from('actions')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setActions((data as Action[]) || []);
    } catch (err) {
      console.error('Failed to load actions:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshActions();
  }, [refreshActions]);

  const createAction = useCallback(async (action: Omit<Action, 'id' | 'status' | 'created_at' | 'closed_at' | 'created_by'>) => {
    const { error } = await auditSupabase.from('actions').insert({
      ...action,
      created_by: user?.id ?? 'unknown',
    });
    if (error) throw error;
    await refreshActions();
  }, [user?.id, refreshActions]);

  const closeAction = useCallback(async (id: string) => {
    const { error } = await auditSupabase
      .from('actions')
      .update({ status: 'closed', closed_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
    await refreshActions();
  }, [refreshActions]);

  const reopenAction = useCallback(async (id: string) => {
    const { error } = await auditSupabase
      .from('actions')
      .update({ status: 'open', closed_at: null })
      .eq('id', id);
    if (error) throw error;
    await refreshActions();
  }, [refreshActions]);

  const deleteAction = useCallback(async (id: string) => {
    const { error } = await auditSupabase
      .from('actions')
      .delete()
      .eq('id', id);
    if (error) throw error;
    await refreshActions();
  }, [refreshActions]);

  const getActionsForDocument = useCallback((documentId: string) => {
    return actions.filter((a) => a.document_id === documentId);
  }, [actions]);

  return (
    <ActionsContext.Provider value={{ actions, loading, refreshActions, createAction, closeAction, reopenAction, deleteAction, getActionsForDocument }}>
      {children}
    </ActionsContext.Provider>
  );
}

export function useActions() {
  const context = useContext(ActionsContext);
  if (!context) throw new Error('useActions must be used within ActionsProvider');
  return context;
}
