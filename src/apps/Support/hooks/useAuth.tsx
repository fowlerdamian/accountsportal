import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

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
  session: Session | null;
  user: User | null;
  teamMember: TeamMember | null;
  isLoading: boolean;
  isAdmin: boolean;
  isWarehouse: boolean;
  signOut: () => Promise<void>;
  refreshTeamMember: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  teamMember: null,
  isLoading: true,
  isAdmin: false,
  isWarehouse: false,
  signOut: async () => {},
  refreshTeamMember: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [teamMember, setTeamMember] = useState<TeamMember | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const ensureTeamMember = async (currentUser: User) => {
    // Check if team member record exists
    const { data: existing } = await supabase
      .from('team_members')
      .select('*')
      .eq('id', currentUser.id)
      .maybeSingle();

    if (existing) {
      // Update last_seen_at
      await supabase
        .from('team_members')
        .update({ last_seen_at: new Date().toISOString(), status: existing.status === 'invited' ? 'active' : existing.status })
        .eq('id', currentUser.id);

      setTeamMember({
        ...existing,
        status: existing.status === 'invited' ? 'active' : existing.status,
      } as TeamMember);
      return;
    }

    // Auto-register: get next available avatar colour
    const { count } = await supabase
      .from('team_members')
      .select('*', { count: 'exact', head: true });

    const colourIndex = (count || 0) % AVATAR_COLOURS.length;
    const email = currentUser.email || '';
    const name = currentUser.user_metadata?.name ||
      email.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

    const newMember = {
      id: currentUser.id,
      name,
      email,
      role: 'staff' as const,
      avatar_colour: AVATAR_COLOURS[colourIndex],
      status: 'active' as const,
      last_seen_at: new Date().toISOString(),
    };

    const { data: inserted, error } = await supabase
      .from('team_members')
      .insert(newMember)
      .select()
      .single();

    if (inserted) {
      setTeamMember(inserted as TeamMember);
    } else if (error) {
      // Might have been created by admin invite, retry fetch
      const { data: retry } = await supabase
        .from('team_members')
        .select('*')
        .eq('id', currentUser.id)
        .maybeSingle();
      if (retry) setTeamMember(retry as TeamMember);
    }
  };

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, currentSession) => {
        setSession(currentSession);
        setUser(currentSession?.user ?? null);

        if (currentSession?.user) {
          // Use setTimeout to avoid Supabase client deadlock
          setTimeout(() => ensureTeamMember(currentSession.user), 0);
        } else {
          setTeamMember(null);
        }
        setIsLoading(false);
      }
    );

    supabase.auth.getSession().then(({ data: { session: currentSession } }) => {
      setSession(currentSession);
      setUser(currentSession?.user ?? null);
      if (currentSession?.user) {
        ensureTeamMember(currentSession.user);
      }
      setIsLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    setSession(null);
    setUser(null);
    setTeamMember(null);
  };

  const refreshTeamMember = async () => {
    const currentUser = user;
    if (!currentUser) return;
    const { data } = await supabase
      .from('team_members')
      .select('*')
      .eq('id', currentUser.id)
      .maybeSingle();
    if (data) setTeamMember(data as TeamMember);
  };

  return (
    <AuthContext.Provider value={{
      session,
      user,
      teamMember,
      isLoading,
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
