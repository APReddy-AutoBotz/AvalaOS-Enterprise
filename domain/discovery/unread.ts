// Answers saved but not read (review of #258, 26 November 2026). "Update the draft from your answers" writes the
// waiting answers as a "Discovery answers" source, takes them out of the session, then starts a reading. When that
// start is refused (a reading of the process already under way, or the hourly limit; domain/extract/startLimit.ts)
// or fails, the answers have left the session but no reading has read them, so the button would count 0 and
// nothing would say so. The session's record of the sources each of its readings read shows which have not been.
import { ANSWERS_KIND } from './answers.ts';
import { sourcesReadBySession, type SessionState } from './session.ts';

export interface SourceFacts { id: string; kind: string; createdAt: string; archived: boolean; segmentCount: number }

/**
 * The "Discovery answers" sources saved since this session started that no reading it started has read, and how
 * many answers they hold (one passage each). The next update reads them with any answers still waiting.
 */
export function unreadAnswers(s: SessionState, sessionStartedAt: string | null | undefined, sources: readonly SourceFacts[]): { ids: string[]; answers: number } {
  if (!sessionStartedAt) return { ids: [], answers: 0 };
  const since = Date.parse(sessionStartedAt);
  const read = sourcesReadBySession(s);
  const left = sources.filter(x => !x.archived && x.kind === ANSWERS_KIND && Date.parse(x.createdAt) >= since && !read.has(x.id));
  return { ids: left.map(x => x.id), answers: left.reduce((n, x) => n + Math.max(1, x.segmentCount), 0) };
}

/** The line on the Discovery tab while answers are saved but not read into the draft. */
export const unreadLine = (n: number) =>
  `${n === 1 ? '1 answer is' : `${n} answers are`} saved but not read into the draft yet: the reading did not start. Update the draft to read ${n === 1 ? 'it' : 'them'}.`;

/**
 * What an update reads: the sources of the last reading, then the answers sources not read yet and the one just
 * written, newest last (`updateSources` keeps the newest at the end); each once.
 */
export function updateReads(base: readonly string[], unread: readonly string[], kept: readonly string[]): string[] {
  const answers = [...new Set([...unread, ...kept])];
  const rest = base.filter(id => !answers.includes(id));
  return [...rest, ...answers];
}
