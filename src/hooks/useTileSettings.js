import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

/**
 * Returns tile settings for a given user_id.
 * { [tile_route]: boolean }  — missing key means enabled (default on).
 */
const CACHE_KEY = (userId) => `tile-settings:${userId}`
function readCache(userId) {
  if (!userId) return null
  try { const raw = localStorage.getItem(CACHE_KEY(userId)); return raw ? JSON.parse(raw) : null } catch { return null }
}
function writeCache(userId, map) {
  try { localStorage.setItem(CACHE_KEY(userId), JSON.stringify(map)) } catch { /* ignore */ }
}

export function useTileSettings(userId) {
  // null = still loading — callers must NOT render tiles in that state (it used to
  // flash every tile until the query returned). Seeded from the last-known map for
  // this user so a reload paints the right tiles immediately.
  const [settings, setSettings] = useState(() => readCache(userId))
  const [error, setError]       = useState(null)

  const load = useCallback(async () => {
    if (!userId) return // auth still resolving — stay in loading state, never "show all"
    const { data, error } = await supabase
      .from('user_tile_settings')
      .select('tile_route, enabled')
      .eq('user_id', userId)
    if (error) { setError(error); setSettings((prev) => prev ?? readCache(userId) ?? {}); return }
    const map = {}
    data.forEach(r => { map[r.tile_route] = r.enabled })
    writeCache(userId, map)
    setSettings(map)
  }, [userId])

  useEffect(() => {
    const cached = readCache(userId)
    if (cached) setSettings(cached)
    load()
  }, [load, userId])

  return { settings, error, reload: load }
}

/**
 * Returns all users with their tile settings — admin only.
 */
export function useAllUserTileSettings() {
  const [users, setUsers]     = useState(null)
  const [settings, setSettings] = useState({}) // { [user_id]: { [route]: bool } }
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState(null)

  useEffect(() => {
    async function load() {
      // Fetch all auth users via the user_roles table + auth.users info exposed via a view
      // We join user_tile_settings with a list of known users from auth.users
      const { data: authUsers, error: uErr } = await supabase.rpc('list_portal_users')
      if (uErr) { setError(uErr); return }

      const { data: tileRows, error: tErr } = await supabase
        .from('user_tile_settings')
        .select('user_id, tile_route, enabled')
      if (tErr) { setError(tErr); return }

      setUsers(authUsers)

      const map = {}
      tileRows.forEach(r => {
        if (!map[r.user_id]) map[r.user_id] = {}
        map[r.user_id][r.tile_route] = r.enabled
      })
      setSettings(map)
    }
    load()
  }, [])

  const toggle = useCallback(async (userId, tileRoute, enabled) => {
    setSaving(true)
    const { error } = await supabase
      .from('user_tile_settings')
      .upsert({ user_id: userId, tile_route: tileRoute, enabled }, { onConflict: 'user_id,tile_route' })
    setSaving(false)
    if (error) { setError(error); return }
    setSettings(prev => ({
      ...prev,
      [userId]: { ...(prev[userId] || {}), [tileRoute]: enabled },
    }))
  }, [])

  return { users, settings, saving, error, toggle }
}
