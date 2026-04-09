import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext.jsx'

export function useIsAdmin() {
  const { user } = useAuth()
  const [isAdmin, setIsAdmin] = useState(false)

  useEffect(() => {
    if (user?.id) {
      // Authenticated: check by user_id
      supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .in('role', ['admin'])
        .maybeSingle()
        .then(({ data }) => setIsAdmin(!!data))
      return
    }

    // Guest (login wall down): check by stored email
    const guestEmail = localStorage.getItem('portal_guest_email')
    if (!guestEmail) { setIsAdmin(false); return }

    supabase
      .rpc('get_role_by_email', { p_email: guestEmail })
      .then(({ data }) => setIsAdmin(data === 'admin'))
  }, [user?.id])

  return isAdmin
}
