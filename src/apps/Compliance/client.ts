import { createClient } from '@supabase/supabase-js';

// MyAudit's dedicated Supabase project (separate from portal)
const SUPABASE_URL = 'https://zvzejdepjbpceirclclq.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp2emVqZGVwamJwY2VpcmNsY2xxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIxMjkyNDUsImV4cCI6MjA4NzcwNTI0NX0.rB__NBG77ojim5foA0M6TNwBdBrWTcsfE2eQugyHxqo';

export const auditSupabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    storageKey: 'compliance-auth',
  },
});
