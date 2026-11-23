// Closing questions from the Assessment stage (package 16 of docs/next-plan.md, section 3g): the line
// that counts the open questions that could change the recommendation, which questions it means, what a
// meeting closed, and who to ask about what is left. Pure rules over the triage; nothing is closed or
// changed here. Package B's Discovery summary calls `meetingResult` and `whoToAsk` too.
import type { ProcessModel } from '../processModel/types.ts';
import type { ProcessAssessment } from '../assess/process.ts';
import { assessProcess } from '../assess/process.ts';
import { approvalCounts } from './approvalCounts.ts';
import { GROUP_LABEL, groupLabel, OWNER_LABEL, triage, type QGroup, type QOwner, type TriageItem } from './triage.ts';

/**
 * The questions the Assessment stage's line counts: those that could change the recommendation and are
 * not left with a named person. A question set aside with no name is still counted: nobody has it.
 */
export const couldChange = (i: TriageItem): boolean => groupLabel(i) === GROUP_LABEL.decides && !i.assignedTo;

export interface AssessmentLine { n: number; text: string }

/**
 * The line under "What would sharpen this most": N is `approvalCounts`' open questions less those left
 * with someone. Null when there is nothing to count, for a process documented as it is, and for one whose
 * approach is decided (its questions settle the decided approach, not the recommendation).
 */
export function assessmentLine(model: ProcessModel, assessment: ProcessAssessment): AssessmentLine | null {
  const c = approvalCounts(model, assessment);
  if (!c || c.group !== GROUP_LABEL.decides) return null;
  const n = c.open - c.leftWithSomeone;
  if (n <= 0) return null;
  return { n, text: `${n} open ${n === 1 ? 'question' : 'questions'} could change the recommendation` };
}

/** The words over the focused list in Closing the gaps. */
export const focusedLine = (n: number): string => (n === 1 ? 'Showing the 1 that could change the recommendation' : `Showing the ${n} that could change the recommendation`);

const GROUP_ORDER: Record<QGroup, number> = { decides: 0, signoff: 1, detail: 2 };
const OWNER_ORDER = Object.keys(OWNER_LABEL) as QOwner[];

export interface AskItem { key: string; question: string; group: string; decisive: boolean; /** The name typed under "Ask someone later", when it is left with someone. */ leftWith: string | null }
export interface AskGroup { owner: QOwner; label: string; items: AskItem[] }

/**
 * Who to ask about what is open: the three kinds of person in the question files' order, the most
 * decisive first in each, each question with the name it is left with. Groups with nothing are left out.
 * Written so that the question files (domain/questions/packs.ts) could take their grouping from it.
 */
export function whoToAsk(items: TriageItem[]): AskGroup[] {
  return OWNER_ORDER.map(owner => ({
    owner, label: OWNER_LABEL[owner],
    items: items.filter(i => i.owner === owner)
      .map((i, n) => ({ i, n }))
      .sort((a, b) => GROUP_ORDER[a.i.group] - GROUP_ORDER[b.i.group] || a.n - b.n)
      .map(({ i }) => ({ key: i.key, question: i.question, group: groupLabel(i), decisive: i.group === 'decides', leftWith: i.assignedTo })),
  })).filter(g => g.items.length);
}

export interface MeetingResult {
  /** Open before: the questions being asked (not those left with someone). */
  open: number;
  /** Of those, the ones no longer open after. A question set aside for someone is not closed. */
  closed: number;
  /** What is open after, everything, those left with someone included. */
  left: AskGroup[];
  /** "{N} of {M} open questions closed". */
  text: string;
}

/**
 * What a meeting, a transcript or a returned question file closed: two models, each read by its own
 * triage, so it does not depend on what a screen held. Assessments may be passed when already worked out.
 */
export function meetingResult(before: ProcessModel, after: ProcessModel, assessments?: { before?: ProcessAssessment; after?: ProcessAssessment }): MeetingResult {
  const was = triage(before, assessments?.before ?? assessProcess(before)).items.filter(i => !i.deferred);
  const now = triage(after, assessments?.after ?? assessProcess(after)).items;
  // A question found by rule that is set aside becomes a stored question with a new key: matched by its words and target.
  const same = (a: TriageItem, b: TriageItem) => a.key === b.key || (a.question === b.question && JSON.stringify(a.target) === JSON.stringify(b.target));
  const closed = was.filter(i => !now.some(x => same(i, x))).length;
  return { open: was.length, closed, left: whoToAsk(now), text: `${closed} of ${was.length} open ${was.length === 1 ? 'question' : 'questions'} closed` };
}
