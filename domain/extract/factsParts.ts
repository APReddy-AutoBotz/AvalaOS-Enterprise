// The facts merge in parts, so each answer stays well within the length one reply may have. Pure: no I/O.
//
// Every list the facts merge returns refers only to candidate ids (numbered once for the whole reading)
// and to the names of roles and applications from the flow merge; no list points at a group in another
// list. So the lists can be asked for in separate answers and joined into one MergeFactsOutput, which
// assembly reads as before. Conflicts and questions draw on every kind of candidate (a conflict often
// sets a rule against a figure), so the answer that finds them sees the whole facts listing; grouping a
// kind needs only that kind.
//
// First: three answers (rules and exceptions; interfaces and figures; conflicts and questions). An
// answer that is cut off, or times out twice, is asked again one kind at a time. A single kind that is
// still cut off stops the reading with a plain message (failure.ts). The extraction check may start at
// one kind per answer, to show that path on a real provider; a process reading never does.

import type { MergeFactsOutput } from './assemble.ts';
import type { CandidateKind } from './candidates.ts';
import type { FailureCode, Usage } from './failure.ts';

export type FactsKind = 'rules' | 'exceptions' | 'interfaces' | 'metrics' | 'conflicts' | 'questions';
/** The order of the joined answer: the order assembly gives out ids. */
export const FACTS_ORDER: readonly FactsKind[] = ['rules', 'exceptions', 'interfaces', 'metrics', 'conflicts', 'questions'];

export interface FactsPart {
  /** The kinds this answer returns. */
  kinds: FactsKind[];
  /** The answers it is split into when it is too long; none for a single kind. */
  children: string[];
}

export const FACTS_PARTS: Readonly<Record<string, FactsPart>> = {
  'rules-exceptions': { kinds: ['rules', 'exceptions'], children: ['rules', 'exceptions'] },
  'interfaces-metrics': { kinds: ['interfaces', 'metrics'], children: ['interfaces', 'metrics'] },
  'conflicts-questions': { kinds: ['conflicts', 'questions'], children: ['conflicts', 'questions'] },
  rules: { kinds: ['rules'], children: [] },
  exceptions: { kinds: ['exceptions'], children: [] },
  interfaces: { kinds: ['interfaces'], children: [] },
  metrics: { kinds: ['metrics'], children: [] },
  conflicts: { kinds: ['conflicts'], children: [] },
  questions: { kinds: ['questions'], children: [] },
};

/** Where the facts merge starts: three answers, or (the extraction check only) one answer per kind. */
export type FactsStart = 'pairs' | 'kinds';
export const startParts = (start: FactsStart = 'pairs'): string[] =>
  (start === 'kinds' ? [...FACTS_ORDER] : ['rules-exceptions', 'interfaces-metrics', 'conflicts-questions']);

export const isFactsPart = (name: unknown): name is string => typeof name === 'string' && Object.hasOwn(FACTS_PARTS, name);

/** The run's start for the facts merge. Only an extraction check may start at one kind per answer. */
export function factsStartFor(runKind: 'process' | 'eval', requested: unknown): { start: FactsStart } | { refused: string } {
  if (requested === undefined || requested === null || requested === false) return { start: 'pairs' };
  if (requested !== true) return { refused: 'startAtKinds is true or left out.' };
  if (runKind !== 'eval') return { refused: 'Only an extraction check may start the facts merge one kind at a time.' };
  return { start: 'kinds' };
}

const KIND_OF: Record<FactsKind, CandidateKind | null> = {
  rules: 'rule', exceptions: 'exception', interfaces: 'interface', metrics: 'metric', conflicts: null, questions: null,
};

/** The candidate sections an answer sees: its own kinds, or every kind when it finds conflicts or questions. */
export function listingKinds(part: string): CandidateKind[] | null {
  const kinds = FACTS_PARTS[part].kinds;
  if (kinds.some(k => KIND_OF[k] === null)) return null;
  return kinds.map(k => KIND_OF[k]!);
}

/**
 * What to do when an answer fails: the answers to ask instead, or null to stop. A cut-off answer is
 * split; so is one that timed out a second time (the first time-out is tried again as it is). A single
 * kind is never split.
 */
export function splitAfter(part: string, code: FailureCode, retried: boolean): string[] | null {
  const children = FACTS_PARTS[part]?.children ?? [];
  if (!children.length) return null;
  if (code === 'TRUNCATED') return children;
  if (code === 'TIMEOUT' && retried) return children;
  return null;
}

/** A stored answer. */
export interface FactsAnswer { data: Partial<MergeFactsOutput>; usage: Usage; ms?: number }
/** A stored note that an answer was replaced by smaller ones, with the tokens the failed answer used. */
export interface FactsSplit { splitInto: string[]; reason: FailureCode; usage: Usage; ms?: number }
export type FactsStored = FactsAnswer | FactsSplit;

export const isSplit = (x: unknown): x is FactsSplit => Boolean(x && typeof x === 'object' && Array.isArray((x as FactsSplit).splitInto));
const isAnswer = (x: unknown): x is FactsAnswer => Boolean(x && typeof x === 'object' && (x as FactsAnswer).data && typeof (x as FactsAnswer).data === 'object');

/**
 * Which answers are in, from what is stored (keyed by part name). Split notes are followed to the answers
 * that replaced them. Complete when every answer the merge now needs is stored.
 */
export function factsProgress(start: FactsStart, stored: Readonly<Record<string, unknown>>): { complete: boolean; leaves: string[]; missing: string[] } {
  const leaves: string[] = [];
  const walk = (name: string, depth: number) => {
    const s = stored[name];
    if (isSplit(s) && depth < 2) { for (const c of s.splitInto.filter(isFactsPart)) walk(c, depth + 1); return; }
    leaves.push(name);
  };
  for (const p of startParts(start)) walk(p, 0);
  const missing = leaves.filter(n => !isAnswer(stored[n]));
  return { complete: missing.length === 0, leaves, missing };
}

/** One answer from the parts, each kind from the answer that owns it, in the order assembly expects. */
export function joinFacts(leaves: readonly string[], stored: Readonly<Record<string, unknown>>): MergeFactsOutput {
  const out = {} as Record<FactsKind, unknown[]>;
  for (const kind of FACTS_ORDER) {
    const owner = leaves.find(n => FACTS_PARTS[n]?.kinds.includes(kind));
    const answer = owner ? stored[owner] : undefined;
    const list = isAnswer(answer) ? (answer.data as Record<string, unknown>)[kind] : undefined;
    out[kind] = Array.isArray(list) ? list : [];
  }
  return out as unknown as MergeFactsOutput;
}

/** The kinds an answer returns, taken from a whole answer (for tests and fakes). */
export function pick(part: string, whole: MergeFactsOutput): Partial<MergeFactsOutput> {
  return Object.fromEntries(FACTS_PARTS[part].kinds.map(k => [k, whole[k]])) as Partial<MergeFactsOutput>;
}
