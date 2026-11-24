// The browser tests' stand-in for the AI server (package 16 of docs/next-plan.md). A test gives replies
// by task name before the page loads:
//
//   await page.addInitScript(r => { (window as any).__avalaStandIns = r; }, { answerFromNotes: [reply] });
//
// and reads what was asked from window.__avalaStandInLog. Only a test build reaches this file
// (__AVALA_STAND_INS__, set by vite.config.ts when VITE_JOURNEY_STORE is "memory"); the released build
// leaves it out, which `node scripts/check-no-stand-ins.mjs dist` checks after `npm run build`.
// The rules (which calls are answered, which refused) are domain/ai/standIn.ts.
import type { Segment } from '../../domain/ai/gateway.ts';
import { standInRefusal, standInReply, standInTranscript, TRANSCRIBE, type StandInReplies } from '../../domain/ai/standIn.ts';
import { StoreError } from './types.ts';

export interface StandInCall { task: string; answered: boolean; why?: string }
export interface StandIn { run(task: string, segments: Segment[]): { data: unknown }; transcribe(): string }

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
      log.push(why ? { task, answered: false, why } : { task, answered: true });
      if (why) throw new StoreError(501, why);
      return { data: standInReply(replies, used, task) };
    },
    transcribe() {
      const heard = standInTranscript(replies, used);
      log.push('text' in heard ? { task: TRANSCRIBE, answered: true } : { task: TRANSCRIBE, answered: false, why: heard.refused });
      if (!('text' in heard)) throw new StoreError(501, heard.refused);
      return heard.text;
    },
  };
}
