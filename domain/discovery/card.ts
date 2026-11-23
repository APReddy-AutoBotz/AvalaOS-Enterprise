// A Discovery question card (package B, plan `claude/package-b-plan-23-nov.md`, sections 3 and 6): one
// question at a time, each showing where it came from (the words that raised it, a named gap, or the two
// sides of a conflict) and what the answer updates. A card with neither an origin nor a target is never
// built: `makeCard` returns null, and a test fails if one is shown.
import type { ElementTarget, RaisedBy, SourceRef } from '../processModel/types.ts';

/**
 * Where a card sits in the session, which is also its heading:
 * - start: what is wanted from the process and whether the work is done today, asked first when not answered;
 * - shape: the shape of the process (what starts it, the steps, who does each, in which application, what ends it);
 * - conflict: two sources, or a source and a person, disagree;
 * - decides / settles / signoff: the triage's own groups;
 * - said: a question raised from what a person said;
 * - input: an input the assessment's Inputs view lists as most useful next.
 */
export type CardGroup = 'start' | 'shape' | 'conflict' | 'decides' | 'settles' | 'signoff' | 'said' | 'input';

export const GROUP_HEADING: Record<CardGroup, string> = {
  start: 'Needed for the draft', shape: 'Needed for the draft', conflict: 'Sources disagree',
  decides: 'Changes the recommendation', settles: 'Settles the decided approach', signoff: 'Needed for sign-off',
  said: 'About what you said', input: 'Sharpens the assessment',
};

export type CardOrigin =
  | { kind: 'quote'; quote: RaisedBy; sourceTitle?: string }
  | { kind: 'gap'; gap: string }
  | { kind: 'conflict'; conflictId: string; values: { value: string; quote: SourceRef }[] };

/**
 * How the card is answered:
 * - waits: words kept with the session; they change nothing until the draft is updated from the answers;
 * - words: words read into a value (a role or application on the list, a figure) and written on Save;
 * - field: a field like the Inputs view's, written on Save (see inputs.ts);
 * - choose: one of the conflict's values, or one of the listed answers.
 */
export type AnswerWay = 'waits' | 'words' | 'field' | 'choose';

export interface Card {
  /** Stable while the question is open; the same inputs give the same keys. */
  key: string;
  group: CardGroup;
  origin: CardOrigin;
  question: string;
  why: string;
  target: ElementTarget;
  /** What the answer updates, in words. */
  updates: string[];
  answer: AnswerWay;
  /** The triage item it stands for, when there is one: the existing answer writes it. */
  itemKey?: string;
  /** The input it asks, for an input card (inputs.ts). */
  inputId?: string;
  /** The answers to choose from, for "choose". */
  choices?: [string, string][];
}

const MAX_QUESTION = 200;

/** Whether the card says where it came from: words verbatim with where they are, a named gap, or two quoted sides. */
export function hasOrigin(o: CardOrigin | null | undefined): boolean {
  if (!o) return false;
  if (o.kind === 'quote') return o.quote.excerpt.trim().length > 0 && Boolean(o.quote.sourceId?.trim() || o.quote.answerTo?.trim());
  if (o.kind === 'gap') return o.gap.trim().length > 0;
  return o.values.length >= 2 && o.values.every(v => v.value.trim() && v.quote.excerpt.trim() && v.quote.sourceId.trim());
}

const hasTarget = (t: ElementTarget | null | undefined) => Boolean(t && t.kind && (t.kind === 'meta' ? t.field : t.id));

/** A card, or null when it would show neither where it came from nor what it updates, or has no question. */
export function makeCard(c: Omit<Card, 'question'> & { question: string }): Card | null {
  const question = c.question.trim();
  if (!question || question.length > MAX_QUESTION || !hasOrigin(c.origin) || !hasTarget(c.target)) return null;
  return { ...c, question, why: c.why.trim() };
}

/** The words a card shows for where it came from. */
export function originLine(o: CardOrigin): string {
  if (o.kind === 'gap') return `Missing: ${o.gap}`;
  if (o.kind === 'quote') return `You said: “${o.quote.excerpt}”${o.sourceTitle ? ` (${o.sourceTitle})` : ''}`;
  return o.values.map(v => `${v.quote.sourceId}: “${v.quote.excerpt}”`).join(' · ');
}
