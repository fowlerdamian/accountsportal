import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { User } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { useAuth as usePortalAuth } from '../../../context/AuthContext';

const AVATAR_COLOURS = [
  '#C0392B', '#1A6FA8', '#2E7D32', '#D4860A',
  '#6B3FA0', '#0E7C7B', '#8D3B2B', '#3D5A80',
];

interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'staff' | 'warehouse';
  avatar_colour: string;
  status: 'invited' | 'active' | 'deactivated';
}

interface AuthContextType {
  user: User | null;
  teamMember: TeamMember | null;
  isLoading: boolean;
  isAdmin: boolean;
  isWarehouse: boolean;
  signOut: () => Promise<void>;
  refreshTeamMember: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  teamMember: null,
  isLoading: true,
  isAdmin: false,
  isWarehouse: false,
  signOut: async () => {},
  refreshTeamMember: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const { user, loading: portalLoading, signOut: portalSignOut } = usePortalAuth();
  const [teamMember, setTeamMember] = useState<TeamMember | null>(null);
  const [teamLoading, setTeamLoading] = useState(true);

  const ensureTeamMember = async (currentUser: User) => {
    const { data: existing } = await supabase
      .from('team_members')
      .select('*')
      .eq('id', currentUser.id)
      .maybeSingle();

    if (existing) {
      await supabase
        .from('team_members')
        .update({ last_seen_at: new Date().toISOString(), status: existing.status === 'invited' ? 'active' : existing.status })
        .eq('id', currentUser.id);
      setTeamMember({ ...existing, status: existing.status === 'invited' ? 'active' : existing.status } as TeamMember);
      return;
    }

    const { count } = await supabase.from('team_members').select('*', { count: 'exact', head: true });
    const colourIndex = (count || 0) % AVATAR_COLOURS.length;
    const email = currentUser.email || '';
    const name = currentUser.user_metadata?.name ||
      email.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());

    const newMember = {
      id: currentUser.id,
      name,
      email,
      role: 'staff' as const,
      avatar_colour: AVATAR_COLOURS[colourIndex],
      status: 'active' as const,
      last_seen_at: new Date().toISOString(),
    };

    const { data: inserted, error } = await supabase.from('team_members').insert(newMember).select().single();
    if (inserted) {
      setTeamMember(inserted as TeamMember);
    } else if (error) {
      const { data: retry } = await supabase.from('team_members').select('*').eq('id', currentUser.id).maybeSingle();
      if (retry) setTeamMember(retry as TeamMember);
    }
  };

  useEffect(() => {
    if (!user) {
      setTeamMember(null);
      setTeamLoading(false);
      return;
    }
    setTeamLoading(true);
    ensureTeamMember(user).finally(() => setTeamLoading(false));
  }, [user?.id]);

  const refreshTeamMember = async () => {
    if (!user) return;
    const { data } = await supabase.from('team_members').select('*').eq('id', user.id).maybeSingle();
    if (data) setTeamMember(data as TeamMember);
  };

  const signOut = async () => { await portalSignOut(); };

  return (
    <AuthContext.Provider value={{
      user,
      teamMember,
      isLoading: portalLoading || teamLoading,
      isAdmin: teamMember?.role === 'admin',
      isWarehouse: (teamMember?.role as string) === 'warehouse',
      signOut,
      refreshTeamMember,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
