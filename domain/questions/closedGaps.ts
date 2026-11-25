// A gap a person closed stays closed (package B, pull request 5a; owner's decision of 25 November 2026, option B).
// A gap found by rule (no one recorded for a step, no application, a figure with no value, an exception with no
// route…) stays in the model when a person answers its question without a value, "Not applicable to this process."
// for example. Until now the question rules listed it again as open. Now a gap is closed while a stored question on
// the same target is answered, and it opens again only when a person reopens that question (`reopenQuestions`): no
// rule guesses that the step changed. A question left with someone already covered its gap, as before.
// Read by the question rules (triage), the Questions tab's counts, Closing the gaps and the PDD and BRD's open items.
import type { ElementTarget, OpenQuestion, ProcessModel } from '../processModel/types.ts';
import { askedOpenQuestions, gaps, untrackedGaps, type Gap } from '../processModel/selectors.ts';

const same = (a: ElementTarget, b: ElementTarget) => a.kind === b.kind && (a.id ?? '') === (b.id ?? '') && (a.field ?? '') === (b.field ?? '');

/** The answered stored question that closes a gap on this target, if any. */
export const closingQuestion = (m: ProcessModel, target: ElementTarget): OpenQuestion | undefined =>
  m.openQuestions.find(q => q.status === 'answered' && same(q.target, target));

/** Whether a person closed the gap on this target. */
export const closedByPerson = (m: ProcessModel, target: ElementTarget): boolean => Boolean(closingQuestion(m, target));

/** The exception-route target, which is a gap of its own (triage asks who handles an exception with no route). */
const routeTarget = (id: string): ElementTarget => ({ kind: 'exception', id, field: 'routedToRoleId' });

/**
 * Every gap still in the model that a person closed, with the question that closed it: for Closing the gaps' "not
 * asked again" list, where each can be reopened.
 */
export function closedGaps(m: ProcessModel): { label: string; target: ElementTarget; question: OpenQuestion }[] {
  const found: { label: string; target: ElementTarget }[] = [
    ...gaps(m).filter(g => g.kind !== 'system_access_unknown' && g.kind !== 'unsourced_assumption').map(g => ({ label: g.label, target: g.target })),
    ...m.exceptions.filter(e => !e.routedToRoleId).map(e => ({ label: `Who handles the exception "${e.name}"?`, target: routeTarget(e.id) })),
  ];
  return found.flatMap(g => { const q = closingQuestion(m, g.target); return q ? [{ ...g, question: q }] : []; });
}

/** The gaps a document lists as open: those no person closed. */
export const openGapsOf = (m: ProcessModel, all: readonly Gap[] = gaps(m)): Gap[] => all.filter(g => !closedByPerson(m, g.target));

/** The gaps no open question covers and no person closed: the Questions tab's "missing" list. */
export const untrackedOpenGaps = (m: ProcessModel): Gap[] => untrackedGaps(m).filter(g => !closedByPerson(m, g.target));

/** Every open item as recorded (the Questions tab's "N in all"): open questions asked, and gaps no one tracks or closed. */
export const openItemsNow = (m: ProcessModel): number => askedOpenQuestions(m).length + untrackedOpenGaps(m).length;
