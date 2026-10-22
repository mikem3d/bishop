import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '@bishop/core';
import { sessionStorage } from './credentials.js';

// A Supabase client signed in as you, used by `bishop login` / `bishop link`
// and by the runner for live updates. Row-level security limits it to your workspace.

let client: SupabaseClient | null = null;

export function userClient(): SupabaseClient {
  client ??= createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      storage: sessionStorage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storageKey: 'bishop-session',
    },
  });
  return client;
}

export async function requireSession(db = userClient()) {
  const { data } = await db.auth.getSession();
  if (!data.session) throw new Error('Not signed in on this Mac. Run `bishop login` first.');
  return data.session;
}
