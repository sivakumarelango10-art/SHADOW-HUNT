import type { SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;

/** True when the deployment has Supabase Auth configured (Google + email sign-in). */
export const supabaseConfigured = Boolean(url && anon);

let client: Promise<SupabaseClient> | null = null;

/** Lazily loads supabase-js so guest-only deployments never download it. */
export function getSupabase(): Promise<SupabaseClient> | null {
  if (!supabaseConfigured) return null;
  client ??= import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(url!, anon!, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }),
  );
  return client;
}
