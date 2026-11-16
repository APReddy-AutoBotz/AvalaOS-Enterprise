// Looking in the sources without being asked (docs/effort-first-plan.md, part D): before a question is
// put to people, Avala OS looks for its answer in the process's own sources, with the existing
// `answerFromNotes` task (the one "Look in the sources" runs), within a fixed limit per look. Only values
// a passage states outright come back, as suggestions a person confirms (`answerSuggestions`); nothing is
// recorded by the look itself. A question is looked up once per set of sources: answering one question
// does not start another look, adding or archiving a source does.
//
// A look cut short (docs/next-plan.md, package 2): when the page is left or reloaded during a call, the
// server still finishes and counts it, but the answer is lost. So before each call the browser notes
// which questions went and when (`noteSent`). While a call is less than `AUTO_LOOK.waitMs` old and
// unanswered, a page that opens sends nothing (the answer may still come to another page, or was lost);
// after that wait the questions go once more (`repeats`), and never a third time on their own. "Look in
// the sources" on the Suggestions tab always looks, as a person asked for it.
import { answersIt, type Suggestion } from './suggest.ts';
import { decisive, weightOf } from '../questions/firstList.ts';
import type { Triage, TriageItem } from '../questions/triage.ts';

/**
 * The limit of one look: at most `batches` calls of `perBatch` questions each, every call with at most
 * `SUGGEST_LIMITS.passages` passages (about 15,000 tokens a call on the sample). Questions that could
 * change the recommendation go first.
 */
export const AUTO_LOOK = { perBatch: 12, batches: 3, waitMs: 3 * 60_000, repeats: 1 } as const;

/** The limit of a look; the wait and the repeats apply only when Avala OS looks on its own. */
export interface LookLimit { perBatch: number; batches: number; waitMs?: number; repeats?: number }

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
  /** Questions sent and not answered yet, by key: when they last went (ms) and how many times. */
  sent?: Record<string, { at: number; times: number }>;
  /** When the server said the month's AI allowance is used up (ms). */
  stopped?: number;
}

/** The set of sources, so a change in them starts a new look. */
export const sourcesKey = (sources: { id: string; archived?: boolean }[]) => sources.filter(s => !s.archived).map(s => s.id).sort().join(',');

/**
 * When a page may next look on its own: null when it may now, else the time the wait for an unanswered
 * call ends. Any question sent less than the wait ago and not answered holds the whole look, because
 * another page may still be running it.
 */
export function waitingUntil(look: SourceLook | null, sources: string, now: number, limit: LookLimit = AUTO_LOOK): number | null {
  if (!look || look.sources !== sources || !look.sent) return null;
  const wait = limit.waitMs ?? AUTO_LOOK.waitMs;
  const recent = Object.values(look.sent).map(s => s.at).filter(at => now - at < wait);
  return recent.length ? Math.max(...recent) + wait : null;
}

/**
 * The questions still to look up, in batches, most decisive first; none when every one has been looked
 * up in these sources. On its own (`manual` false) Avala OS sends nothing while an earlier call is
 * within its wait, and leaves out questions already sent the first time and once more.
 */
export function toLookUp(t: Triage, look: SourceLook | null, sources: string, limit: LookLimit = AUTO_LOOK, now = Date.now(), manual = false): TriageItem[][] {
  const same = Boolean(look && look.sources === sources);
  const looked = new Set(same ? look!.looked : []);
  if (!manual && waitingUntil(look, sources, now, limit) !== null) return [];
  const repeats = limit.repeats ?? AUTO_LOOK.repeats;
  const givenUp = (key: string) => !manual && same && (look!.sent?.[key]?.times ?? 0) > repeats;
  // A question about the shape of the flow is fixed in the Process stage; no passage answers it.
  const open = t.items.filter(i => !i.deferred && !looked.has(i.key) && !givenUp(i.key) && i.target.kind !== 'gateway');
  const first = open.filter(decisive).map((i, n) => ({ i, n })).sort((a, b) => weightOf(b.i) - weightOf(a.i) || a.n - b.n).map(x => x.i);
  const order = [...first, ...open.filter(i => !decisive(i))].slice(0, limit.perBatch * limit.batches);
  const out: TriageItem[][] = [];
  for (let k = 0; k < order.length; k += limit.perBatch) out.push(order.slice(k, k + limit.perBatch));
  return out;
}

const fresh = (sources: string): SourceLook => ({ sources, looked: [], found: [], questions: 0, passages: 0, tokens: 0, calls: 0 });

/** The look before a call: its questions noted as sent now, once more than before. */
export function noteSent(look: SourceLook | null, sources: string, items: TriageItem[], now: number): SourceLook {
  const base = look && look.sources === sources ? look : fresh(sources);
  const sent = { ...(base.sent ?? {}) };
  for (const i of items) sent[i.key] = { at: now, times: (sent[i.key]?.times ?? 0) + 1 };
  return { ...base, sent };
}

/** The look once the server says the month's AI allowance is used up. */
export function noteStopped(look: SourceLook | null, sources: string, now: number): SourceLook {
  const base = look && look.sources === sources ? look : fresh(sources);
  return { ...base, stopped: now };
}

/** Whether the allowance was found used up this calendar month (UTC, as the server counts it). */
export function allowanceStopped(look: SourceLook | null, now: number): boolean {
  if (!look?.stopped) return false;
  const a = new Date(look.stopped), b = new Date(now);
  return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth();
}

/** Whether a failed call means the month's AI allowance is used up (`journey-ai`: 429, BUDGET_EXCEEDED). */
export const allowanceUsedUp = (e: unknown): boolean => {
  const x = e as { status?: number; message?: string } | null;
  return Boolean(x && (x.status === 429 || /AI allowance for the month/i.test(String(x.message ?? ''))));
};

/** The look after one call: its questions marked as looked up, its answers kept (one per question), its cost added. */
export function addLook(look: SourceLook | null, sources: string, run: { items: TriageItem[]; found: Suggestion[]; passages: number; tokens: number }): SourceLook {
  const base: SourceLook = look && look.sources === sources ? look : fresh(sources);
  const keys = new Set(run.items.map(i => i.key));
  // Answered: no longer waiting.
  const sent = Object.fromEntries(Object.entries(base.sent ?? {}).filter(([k]) => !keys.has(k)));
  const answered = (s: Suggestion) => (s.target.kind === 'answer' ? s.target.itemKey : '');
  return {
    sources,
    looked: [...new Set([...base.looked, ...keys])],
    found: [...base.found.filter(s => !keys.has(answered(s))), ...run.found],
    questions: base.questions + run.items.length,
    passages: base.passages + run.passages,
    tokens: base.tokens + run.tokens,
    calls: base.calls + 1,
    ...(Object.keys(sent).length ? { sent } : {}),
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
export function lookSummary(look: SourceLook | null, found: number, now = Date.now()): string | null {
  // Said once, in place of a silent stop.
  if (allowanceStopped(look, now)) return `Avala OS stopped looking in your sources for answers: this workspace has used its AI allowance for the month. It looks again next month, or when someone presses "Look in the sources" on the Suggestions tab${look!.calls ? `; the ${found} ${found === 1 ? 'answer' : 'answers'} found so far ${found === 1 ? 'is' : 'are'} kept` : ''}.`;
  if (!look || look.calls === 0) return null;
  const tokens = look.tokens ? `, about ${Math.round(look.tokens / 1000).toLocaleString('en-GB')} thousand tokens` : '';
  return `Avala OS looked for ${look.questions} ${look.questions === 1 ? 'answer' : 'answers'} in your sources (${look.passages} ${look.passages === 1 ? 'passage' : 'passages'} read with AI${tokens}) and found ${found} to confirm.`;
}
