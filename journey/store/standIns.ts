// The browser tests' stand-in for the AI server (package 16 of docs/next-plan.md). A test gives replies
// by task name before the page loads:
//
//   await page.addInitScript(r => { (window as any).__avalaStandIns = r; }, { answerFromNotes: [reply] });
//
// and reads what was asked from window.__avalaStandInLog. A reply `{ standInError: { status, code, message } }` is
// thrown as the server's refusal with that code. Only a test build reaches this file
// (__AVALA_STAND_INS__, set by vite.config.ts when VITE_JOURNEY_STORE is "memory"); the released build
// leaves it out, which `node scripts/check-no-stand-ins.mjs dist` checks after `npm run build`.
// The rules (which calls are answered, which refused) are domain/ai/standIn.ts.
import type { Segment } from '../../domain/ai/gateway.ts';
import { EXTRACTION, standInReading, standInRefusal, standInReply, standInTranscript, TRANSCRIBE, type ReadSources, type StandInReplies } from '../../domain/ai/standIn.ts';
import { StoreError } from './types.ts';

export interface StandInCall { task: string; answered: boolean; why?: string; sources?: ReadSources[]; /** Noticing (5b): the person's words it was given, segment by segment. */ said?: string[] }
export interface StandIn { run(task: string, segments: Segment[]): { data: unknown }; transcribe(): string; read(sources: ReadSources[]): unknown }

interface PageGlobals { __avalaStandIns?: StandInReplies; __avalaStandInLog?: StandInCall[] }

/** The stand-in when the test gave replies before the page loaded; otherwise undefined, and the store has no AI as before. */
export function standInFromPage(): StandIn | undefined {
  const page = globalThis as unknown as PageGlobals;
  const replies = page.__avalaStandIns;
  if (!replies || typeof replies !== 'object') return undefined;
  const log: StandInCall[] = (page.__avalaStandInLog = []);
  const used: Record<string, number> = {};
  return {
    run(task, segments) {
      const why = standInRefusal(replies, task, segments);
      const said = task === 'discoveryQuestions' ? { said: segments.filter(x => x.id.startsWith('n:')).map(x => x.text) } : {};
      log.push(why ? { task, answered: false, why, ...said } : { task, answered: true, ...said });
      if (why) throw new StoreError(501, why);
      const data = standInReply(replies, used, task);
      // A reply `{ standInError: { status, code, message } }` stands for the server refusing with its own code: the
      // month's allowance (BUDGET_EXCEEDED) or the minute limit (RATE_LIMITED), for the call panel's lines (package C).
      const refused = (data as { standInError?: { status: number; code: string; message: string } } | null)?.standInError;
      if (refused) throw new StoreError(refused.status, refused.message, refused.code);
      return { data };
    },
    read(sources) {
      const r = standInReading(replies, used);
      log.push('model' in r ? { task: EXTRACTION, answered: true, sources } : { task: EXTRACTION, answered: false, why: r.refused, sources });
      if (!('model' in r)) throw new StoreError(501, r.refused);
      return r.model;
    },
    transcribe() {
      const heard = standInTranscript(replies, used);
      log.push('text' in heard ? { task: TRANSCRIBE, answered: true } : { task: TRANSCRIBE, answered: false, why: heard.refused });
      if (!('text' in heard)) throw new StoreError(501, heard.refused);
      return heard.text;
    },
  };
}
