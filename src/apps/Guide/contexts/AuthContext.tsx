import { createContext, useContext, useEffect, useState, useRef, ReactNode, useCallback } from "react";
import { User } from "@supabase/supabase-js";
import { supabase } from "@guide/integrations/supabase/client";
import { useAuth as usePortalAuth } from "@portal/context/AuthContext";

interface AuthContextType {
  user: User | null;
  userRole: "admin" | "editor" | null;
  loading: boolean;
  /** Set when the role lookup itself failed (network/RLS) — distinct from "no role". */
  roleError: string | null;
  refetchRole: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { user, loading: portalLoading, signOut } = usePortalAuth();
  const [userRole, setUserRole] = useState<"admin" | "editor" | null>(null);
  const [roleError, setRoleError] = useState<string | null>(null);
  const [roleFetching, setRoleFetching] = useState(false);
  const roleFetchedFor = useRef<string | null>(null);

  const fetchRole = useCallback(async (userId: string) => {
    setRoleFetching(true);
    const { data, error } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) {
      // Keep the failure visible so the layout can offer a retry instead of
      // silently treating a transient error as "no role / access denied".
      setRoleError(error.message);
      setUserRole(null);
    } else {
      setRoleError(null);
      setUserRole((data?.role as "admin" | "editor") ?? null);
    }
    roleFetchedFor.current = userId;
    setRoleFetching(false);
  }, []);

  useEffect(() => {
    if (!user) {
      setUserRole(null);
      setRoleError(null);
      roleFetchedFor.current = null;
      return;
    }
    if (roleFetchedFor.current !== user.id) {
      fetchRole(user.id);
    }
  }, [user?.id, fetchRole]);

  const refetchRole = useCallback(async () => {
    if (user) await fetchRole(user.id);
  }, [user, fetchRole]);

  return (
    <AuthContext.Provider value={{
      user,
      userRole,
      // Stay "loading" until the role for the current user has actually been
      // fetched — otherwise role-gated layouts render a frame with a null
      // role and wrongly deny (or admit) the user.
      loading: portalLoading || roleFetching || (!!user && roleFetchedFor.current !== user.id),
      roleError,
      refetchRole,
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
