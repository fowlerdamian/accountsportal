import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { Session } from '@supabase/supabase-js';
import { auditSupabase } from '../client';

interface UserProfile {
  id: string;
  userId: string;
  fullName: string;
  email: string;
  companyId: string | null;
}

interface AuditAuthContextType {
  session: Session | null;
  profile: UserProfile | null;
  isAdmin: boolean;
  loading: boolean;
  sendMagicLink: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuditAuthContext = createContext<AuditAuthContextType | undefined>(undefined);

export function AuditAuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    auditSupabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session) loadProfile(data.session.user.id, data.session.user.email ?? '');
      else setLoading(false);
    });

    const { data: { subscription } } = auditSupabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess);
      if (sess) loadProfile(sess.user.id, sess.user.email ?? '');
      else {
        setProfile(null);
        setIsAdmin(false);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const loadProfile = async (userId: string, email: string) => {
    try {
      const { data: profileData } = await auditSupabase
        .from('profiles')
        .select('*')
        .eq('user_id', userId)
        .single();

      if (profileData) {
        setProfile({
          id: profileData.id,
          userId: profileData.user_id,
          fullName: profileData.full_name || email,
          email: profileData.email || email,
          companyId: profileData.company_id,
        });
      }

      const { data: roleData } = await auditSupabase
        .from('user_roles')
        .select('role')
        .eq('user_id', userId)
        .single();

      setIsAdmin(roleData?.role === 'admin');
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  const sendMagicLink = async (email: string) => {
    const { error } = await auditSupabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/hub/compliance`,
      },
    });
    if (error) throw error;
  };

  const signOut = async () => {
    await auditSupabase.auth.signOut();
  };

  return (
    <AuditAuthContext.Provider value={{ session, profile, isAdmin, loading, sendMagicLink, signOut }}>
      {children}
    </AuditAuthContext.Provider>
  );
}

export function useAuditAuth() {
  const ctx = useContext(AuditAuthContext);
  if (!ctx) throw new Error('useAuditAuth must be used within AuditAuthProvider');
  return ctx;
}
