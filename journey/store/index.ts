import { createMemoryStore } from './memoryStore.ts';
import { createSupabaseStore } from './supabaseStore.ts';
import type { JourneyStore } from './types.ts';

/**
 * The Supabase store when the project URL and publishable key are configured; the memory store when
 * VITE_JOURNEY_STORE is "memory" (browser tests, local runs). Otherwise null: the app says it is not
 * configured rather than silently running on fake data.
 */
export function createJourneyStore(): JourneyStore | null {
  const env = import.meta.env;
  if (env.VITE_JOURNEY_STORE === 'memory') return createMemoryStore();
  const url = env.VITE_SUPABASE_URL;
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY;
  if (url && key) return createSupabaseStore(url, key);
  return null;
}
