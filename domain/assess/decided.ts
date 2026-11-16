// An approach decided for the whole process (docs/next-plan.md, package 9), summed up from the assessment
// for the line at the top of Documents, the list behind it, the documents and the evidence pack. A step
// the approach can do; a step where it is not known yet, with the questions that would settle it; a step
// it cannot do, with what holds it back; a step a person set themselves; a step a system already does.
import type { DecidedApproach, ProcessModel } from '../processModel/types.ts';
import { orderedSteps } from '../processModel/selectors.ts';
import { APPROACH_LABEL, type Approach, type DecidedQuestion } from './scoring.ts';
import type { ProcessAssessment } from './process.ts';

export interface DecidedStep { stepId: string; no: number; name: string; reason: string; questions: DecidedQuestion[]; approach: Approach }
export interface DecidedSummary {
  decided: DecidedApproach;
  label: string;
  can: DecidedStep[];
  /** Not settled: the approach falls short only on facts nobody has given yet. */
  unknown: DecidedStep[];
  cannot: DecidedStep[];
  /** A person set the step's approach themselves; it comes first. */
  person: DecidedStep[];
  already: DecidedStep[];
  /** The questions that would settle the steps not known yet, once each, most steps first. */
  questions: { question: DecidedQuestion; steps: number[] }[];
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const day = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }); };

export function decidedSummary(m: ProcessModel, a: ProcessAssessment): DecidedSummary | null {
  const decided = m.meta.decidedApproach;
  if (!decided) return null;
  const order = orderedSteps(m);
  const out: DecidedSummary = { decided, label: APPROACH_LABEL[decided.approach], can: [], unknown: [], cannot: [], person: [], already: [], questions: [] };
  const byKey = new Map<string, { question: DecidedQuestion; steps: number[] }>();
  for (const s of a.steps) {
    const i = order.findIndex(x => x.id === s.stepId);
    const row: DecidedStep = { stepId: s.stepId, no: i + 1, name: order[i]?.name ?? s.stepId, reason: s.reason, questions: s.decided?.questions ?? [], approach: s.winner };
    if (s.alreadyAutomated || s.decided?.status === 'already') { out.already.push(row); continue; }
    if (s.decided?.person) { out.person.push(row); continue; }
    if (s.decided?.status === 'can') out.can.push(row);
    else if (s.decided?.status === 'unknown') {
      out.unknown.push(row);
      for (const q of row.questions) {
        // An application's question is the same for every step that uses it.
        const k = q.target.kind === 'trait' ? q.key : `${q.target.kind}:${(q.target as { systemId: string }).systemId}`;
        const cur = byKey.get(k) ?? { question: q, steps: [] };
        cur.steps.push(row.no);
        byKey.set(k, cur);
      }
    } else out.cannot.push(row);
  }
  for (const list of [out.can, out.unknown, out.cannot, out.person, out.already]) list.sort((x, y) => x.no - y.no);
  out.questions = [...byKey.values()].sort((x, y) => y.steps.length - x.steps.length);
  return out;
}

/** Who decided and when, in words: a name where the record holds one, never an email address. */
export function decidedBy(d: DecidedApproach, names: Record<string, string> = {}): string {
  const who = d.by && names[d.by] && !names[d.by].includes('@') ? names[d.by] : null;
  const when = day(d.at);
  return `${who ? `by ${who}` : 'by a person whose name is not recorded'}${when ? ` on ${when}` : ''}`;
}

/** The line at the top of Documents: the approach, who decided, and the steps it can do and those that stay with people. */
export function decidedLine(s: DecidedSummary, names: Record<string, string> = {}): string {
  const people = s.cannot.length + s.unknown.length;
  const parts = [
    `${s.label}, decided ${decidedBy(s.decided, names)}: "${s.decided.reason}".`,
    `It can do ${plural(s.can.length, 'step', 'steps')}.`,
    s.unknown.length ? `For ${plural(s.unknown.length, 'step', 'steps')} it is not known yet: ${plural(s.questions.length, 'question settles', 'questions settle')} ${s.unknown.length === 1 ? 'it' : 'them'}.` : '',
    s.cannot.length ? `${plural(s.cannot.length, 'step stays', 'steps stay')} with people because it cannot do ${s.cannot.length === 1 ? 'it' : 'them'}.` : '',
    s.person.length ? `A person set ${plural(s.person.length, 'step', 'steps')} themselves.` : '',
  ].filter(Boolean);
  void people;
  return parts.join(' ');
}

/** In a document, where today it says "recommended": who decided, when and why. */
export const decidedSentence = (s: DecidedSummary, names: Record<string, string> = {}) =>
  `${s.label} was decided for the whole process ${decidedBy(s.decided, names)}, because: "${s.decided.reason.replace(/[.\s]+$/, '')}".`;
