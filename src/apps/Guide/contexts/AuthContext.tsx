import { createContext, useContext, useEffect, useState, useRef, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@guide/integrations/supabase/client";

interface AuthContextType {
  session: Session | null;
  user: User | null;
  userRole: "admin" | "editor" | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [userRole, setUserRole] = useState<"admin" | "editor" | null>(null);
  const [loading, setLoading] = useState(true);
  const roleFetchedFor = useRef<string | null>(null);

  const fetchRole = async (userId: string) => {
    const { data } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .maybeSingle();
    setUserRole((data?.role as "admin" | "editor") ?? null);
    roleFetchedFor.current = userId;
  };

  useEffect(() => {
    let initialised = false;

    // getSession() is authoritative for the initial load — sets loading=false once done
    supabase.auth.getSession().then(({ data: { session } }) => {
      initialised = true;
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchRole(session.user.id).then(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    // onAuthStateChange handles subsequent auth events (sign in/out, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        // Skip the initial event — getSession() handles that
        if (!initialised) return;
        setSession(session);
        setUser(session?.user ?? null);
        if (session?.user) {
          if (roleFetchedFor.current !== session.user.id) {
            fetchRole(session.user.id).then(() => setLoading(false));
          } else {
            setLoading(false);
          }
        } else {
          setUserRole(null);
          roleFetchedFor.current = null;
          setLoading(false);
        }
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    setSession(null);
    setUser(null);
    setUserRole(null);
    roleFetchedFor.current = null;
  };

  return (
    <AuthContext.Provider value={{ session, user, userRole, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
