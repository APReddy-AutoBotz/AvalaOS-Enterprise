// Whether a discovery session is in use on a process, for the automatic look in the sources (package B, pull
// request 4b, plan `claude/package-b-pr4-plan-24-nov.md`, section 4; review, 24 November 2026). The rule is
// `sessionInUse` (domain/discovery/session.ts): written in the last 30 minutes, or open in the Discovery tab in
// this browser. This file keeps the second part: which processes have the Discovery tab open in this page.
import React from 'react';
import type { JourneyStore } from '../store/types.ts';
import { sessionInUse } from '../../domain/discovery/session.ts';

const open = new Map<string, number>();

/** While the Discovery tab is shown for a process: it counts as open here. */
export function useDiscoveryOpenHere(processId: string): void {
  React.useEffect(() => {
    open.set(processId, (open.get(processId) ?? 0) + 1);
    return () => { const n = (open.get(processId) ?? 1) - 1; if (n > 0) open.set(processId, n); else open.delete(processId); };
  }, [processId]);
}

export const discoveryOpenHere = (processId: string): boolean => (open.get(processId) ?? 0) > 0;

/** Whether the look in the sources should wait for this process now. A session that cannot be read holds nothing back. */
export async function discoveryHoldsLook(store: JourneyStore, processId: string, now = Date.now()): Promise<boolean> {
  if (discoveryOpenHere(processId)) return true;
  const s = await store.getDiscoverySession(processId).catch(() => null);
  return sessionInUse(s, now);
}
