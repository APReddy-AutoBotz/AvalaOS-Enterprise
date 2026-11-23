// What should happen in future, apart from the work done today (package B, plan sections 2 and 4).
// A statement is marked wanted only when it carries a word about the future or about wanting
// (`WANTED_CUES`), so a passage cannot mark everything wanted. When the work is done today, or partly,
// a step, rule or figure a reading proposes whose every quote lies inside a statement marked wanted is
// held back: shown under "What you want to change", never a step of the work done today. When the work is
// not done today, the intended process is what people say should happen, so nothing is held back.
import type { ProcessModel, SourceRef } from '../processModel/types.ts';
import { notDoneToday } from '../plan/intended.ts';

/** Words that say something should happen in future, or is wanted. */
export const WANTED_CUES: readonly RegExp[] = [
  /\bshould\b/i, /\bwill\b/i, /\bwould\s+like\b/i, /\bwould\s+be\s+(good|great|better|nice)\b/i, /\bwants?\b/i,
  /\bneeds?\s+to\b/i, /\bhas\s+to\s+be\s+able\b/i, /\bin\s+(the\s+)?future\b/i, /\bgoing\s+forward\b/i, /\bfrom\s+now\s+on\b/i,
  /\bnew\s+(system|tool|application|app|process|portal)\b/i, /\bwe\s+(plan|intend|hope)\b/i, /\bonce\s+(it|the\s+\w+)\s+is\s+(live|built|in\s+place)\b/i,
  /\bideally\b/i, /\bwish\b/i,
];

export const hasWantedCue = (text: string): boolean => WANTED_CUES.some(re => re.test(text));

/** A statement marked wanted: the quote and the source it is in. */
export interface WantedQuote { sourceId: string; excerpt: string }

const norm = (s: string) => s.toLowerCase().replace(/[“”"'‘’]/g, '').replace(/\s+/g, ' ').trim();

/** Whether a quote lies inside one of the wanted statements of the same source. */
export const insideWanted = (q: Pick<SourceRef, 'sourceId' | 'excerpt'>, wanted: readonly WantedQuote[]): boolean =>
  wanted.some(w => w.sourceId === q.sourceId && norm(w.excerpt).includes(norm(q.excerpt)) && norm(q.excerpt).length > 0);

/** Whether the work is described as done today (yes or partly), where held-back statements apply. */
export const holdsBackWanted = (m: ProcessModel): boolean => !notDoneToday(m);

/**
 * The elements a reading proposed that are held back: those whose every quote lies inside a wanted
 * statement, when the work is done today or partly. An element with no quote is never held back.
 */
export function heldBack<T extends { id: string; sources: Pick<SourceRef, 'sourceId' | 'excerpt'>[] }>(m: ProcessModel, proposed: readonly T[], wanted: readonly WantedQuote[]): T[] {
  if (!holdsBackWanted(m) || !wanted.length) return [];
  return proposed.filter(e => e.sources.length > 0 && e.sources.every(s => insideWanted(s, wanted)));
}

/** The wanted statements a noticing reply marked that carry a cue; the others are dropped by rule. */
export const keepCued = <T extends { excerpt: string }>(marked: readonly T[]): T[] => marked.filter(w => hasWantedCue(w.excerpt));
