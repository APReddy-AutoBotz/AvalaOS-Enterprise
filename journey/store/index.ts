import { createMemoryStore } from './memoryStore.ts';
import { standInFromPage } from './standIns.ts';
import { createSupabaseStore } from './supabaseStore.ts';
import type { JourneyStore } from './types.ts';

/**
 * The Supabase store when the project URL and publishable key are configured; the memory store when
 * VITE_JOURNEY_STORE is "memory" (browser tests, local runs). Otherwise null: the app says it is not
 * configured rather than silently running on fake data.
 */
export function createJourneyStore(): JourneyStore | null {
  const env = import.meta.env;
  // The browser tests' stand-in for AI tasks, only in a test build (journey/store/standIns.ts): the
  // released build replaces __AVALA_STAND_INS__ with false, so the stand-in is left out of it.
  if (__AVALA_STAND_INS__ && env.VITE_JOURNEY_STORE === 'memory') return createMemoryStore({ standIn: standInFromPage() });
  if (env.VITE_JOURNEY_STORE === 'memory') return createMemoryStore();
  const url = env.VITE_SUPABASE_URL;
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY;
  if (url && key) return createSupabaseStore(url, key);
  return null;
}
