// Removes from this browser what belongs to the person who signs out (domain/site/storage.ts).
import { keysToForget } from '../domain/site/storage.ts';

export function forgetOnSignOut(): void {
  for (const store of [globalThis.localStorage, globalThis.sessionStorage]) {
    try {
      if (!store) continue;
      const keys = Array.from({ length: store.length }, (_, i) => store.key(i)).filter((k): k is string => k !== null);
      for (const k of keysToForget(keys)) store.removeItem(k);
    } catch { /* storage unavailable */ }
  }
}
