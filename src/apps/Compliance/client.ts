import { createClient } from '@supabase/supabase-js';

// MyAudit's dedicated Supabase project (separate from portal)
const url = import.meta.env.VITE_COMPLIANCE_SUPABASE_URL as string;
const key = import.meta.env.VITE_COMPLIANCE_SUPABASE_ANON_KEY as string;

if (!url || !key) {
  console.warn('[Compliance] VITE_COMPLIANCE_SUPABASE_URL or VITE_COMPLIANCE_SUPABASE_ANON_KEY not set.');
}

export const auditSupabase = createClient(
  url  || 'https://placeholder.supabase.co',
  key  || 'placeholder-anon-key',
  {
    auth: {
      persistSession: true,
      storageKey: 'compliance-auth',
    },
  }
);
