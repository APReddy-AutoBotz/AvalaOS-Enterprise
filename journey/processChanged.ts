// A process's record was changed from outside its page (the Ask Avala interview records answers from the
// top bar's panel): the page showing that process reloads, so what it shows follows at once.
import React from 'react';

const EVENT = 'avala:process-changed';

export function announceProcessChanged(processId: string): void {
  dispatchEvent(new CustomEvent(EVENT, { detail: { processId } }));
}

/** Runs `onChange` when the given process is changed elsewhere. */
export function useProcessChanged(processId: string, onChange: () => void): void {
  React.useEffect(() => {
    const listen = (e: Event) => { if ((e as CustomEvent<{ processId: string }>).detail?.processId === processId) onChange(); };
    addEventListener(EVENT, listen);
    return () => removeEventListener(EVENT, listen);
  }, [processId, onChange]);
}
