import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext.jsx'

export function useIsAdmin() {
  const { user } = useAuth()
  const [isAdmin, setIsAdmin] = useState(false)

  useEffect(() => {
    if (!user?.id) { setIsAdmin(false); return }
    supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .in('role', ['admin'])
      .maybeSingle()
      .then(({ data }) => setIsAdmin(!!data))
  }, [user?.id])

  return isAdmin
}
