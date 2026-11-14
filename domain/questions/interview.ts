// The Ask Avala interview (docs/product-plan.md, "Ask Avala: the plan", stage 2). Ask Avala asks a
// process's open questions one at a time, in the order triage gives (what changes the recommendation
// first, then what sign-off needs, then detail), and says why each matters. The person answers in their
// own words. The answer is read by the existing `answerFromNotes` task with this one question: it finds
// the value the question's field takes and quotes the person's words for it, and the gateway drops any
// quote that is not in the answer. Then, by rule here:
//   - a value the person stated is shown as "This will record: …" with their words, and written only
//     when they press Save;
//   - a value only inferred is put back as "Did you mean …?" and written only on a yes;
//   - no value: one follow-up question, by kind, never a guess; after that, nothing is recorded.
// The write is the same edit the Closing the gaps screen makes (`buildAnswer`), with the person's words
// kept in the answer, so each recorded answer shows the words it came from.
import type { ProcessModel } from '../processModel/types.ts';
import type { Segment } from '../ai/gateway.ts';
import { notesSegments, proposalsFrom, type NoteFinding, type Proposal } from './notes.ts';
import { GROUP_LABEL, OWNER_LABEL, type Triage, type TriageItem } from './triage.ts';
import { buildAnswer, type Op } from './answer.ts';

export const INTERVIEW_LIMITS = { answer: 2000 } as const;

/** The questions to ask, in order: open ones first by what they change; deferred ones are with someone else. */
export function interviewQueue(t: Triage): TriageItem[] {
  return t.items.filter(i => !i.deferred);
}

const WHY: Record<TriageItem['group'], string> = {
  decides: 'The answer can change the recommended approach.',
  signoff: 'It is needed before the documents can be signed off.',
  detail: 'It completes the detail of the process.',
};

/** Why a question matters, in a sentence or two, and where its answer lands. */
export function whyItMatters(item: TriageItem): string {
  const lands = item.affects.length ? ` The answer goes into ${listWords(item.affects)}.` : '';
  return `${WHY[item.group]}${lands}`;
}
const listWords = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/** Who should answer, for a person who cannot record answers (a viewer, or an approver who does not edit). */
export function whoCanAnswer(item: TriageItem, analyst: string | null): string {
  const kind = OWNER_LABEL[item.owner];
  return analyst
    ? `${analyst} (the analyst on this process) can record the answer; it usually comes from the ${kind.toLowerCase()}.`
    : `Someone who can edit this process can record the answer; it usually comes from the ${kind.toLowerCase()}.`;
}

/** The answer as the person gave it, tidied and capped; a follow-up answer is added to the first. */
export function interviewAnswer(first: string, followUp = ''): string {
  const clean = (s: string) => s.replace(/\r/g, '').replace(/[ \t]+/g, ' ').trim();
  return [clean(first), clean(followUp)].filter(Boolean).join('\n\n').slice(0, INTERVIEW_LIMITS.answer);
}

/** The segments for the notes task: this one question and the person's answer. */
export function interviewSegments(model: ProcessModel, item: TriageItem, answer: string): { segments: Segment[]; ids: Map<string, string> } {
  return notesSegments(model, [item], answer);
}

/** The one follow-up question when an answer gives no value, by the kind of answer the question needs. */
export function followUpFor(item: TriageItem, model: ProcessModel): string {
  switch (item.kind) {
    case 'role': return `I could not tell which role from that. Which of these does it: ${model.roles.map(r => r.name).join(', ')}?`;
    case 'system': return `I could not tell which application from that. Which of these is used: ${model.systems.map(s => s.name).join(', ')}?`;
    case 'number': return 'I could not find a figure in that. What is the number?';
    case 'access': return `I could not tell from that. For each, can the automation use it, does it exist but is not confirmed for use, or is it not available? ${(item.interfaces ?? []).map(x => x.label).join('; ')}.`;
    default: return `I could not find an answer to record in that. In a sentence: ${item.question}`;
  }
}

export type Reading =
  /** The person stated a value: shown as "This will record: …", written on Save. */
  | { kind: 'record'; proposal: Proposal }
  /** Only inferred: asked back as "Did you mean …?", written only on a yes. */
  | { kind: 'confirm'; proposal: Proposal; question: string }
  /** No value in the first answer: one follow-up. */
  | { kind: 'followUp'; question: string }
  /** No value after the follow-up either: nothing is recorded. */
  | { kind: 'unanswered'; message: string };

/**
 * An answer that says the person does not know ("not sure", "no idea", "I'll have to check with …"),
 * when it is short enough that saying so is all it does. Such an answer is no value, whatever a
 * free-text reading makes of it: "No idea, honestly." is never offered as the answer to record.
 */
const NOT_KNOWN = /\b(?:not sure|unsure|no idea|no clue|(?:do not|don't|dont|do n't) know|not known|can(?:no|')t say|have to (?:check|ask|find out)|need to (?:check|ask|find out)|will (?:check|ask|find out)|i'll (?:check|ask|find out)|ask (?:procurement|it|finance|hr|the|someone|them))\b/i;
export const saysNotKnown = (answer: string) => NOT_KNOWN.test(answer) && answer.trim().split(/\s+/).length <= 20;

export const UNANSWERED = 'I could not find an answer to record, so nothing is recorded. You can skip this question or leave it with the person who knows.';

/**
 * What an answer means for the question, by rule, from the notes task's findings. `attempt` is 1 for
 * the first answer and 2 after the follow-up, so there is never more than one follow-up.
 */
export function readInterview(model: ProcessModel, item: TriageItem, ids: Map<string, string>, findings: NoteFinding[], attempt: 1 | 2, answer: string): Reading {
  const p = saysNotKnown(answer) ? undefined : proposalsFrom(model, [item], ids, findings)[0];
  if (!p) return attempt === 1 ? { kind: 'followUp', question: followUpFor(item, model) } : { kind: 'unanswered', message: UNANSWERED };
  if (p.certainty === 'inferred') return { kind: 'confirm', proposal: p, question: `Did you mean: ${p.display}?` };
  return { kind: 'record', proposal: p };
}

/** "This will record: …", in words. */
export const willRecord = (p: Proposal) => `This will record: ${p.display}`;

/**
 * The edit for a proposal the person accepted: the value written to the question's target and the
 * question closed with the answer and the person's own words, so the record shows where it came from.
 */
export function interviewEdit(model: ProcessModel, item: TriageItem, p: Proposal, from?: string): { op: Op; summary: string } | null {
  const quote = p.quote.replace(/\s+/g, ' ').trim();
  // An answer Ask Avala found in a source keeps the source and its words, and History says who suggested it.
  if (from) {
    const edit = buildAnswer(item, model, p.answer, `from ${from}: "${quote}"`);
    return edit && { op: edit.op, summary: `Suggested by Ask Avala from ${from}; confirmed: ${item.question}` };
  }
  return buildAnswer(item, model, p.answer, `in their words: "${quote}"`);
}

/** The heading over a question: its place and why it is asked first. */
export const questionHeading = (item: TriageItem, position: number, of: number) => `Question ${position} of ${of} · ${GROUP_LABEL[item.group]}`;
