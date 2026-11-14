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

// A section of a document to open in its editor (an Ask Avala suggestion to draft it). The request is
// kept for the page that is about to open, and announced to one already open.
const SECTION = 'avala:open-section';
export interface SectionRequest { processId: string; docType: string; sectionId: string }

export function requestSection(r: SectionRequest): void {
  try { sessionStorage.setItem(SECTION, JSON.stringify(r)); } catch { /* storage unavailable: the event still reaches an open page */ }
  dispatchEvent(new CustomEvent(SECTION, { detail: r }));
}

/** Runs `open` with a request for this process, once, whether it was made before the page opened or after. */
export function useSectionRequest(processId: string, open: (r: SectionRequest) => void): void {
  React.useEffect(() => {
    const take = (r: SectionRequest | null) => {
      if (!r || r.processId !== processId) return;
      try { sessionStorage.removeItem(SECTION); } catch { /* nothing kept */ }
      open(r);
    };
    try { take(JSON.parse(sessionStorage.getItem(SECTION) ?? 'null')); } catch { /* nothing kept */ }
    const listen = (e: Event) => take((e as CustomEvent<SectionRequest>).detail);
    addEventListener(SECTION, listen);
    return () => removeEventListener(SECTION, listen);
  }, [processId, open]);
}
