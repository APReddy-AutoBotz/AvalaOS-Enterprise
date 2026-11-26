// "Open Ask Avala on Discovery for this process" (package B, pull request 4b), asked from outside the panel: the
// "Add and start with Ask Avala" button on Processes and the line on the Sources stage. As openGaps.ts does, the
// request is an event, also kept for a short while, because the page may move to the process before the top
// bar's Ask Avala hears it.
import React from 'react';

const EVENT = 'avala:open-discovery';
const KEEP_MS = 10_000;
const waiting = new Map<string, number>();

export function openDiscovery(processId: string): void {
  waiting.set(processId, Date.now());
  dispatchEvent(new CustomEvent(EVENT, { detail: { processId } }));
}

function take(processId: string): boolean {
  const at = waiting.get(processId);
  if (at === undefined) return false;
  waiting.delete(processId);
  return Date.now() - at <= KEEP_MS;
}

/** In Ask Avala: runs `onOpen` for a request for the process on screen, made before or after it mounted. */
export function useOpenDiscovery(processId: string | null, onOpen: () => void): void {
  const latest = React.useRef(onOpen);
  latest.current = onOpen;
  React.useEffect(() => {
    if (!processId) return;
    if (take(processId)) latest.current();
    const listen = (e: Event) => { if ((e as CustomEvent<{ processId: string }>).detail?.processId === processId && take(processId)) latest.current(); };
    addEventListener(EVENT, listen);
    return () => removeEventListener(EVENT, listen);
  }, [processId]);
}

/** In the top bar: opens the Ask Avala panel when Discovery is asked for, on any process (the panel then takes the request). */
export function useDiscoveryAsked(onAsked: () => void): void {
  const latest = React.useRef(onAsked);
  latest.current = onAsked;
  React.useEffect(() => {
    if ([...waiting.values()].some(at => Date.now() - at <= KEEP_MS)) latest.current();
    const listen = () => latest.current();
    addEventListener(EVENT, listen);
    return () => removeEventListener(EVENT, listen);
  }, []);
}
