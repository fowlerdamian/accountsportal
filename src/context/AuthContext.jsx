import { createContext, useContext, useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

const AuthContext = createContext({})

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null)
  const [loading, setLoading] = useState(true)
  const queryClient = useQueryClient()

  useEffect(() => {
    // Dev bypass: set VITE_DEV_AUTO_LOGIN=true in .env.local to skip Supabase auth
    if (import.meta.env.DEV && import.meta.env.VITE_DEV_AUTO_LOGIN === 'true') {
      setUser({ email: 'dev@automotivegroup.com.au', id: 'dev-user' })
      setLoading(false)
      return
    }

    // Hydrate from existing session on mount
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      setLoading(false)
    })

    // Keep in sync with Supabase auth events
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null)
      if (event === 'SIGNED_OUT') {
        // Drop cached finance data so the next person on this browser can't see it
        // (key matches PERSIST_STORAGE_KEY in App.jsx). Covers every sign-out path.
        queryClient.clear()
        try { localStorage.removeItem('portal-query-cache') } catch { /* storage blocked */ }
      }
    })

    return () => subscription.unsubscribe()
  }, [queryClient])

  const signIn = (email, password) =>
    supabase.auth.signInWithPassword({ email, password })

  const signInWithMagicLink = (email) =>
    supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo:
          import.meta.env.VITE_SUPABASE_REDIRECT_URL || window.location.origin,
      },
    })

  const signOut = () => supabase.auth.signOut()

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signInWithMagicLink, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
