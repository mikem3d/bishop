import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '@bishop/core';
import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

// Native apps keep the session in SQLite-backed localStorage; browsers have their own.
if (Platform.OS !== 'web') require('expo-sqlite/localStorage/install');

// Env vars override the built-in project, e.g. to point at a test project.
const url = process.env.EXPO_PUBLIC_SUPABASE_URL || SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || SUPABASE_PUBLISHABLE_KEY;

export const isConfigured = !!url && !!key;

// Both values are public; row-level security protects the data.
export const supabase = createClient(url, key, {
  auth: {
    storage: localStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// Refresh the session only while the app is in the foreground.
AppState.addEventListener('change', (state) => {
  if (state === 'active') supabase.auth.startAutoRefresh();
  else supabase.auth.stopAutoRefresh();
});
