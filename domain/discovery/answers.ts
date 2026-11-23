// The "Discovery answers" source (package B, plan section 5, changes a and b). Answers about the shape of
// the process wait in the session; "Update the draft from your answers" writes them as one source, which
// the reading then reads with the sources it read before. Each passage is one answer: its text is the
// person's words alone, exactly as they saved them; the question it answers is its place
// (`locator.heading`, "Answer to: …"), never part of its text, so a quote is always the person's words.
import type { IngestSegment } from '../ingest/segment.ts';
import type { ElementTarget, ProcessModel, SourceRef } from '../processModel/types.ts';
import { addQuestion, raiseConflict } from '../processModel/patch.ts';
import type { Op } from '../questions/answer.ts';

/** An answer about the shape of the process, kept in the session until the draft is updated. */
export interface WaitingAnswer {
  /** The person's words, as they saved them (typed, or spoken, transcribed and checked by them). */
  words: string;
  /** The question as Ask Avala asked it. */
  question: string;
  /** When it was saved (ISO time). */
  at: string;
}

export const ANSWERS_KIND = 'Discovery answers';
/** The words before the question in a passage's place. */
export const ANSWER_TO = 'Answer to: ';

/** The first `ans-N` key not used by the process's sources: the key Closing the gaps gives a person's notes. */
export function answersKey(taken: readonly string[]): string {
  let n = 1;
  while (taken.includes(`ans-${n}`)) n++;
  return `ans-${n}`;
}

export interface AnswersSource {
  key: string;
  title: string;
  kind: typeof ANSWERS_KIND;
  segments: IngestSegment[];
}

/**
 * The source the waiting answers become: one passage per answer that has words, in the order given.
 * Null when no answer has words. `date` is the day as the screens write it ("23 Nov 2026").
 */
export function answersSource(waiting: readonly WaitingAnswer[], takenKeys: readonly string[], date: string): AnswersSource | null {
  const given = waiting.filter(a => a.words.trim());
  if (!given.length) return null;
  const key = answersKey(takenKeys);
  return {
    key, title: `${ANSWERS_KIND}, ${date}`, kind: ANSWERS_KIND,
    segments: given.map((a, i) => ({
      id: `${key}:${i + 1}`, sourceId: key, kind: 'paragraph' as const, text: a.words.trim(),
      locator: { heading: `${ANSWER_TO}${a.question.trim()}`, lineStart: i + 1 },
    })),
  };
}

/** The question a passage of an answers source answers, from its place; null for any other passage. */
export const answeredQuestion = (s: Pick<IngestSegment, 'locator'>): string | null =>
  s.locator.heading?.startsWith(ANSWER_TO) ? s.locator.heading.slice(ANSWER_TO.length) : null;

// ---------------------------------------------------------------- an answer against a confirmed value

/** A value a person confirmed for this target, as words, with the sources it keeps; null when the value is not confirmed by a person. */
export function confirmedValue(m: ProcessModel, t: ElementTarget): { value: string; sources: SourceRef[] } | null {
  if (t.kind === 'meta') {
    if (t.field !== 'objective' && t.field !== 'owner') return null;
    const f = m.meta[t.field];
    return f.status === 'user-confirmed' && f.value !== null ? { value: String(f.value), sources: f.sources } : null;
  }
  const list: { id: string; status: string; sources: SourceRef[] }[] = ({
    role: m.roles, system: m.systems, step: m.steps, gateway: m.gateways, rule: m.rules, exception: m.exceptions, metric: m.meta.metrics, data: m.dataObjects,
  } as Record<string, { id: string; status: string; sources: SourceRef[] }[]>)[t.kind] ?? [];
  const el = list.find(x => x.id === t.id) as (Record<string, unknown> & { status: string; sources: SourceRef[] }) | undefined;
  if (!el || el.status !== 'user-confirmed' || !t.field || el[t.field] === undefined || el[t.field] === null) return null;
  const v = el[t.field];
  const named = (id: string) => [...m.roles, ...m.systems, ...m.rules, ...m.exceptions].find(x => x.id === id)?.name ?? id;
  const shown = Array.isArray(v) ? v.map(x => (typeof x === 'string' ? named(x) : JSON.stringify(x))).join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v);
  return shown ? { value: shown, sources: el.sources } : null;
}

/** A value as a sentence ends it: without its own closing full stop. */
const bare = (s: string) => s.trim().replace(/[.\s]+$/, '');
const same = (a: string, b: string) => a.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() === b.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export type AnswerOutcome = { kind: 'write' | 'conflict' | 'question'; op: Op; line: string | null };

/**
 * What saving an answer does when the target may hold a value a person confirmed (owner, 23 November 2026,
 * decision 4): a different answer never overwrites it. With quotes on both sides it records a conflict to
 * resolve on the Process stage; a confirmation with no quote of its own cannot stand in a conflict (each side
 * of one cites its words), so the difference is asked as an open question raised by the answer's words.
 * An answer that agrees, or a target with no confirmed value, writes as answers do today.
 */
export function answerAgainstConfirmed(m: ProcessModel, args: { target: ElementTarget; label: string; said: { value: string; quote: SourceRef }; write: Op }): AnswerOutcome {
  const current = confirmedValue(m, args.target);
  if (!current || same(current.value, args.said.value)) return { kind: 'write', op: args.write, line: null };
  const x = bare(current.value), y = bare(args.said.value);
  const line = `You confirmed earlier: ${x}. Your answer says: ${y}. Saving keeps ${x} and records the difference as a conflict to resolve on the Process stage.`;
  if (current.sources.length) {
    return { kind: 'conflict', line, op: mm => raiseConflict(mm, { target: args.target, summary: `${args.label}: confirmed value differs from an answer`, values: [{ value: current.value, sources: current.sources }, { value: args.said.value, sources: [args.said.quote] }] }) };
  }
  return {
    kind: 'question', line: `You confirmed earlier: ${x}. Your answer says: ${y}. Saving keeps ${x} and asks which is right.`,
    op: mm => addQuestion(mm, { target: args.target, question: `${args.label}: you confirmed "${current.value}"; an answer says "${args.said.value}". Which is right?`.slice(0, 400), whyItMatters: 'A value a person confirmed is never overwritten by an answer.', raisedBy: { excerpt: args.said.quote.excerpt, sourceId: args.said.quote.sourceId, locator: args.said.quote.locator } }),
  };
}
