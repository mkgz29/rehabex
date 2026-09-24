import { createClient } from '@supabase/supabase-js';

// Optional chaining on import.meta.env itself (never on the values): under
// Vite this object always exists, so app behavior is unchanged. Under a
// plain Node test runner (no Vite transform), import.meta.env is undefined
// rather than populated, and this falls back to unconfigured instead of
// throwing at import time.
const supabaseUrl = import.meta.env?.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env?.VITE_SUPABASE_ANON_KEY;

export const hasSupabaseConfig = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = hasSupabaseConfig
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    })
  : null;
