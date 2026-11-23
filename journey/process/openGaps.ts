// "Open Closing the gaps on this process, on this stage, in this way" (package 16 of docs/next-plan.md),
// asked from outside the stage that shows it: Ask Avala's Questions tab and My work. As processChanged.ts
// does, the request is an event; it is also kept for a short while, because the stage that answers it may
// only mount after the page has moved to it. The request names its stage, and a stage takes only its own:
// asked from the Documents stage for the Assessment stage, Documents (still mounted when the event fires)
// leaves it for the Assessment stage to take once the page has moved (found in review, 23 November 2026).
import React from 'react';

/** focused: only the questions that could change the recommendation; several: "Several at once"; all: as it opens from Documents. */
export type GapsMode = 'focused' | 'several' | 'all';

const EVENT = 'avala:open-gaps';
/** A request no stage took within this long is forgotten, so it never opens Closing the gaps later by surprise. */
const KEEP_MS = 10_000;
/** The stages that show Closing the gaps. */
export type GapsStage = 'assessment' | 'documents';
const waiting = new Map<string, { stage: GapsStage; mode: GapsMode; at: number }>();

export function openGaps(processId: string, stage: GapsStage, mode: GapsMode): void {
  waiting.set(processId, { stage, mode, at: Date.now() });
  dispatchEvent(new CustomEvent(EVENT, { detail: { processId } }));
}

/** The waiting request for this process, when it is for this stage; one for another stage is left where it is. */
function take(processId: string, stage: GapsStage): GapsMode | null {
  const w = waiting.get(processId);
  if (!w || w.stage !== stage) return null;
  waiting.delete(processId);
  return Date.now() - w.at <= KEEP_MS ? w.mode : null;
}

/** On a stage that shows Closing the gaps: runs `onOpen` for a request for this stage made before it mounted, and for each one after. */
export function useOpenGaps(processId: string, stage: GapsStage, onOpen: (mode: GapsMode) => void): void {
  const latest = React.useRef(onOpen);
  latest.current = onOpen;
  React.useEffect(() => {
    const now = take(processId, stage);
    if (now) latest.current(now);
    const listen = (e: Event) => {
      if ((e as CustomEvent<{ processId: string }>).detail?.processId !== processId) return;
      const mode = take(processId, stage);
      if (mode) latest.current(mode);
    };
    addEventListener(EVENT, listen);
    return () => removeEventListener(EVENT, listen);
  }, [processId, stage]);
}
