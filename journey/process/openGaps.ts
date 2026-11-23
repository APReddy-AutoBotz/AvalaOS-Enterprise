// "Open Closing the gaps on this process, in this way" (package 16 of docs/next-plan.md), asked from
// outside the stage that shows it: Ask Avala's Questions tab and My work. As processChanged.ts does, the
// request is an event; it is also kept for a short while, because the stage that answers it may only
// mount after the page has moved to it.
import React from 'react';

/** focused: only the questions that could change the recommendation; several: "Several at once"; all: as it opens from Documents. */
export type GapsMode = 'focused' | 'several' | 'all';

const EVENT = 'avala:open-gaps';
/** A request no stage took within this long is forgotten, so it never opens Closing the gaps later by surprise. */
const KEEP_MS = 10_000;
const waiting = new Map<string, { mode: GapsMode; at: number }>();

export function openGaps(processId: string, mode: GapsMode): void {
  waiting.set(processId, { mode, at: Date.now() });
  dispatchEvent(new CustomEvent(EVENT, { detail: { processId } }));
}

function take(processId: string): GapsMode | null {
  const w = waiting.get(processId);
  waiting.delete(processId);
  return w && Date.now() - w.at <= KEEP_MS ? w.mode : null;
}

/** On a stage that shows Closing the gaps: runs `onOpen` for a request made before it mounted, and for each one after. */
export function useOpenGaps(processId: string, onOpen: (mode: GapsMode) => void): void {
  const latest = React.useRef(onOpen);
  latest.current = onOpen;
  React.useEffect(() => {
    const now = take(processId);
    if (now) latest.current(now);
    const listen = (e: Event) => {
      if ((e as CustomEvent<{ processId: string }>).detail?.processId !== processId) return;
      const mode = take(processId);
      if (mode) latest.current(mode);
    };
    addEventListener(EVENT, listen);
    return () => removeEventListener(EVENT, listen);
  }, [processId]);
}
