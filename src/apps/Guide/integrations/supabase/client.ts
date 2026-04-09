// Re-uses the staff-portal Supabase client instance, cast to the Guide Portal's typed schema.
// Single auth session and connection pool shared across the whole portal.
import { supabase as portalClient } from '../../../../lib/supabase.js'
import type { Database } from './types'
import type { SupabaseClient } from '@supabase/supabase-js'

export const supabase = portalClient as unknown as SupabaseClient<Database>