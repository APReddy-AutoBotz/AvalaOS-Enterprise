// The stand-in for AI tasks in browser tests (package 16 of docs/next-plan.md): replies a test gives,
// one list per task name, used in order (the last one repeats). Only in a test build: the in-browser
// store gets it from journey/store/standIns.ts, which the released build leaves out (a check after
// `npm run build` fails if it is there). Package B adds replies for its own tasks here, not a second one.
import type { Segment } from './gateway.ts';

/** Replies by task name, as the server's `data` would be. */
export type StandInReplies = Record<string, unknown[]>;

/** Segments from this source are what a person said or wrote; any other source is a source's passages. */
export const PERSON_SOURCE = 'answers';

/**
 * Why the stand-in does not answer this call, or null when it does. It answers only the tasks the test
 * gave replies for, and never a call carrying source passages: the automatic look in the sources asks the
 * same task with them, and must not be answered by what the test meant for a person's notes.
 */
export function standInRefusal(replies: StandInReplies, task: string, segments: Segment[]): string | null {
  if (!Object.hasOwn(replies, task) || !replies[task]!.length) return `The stand-in has no reply for ${task}.`;
  const sources = [...new Set(segments.map(s => s.sourceId).filter((s): s is string => Boolean(s) && s !== PERSON_SOURCE))];
  if (sources.length) return `The stand-in answers only what a person said, not passages of ${sources.join(', ')}.`;
  return null;
}

/** The reply list that stands in for turning speech into text: the words a recording is heard as, in order. */
export const TRANSCRIBE = 'transcribe';

/**
 * The words a recording is heard as, or why the stand-in does not answer (a string starting "The stand-in").
 * Only when the test gave words under `transcribe`; the recording itself is never read.
 */
export function standInTranscript(replies: StandInReplies, used: Record<string, number>): { text: string } | { refused: string } {
  if (!Object.hasOwn(replies, TRANSCRIBE) || !replies[TRANSCRIBE]!.length) return { refused: 'The stand-in has no words for a recording.' };
  const reply = standInReply(replies, used, TRANSCRIBE);
  return typeof reply === 'string' ? { text: reply } : { refused: 'The stand-in has no words for a recording.' };
}

/** The next reply for a task, a copy; `used` counts the replies given so far per task. */
export function standInReply(replies: StandInReplies, used: Record<string, number>, task: string): unknown {
  const list = replies[task]!;
  const n = used[task] ?? 0;
  used[task] = n + 1;
  return structuredClone(list[Math.min(n, list.length - 1)]);
}
