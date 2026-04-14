import { createClient } from '@supabase/supabase-js'

const supabaseUrl     = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
                     ?? import.meta.env.VITE_SUPABASE_ANON_KEY

// During build without env vars, createClient still works — auth calls will just fail
// at runtime. The error below surfaces only if the app actually tries to auth.
export const supabase = createClient(
  supabaseUrl  || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-anon-key'
)

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    '[Staff Portal] Supabase env vars not set.\n' +
    'Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY (or VITE_SUPABASE_ANON_KEY) in your environment.'
  )
}
