// Looking in the sources without being asked (docs/effort-first-plan.md, part D): before a question is
// put to people, Avala OS looks for its answer in the process's own sources, with the existing
// `answerFromNotes` task (the one "Look in the sources" runs), within a fixed limit per look. Only values
// a passage states outright come back, as suggestions a person confirms (`answerSuggestions`); nothing is
// recorded by the look itself. A question is looked up once per set of sources: answering one question
// does not start another look, adding or archiving a source does.
import { answersIt, type Suggestion } from './suggest.ts';
import { decisive, weightOf } from '../questions/firstList.ts';
import type { Triage, TriageItem } from '../questions/triage.ts';

/**
 * The limit of one look: at most `batches` calls of `perBatch` questions each, every call with at most
 * `SUGGEST_LIMITS.passages` passages (about 15,000 tokens a call on the sample). Questions that could
 * change the recommendation go first.
 */
export const AUTO_LOOK = { perBatch: 12, batches: 3 } as const;

/** What one browser remembers of the looks on one process. */
export interface SourceLook {
  /** The sources the questions were looked up in (`sourcesKey`). */
  sources: string;
  /** Questions already looked up in these sources, by key. */
  looked: string[];
  /** Answers found and not yet recorded or dismissed. */
  found: Suggestion[];
  /** Totals over the looks in these sources, to say what the looking cost. */
  questions: number;
  passages: number;
  tokens: number;
  calls: number;
}

/** The set of sources, so a change in them starts a new look. */
export const sourcesKey = (sources: { id: string; archived?: boolean }[]) => sources.filter(s => !s.archived).map(s => s.id).sort().join(',');

/** The questions still to look up, in batches, most decisive first; none when every one has been looked up in these sources. */
export function toLookUp(t: Triage, look: SourceLook | null, sources: string, limit: { perBatch: number; batches: number } = AUTO_LOOK): TriageItem[][] {
  const looked = new Set(look && look.sources === sources ? look.looked : []);
  // A question about the shape of the flow is fixed in the Process stage; no passage answers it.
  const open = t.items.filter(i => !i.deferred && !looked.has(i.key) && i.target.kind !== 'gateway');
  const first = open.filter(decisive).map((i, n) => ({ i, n })).sort((a, b) => weightOf(b.i) - weightOf(a.i) || a.n - b.n).map(x => x.i);
  const order = [...first, ...open.filter(i => !decisive(i))].slice(0, limit.perBatch * limit.batches);
  const out: TriageItem[][] = [];
  for (let k = 0; k < order.length; k += limit.perBatch) out.push(order.slice(k, k + limit.perBatch));
  return out;
}

/** The look after one call: its questions marked as looked up, its answers kept (one per question), its cost added. */
export function addLook(look: SourceLook | null, sources: string, run: { items: TriageItem[]; found: Suggestion[]; passages: number; tokens: number }): SourceLook {
  const base: SourceLook = look && look.sources === sources ? look : { sources, looked: [], found: [], questions: 0, passages: 0, tokens: 0, calls: 0 };
  const keys = new Set(run.items.map(i => i.key));
  const answered = (s: Suggestion) => (s.target.kind === 'answer' ? s.target.itemKey : '');
  return {
    sources,
    looked: [...new Set([...base.looked, ...keys])],
    found: [...base.found.filter(s => !keys.has(answered(s))), ...run.found],
    questions: base.questions + run.items.length,
    passages: base.passages + run.passages,
    tokens: base.tokens + run.tokens,
    calls: base.calls + 1,
  };
}

/**
 * The answers still worth offering: their question is still open, the person has not dismissed them,
 * and they still pass `answersIt` (checked again here, so answers kept from before a rule changed are
 * held to it too).
 */
export function foundFor(look: SourceLook | null, t: Triage, dismissed: readonly string[] = []): Suggestion[] {
  if (!look) return [];
  const open = new Map(t.items.filter(i => !i.deferred).map(i => [i.key, i]));
  return look.found.filter(s => {
    if (s.target.kind !== 'answer' || dismissed.includes(s.key)) return false;
    const item = open.get(s.target.itemKey);
    return Boolean(item && answersIt(s.target.proposal, item));
  });
}

/** The question keys those answers are for, for `planQuestions`. */
export const foundKeys = (found: Suggestion[]) => new Set(found.flatMap(s => (s.target.kind === 'answer' ? [s.target.itemKey] : [])));

/** What the looking did, in a sentence, from its own counts. */
export function lookSummary(look: SourceLook | null, found: number): string | null {
  if (!look || look.calls === 0) return null;
  const tokens = look.tokens ? `, about ${Math.round(look.tokens / 1000).toLocaleString('en-GB')} thousand tokens` : '';
  return `Avala OS looked for ${look.questions} ${look.questions === 1 ? 'answer' : 'answers'} in your sources (${look.passages} ${look.passages === 1 ? 'passage' : 'passages'} read with AI${tokens}) and found ${found} to confirm.`;
}
