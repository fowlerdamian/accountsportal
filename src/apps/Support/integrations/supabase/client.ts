// Re-uses the staff-portal Supabase client instance, cast to the Support Hub's typed schema.
// This ensures a single auth session and connection pool across the whole portal.
import { supabase as portalClient } from '../../../../lib/supabase.js'
import type { Database } from './types'
import type { SupabaseClient } from '@supabase/supabase-js'

export const supabase = portalClient as unknown as SupabaseClient<Database>