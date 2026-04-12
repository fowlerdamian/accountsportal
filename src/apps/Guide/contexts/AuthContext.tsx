import { createContext, useContext, useEffect, useState, useRef, ReactNode } from "react";
import { User } from "@supabase/supabase-js";
import { supabase } from "@guide/integrations/supabase/client";
import { useAuth as usePortalAuth } from "@portal/context/AuthContext";

interface AuthContextType {
  user: User | null;
  userRole: "admin" | "editor" | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { user, loading: portalLoading, signOut } = usePortalAuth();
  const [userRole, setUserRole] = useState<"admin" | "editor" | null>(null);
  const [roleFetching, setRoleFetching] = useState(false);
  const roleFetchedFor = useRef<string | null>(null);

  const fetchRole = async (userId: string) => {
    setRoleFetching(true);
    const { data } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .maybeSingle();
    setUserRole((data?.role as "admin" | "editor") ?? null);
    roleFetchedFor.current = userId;
    setRoleFetching(false);
  };

  useEffect(() => {
    if (!user) {
      setUserRole(null);
      roleFetchedFor.current = null;
      return;
    }
    if (roleFetchedFor.current !== user.id) {
      fetchRole(user.id);
    }
  }, [user?.id]);

  return (
    <AuthContext.Provider value={{
      user,
      userRole,
      loading: portalLoading || roleFetching,
      signOut,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
