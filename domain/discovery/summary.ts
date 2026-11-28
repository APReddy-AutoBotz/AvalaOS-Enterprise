// Where a discovery session stands (package B, plan sections 1 and 6): when it may end, and the counts
// of the closing summary. The session ends when every question that could change the recommendation (or
// settle the decided approach) is answered, left with someone or not applicable; for a process documented
// as it is, nothing changes a recommendation, so it ends when the shape of the process is settled. The
// summary's "still open, by who to ask" is package 16's grouping (`whoToAsk`), added with the screens.
import type { ProcessModel } from '../processModel/types.ts';
import type { ProcessAssessment } from '../assess/process.ts';
import { purposeOf } from '../plan/purpose.ts';
import { groupLabel, GROUP_LABEL, triage } from '../questions/triage.ts';
import { SETTLES_DECIDED } from '../questions/approvalCounts.ts';
import { askedParts, plainCard, triageCard } from './queue.ts';
import type { Card } from './card.ts';

/**
 * The questions the session must settle before it can end: those of the group that decides that the queue still asks
 * (not answered, left with someone or not applicable, and not asked by a shape card). Only a question a card asks is
 * counted, its own or a plain one (preview walk, 28 November 2026: a question with no card could change the
 * recommendation, so the session could never end and no card was left to answer it). One no card can ask (a question
 * too long for a card) stays open in Closing the gaps.
 */
export function deciding(m: ProcessModel, a: ProcessAssessment): number {
  const purpose = purposeOf(m);
  if (purpose === 'as_is') return 0;
  const group = purpose === 'decided' ? SETTLES_DECIDED : GROUP_LABEL.decides;
  return askedParts(m, triage(m, a)).items.filter(i => groupLabel(i) === group && (triageCard(i, m) ?? plainCard(i, m))).length;
}

/** The shape cards the queue still asks: a gap a person closed or left with someone is not counted (review, 25 November 2026). */
export const shapeToAsk = (m: ProcessModel, a: ProcessAssessment): number => askedParts(m, triage(m, a)).shape.length;

/** Whether the session has reached its end: the shape of the process is settled and nothing that decides is open. */
export const sessionDone = (m: ProcessModel, a: ProcessAssessment): boolean => shapeToAsk(m, a) === 0 && deciding(m, a) === 0;

export interface SessionSummary {
  /** Answers saved in the session. */
  recorded: number;
  /** Words kept to read later (the cap or the allowance reached), not read yet. */
  later: number;
  /** Statements of what should change, kept. */
  wanted: number;
  /** Conflicts still to resolve on the Process stage. */
  conflicts: number;
  /** Questions still open, those left with someone included. */
  open: number;
  done: boolean;
  /** The summary's first line (plan section 6). */
  line: string;
  /** Its closing sentence. */
  closing: string;
}

/**
 * What "still to ask" counts, in the same count as the card's "Question 1 of N" (owner's walk, 28 November 2026: "You
 * stopped with 3 questions still to ask" beside "Question 1 of 7" read as a contradiction). Given the queue the screen
 * shows, the line counts every card in it and says how many of them the session must settle before it can end.
 */
export function stillToAskLine(m: ProcessModel, queue: readonly Card[]): string {
  const purpose = purposeOf(m);
  const must = queue.filter(c => c.group === 'shape' || (purpose !== 'as_is' && (c.group === 'decides' || c.group === 'settles'))).length;
  const n = queue.length;
  const all = `You stopped with ${n} ${n === 1 ? 'question' : 'questions'} still to ask`;
  if (must === n) return `${all}. Carry on whenever you like.`;
  const what = purpose === 'as_is' ? 'about the shape of the process'
    : purpose === 'decided' ? 'about the shape of the process or settle the decided approach'
    : 'about the shape of the process or could change the recommendation';
  if (!must) return `${all}; ${n === 1 ? 'it is not' : 'none of them is'} needed to end the session. Carry on whenever you like.`;
  return `${all}; ${must} of them ${must === 1 ? 'is' : 'are'} ${what}. Carry on whenever you like.`;
}

export function sessionSummary(m: ProcessModel, a: ProcessAssessment, recorded: number, later = 0, queue?: readonly Card[]): SessionSummary {
  const wanted = m.meta.wanted?.length ?? 0;
  const conflicts = m.conflicts.filter(c => !c.resolution).length;
  const open = triage(m, a).items.length;
  const done = sessionDone(m, a);
  const toAsk = deciding(m, a) + shapeToAsk(m, a);
  return {
    recorded, later, wanted, conflicts, open, done,
    line: `Recorded: ${recorded} ${recorded === 1 ? 'answer' : 'answers'}. What you want to change: ${wanted}. Conflicts to resolve: ${conflicts}. Still open: ${open}.${later ? ` Kept to read later: ${later}.` : ''}`,
    closing: done
      ? (purposeOf(m) === 'as_is' ? 'The shape of the process is settled.'
        : purposeOf(m) === 'decided' ? 'Every question that settles the decided approach is answered, left with someone, or not applicable.'
        : 'Every question that could change the recommendation is answered, left with someone, or not applicable.')
      : queue ? stillToAskLine(m, queue)
      : `You stopped with ${toAsk} ${toAsk === 1 ? 'question' : 'questions'} still to ask. Carry on whenever you like.`,
  };
}
