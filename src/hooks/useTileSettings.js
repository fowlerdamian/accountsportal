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
