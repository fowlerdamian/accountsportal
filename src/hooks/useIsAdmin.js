import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext.jsx'

export function useIsAdmin() {
  const { user, loading: authLoading } = useAuth()
  const [isAdmin, setIsAdmin] = useState(false)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    if (authLoading) return // Wait for auth to resolve first

    setChecking(true)

    if (user?.id) {
      supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .in('role', ['admin'])
        .maybeSingle()
        .then(({ data }) => {
          setIsAdmin(!!data)
          setChecking(false)
        })
      return
    }

    // Guest (login wall down): check by stored email
    const guestEmail = localStorage.getItem('portal_guest_email')
    if (!guestEmail) { setIsAdmin(false); setChecking(false); return }

    supabase
      .rpc('get_role_by_email', { p_email: guestEmail })
      .then(({ data }) => {
        setIsAdmin(data === 'admin')
        setChecking(false)
      })
  }, [user?.id, authLoading])

  return { isAdmin, checking }
}
