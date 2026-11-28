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

/**
 * A rule of today's work that is not kept (measure 4 of the replay, the owner's choice of 26 November 2026): a
 * sentence that says something "should" (or is supposed to) happen and goes on with "but in practice", "but today"
 * or the like says how the work goes today, not what is wanted in future ("The badge should be cancelled, but in
 * practice we find out weeks later"). Such a statement is raised as a question, never marked wanted. A sentence that
 * also carries a word about the future ("in future", "would like", "ideally" and the others in `WANTED_CUES`) stays
 * wanted: "In future the system should block it, but today we check by hand" is a wish.
 */
export const SHOULD = /\b(should|is\s+supposed\s+to|are\s+supposed\s+to|ought\s+to)\b/i;
export const NOT_KEPT = /\b(but|though|although|yet)\b[^.!?]*?\b(in\s+practice|in\s+reality|in\s+real\s+life|today|nowadays|right\s+now|at\s+the\s+moment|currently|actually|really|usually|often|sometimes|most\s+of\s+the\s+time|rarely|never|not\s+always|seldom|we\s+find|it\s+(doesn['’]t|does\s+not|isn['’]t|is\s+not)|nobody|no\s+one|people\s+(don['’]t|do\s+not|forget))\b/i;

/** The sentence of a passage that holds the excerpt (the excerpt alone when it is not found). */
export function sentenceAround(passage: string, excerpt: string): string {
  const at = passage.toLowerCase().indexOf(excerpt.trim().toLowerCase());
  if (at < 0 || !excerpt.trim()) return excerpt;
  const before = passage.slice(0, at), after = passage.slice(at);
  const start = Math.max(...['.', '!', '?', '\n'].map(c => before.lastIndexOf(c))) + 1;
  const ends = ['.', '!', '?', '\n'].map(c => after.indexOf(c, excerpt.trim().length - 1)).filter(n => n >= 0);
  return passage.slice(start, at + (ends.length ? Math.min(...ends) + 1 : after.length)).trim();
}

/** Whether a sentence states a rule of today's work that is not kept, rather than something wanted in future. */
export function ruleNotKept(sentence: string): boolean {
  if (!SHOULD.test(sentence) || !NOT_KEPT.test(sentence)) return false;
  // Another word about the future than "should" keeps it a wish.
  return !WANTED_CUES.some(re => !re.test('should') && re.test(sentence));
}

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
