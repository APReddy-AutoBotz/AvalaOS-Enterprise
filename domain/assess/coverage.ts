// When an application's API covers a step (finding F09 of the outside review, package 13 B). An operation the sources or a person list for an API covers a step only when it names the same
// action as the step's name (the same verb, or one of a small table of equal verbs) and the same thing (a
// word in common, whole words, a plural counted as its singular). "Read supplier" no longer covers "Update
// supplier"; a word stem no longer counts. The action is the first word only, so a noun that is also a
// verb ("record", "email") is a thing. A person who confirms an API without listing its operations has
// confirmed it for the whole process, as before.
//
// Before this rule's release one shared word, or the same first five letters, was enough (`looseCovers`, kept
// only to say where the rule now gives a different answer, so nothing changes without a line saying so).

import type { AccessMethod, ProcessModel, Step, SystemRef } from '../processModel/types.ts';

/**
 * Verbs that name the same action, by group: only verbs with one plain meaning (owner, 18 November 2026).
 * A verb left out ("open", "close", "post", "check", "enter", ...) matches only itself, so the question is
 * asked and a person's yes counts. Only the first word of a name or an operation is read as its action.
 */
export const ACTIONS: Record<string, readonly string[]> = {
  create: ['create', 'add', 'register', 'insert'],
  read: ['read', 'get', 'retrieve', 'fetch', 'view'],
  change: ['update', 'change', 'amend', 'edit', 'modify'],
  remove: ['delete', 'remove'],
  approve: ['approve', 'authorise', 'authorize'],
  send: ['send', 'email', 'forward'],
};
const ACTION_OF = new Map(Object.entries(ACTIONS).flatMap(([group, verbs]) => verbs.map(v => [v, group] as const)));

const tokens = (t: string) => t.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean);
/** A plural counted as its singular: invoices → invoice, entries → entry; "process", "status" stay. */
const singular = (w: string) => (w.length > 4 && w.endsWith('ies') ? `${w.slice(0, -3)}y` : w.length > 3 && w.endsWith('s') && !/(ss|us|is)$/.test(w) ? w.slice(0, -1) : w);
const SMALL = new Set(['the', 'and', 'for', 'with', 'from', 'into', 'onto', 'its', 'their', 'our', 'all', 'any', 'one', 'per', 'via', 'new']);

/**
 * The action a text names and the things it names. The action is its first word only (a name and an
 * operation start with their verb: "Update vendor record", "read vendor email"): a word of the action
 * table elsewhere is a thing ("record", "email", "list", "log"), never a second action. A first word
 * outside the table matches only the same word. Things are the other words of three letters or more.
 */
export function partsOf(text: string): { action: string | null; things: Set<string> } {
  const words = tokens(text);
  const things = new Set<string>();
  words.slice(1).forEach(w => { if (w.length >= 3 && !SMALL.has(w)) things.add(singular(w)); });
  const first = words[0];
  return { action: first ? ACTION_OF.get(first) ?? `verb:${first}` : null, things };
}

const plain = (t: string) => tokens(t).join(' ');

/** Whether one listed operation names the same action and the same thing as the step's name (or is the name itself, as a person's yes records it). */
export function operationCovers(operation: string, stepName: string): boolean {
  if (plain(operation) && plain(operation) === plain(stepName)) return true;
  const op = partsOf(operation), st = partsOf(stepName);
  return op.action !== null && op.action === st.action && [...op.things].some(t => st.things.has(t));
}

/** Whether a confirmed API covers a step: a listed operation names its action and thing, or a person confirmed it without listing any. */
export function apiCovers(a: AccessMethod, step: Step): boolean {
  if (a.status === 'user-confirmed' && a.operations.length === 0) return true;
  return a.operations.some(op => operationCovers(op, step.name));
}

const words = (t: string) => new Set(t.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(w => w.length > 3));

/** The rule before this one's release: one word in common, or the same first five letters, ignoring words common to the process. */
export function looseCovers(a: AccessMethod, step: Step, common: Set<string>): boolean {
  if (a.status === 'user-confirmed' && a.operations.length === 0) return true;
  const stepWords = [...words(`${step.name} ${step.description}`)].filter(w => !common.has(w));
  const stem = (w: string) => w.slice(0, 5);
  return a.operations.some(op => [...words(op)].filter(w => !common.has(w)).some(w => stepWords.some(s => s === w || (w.length >= 5 && s.length >= 5 && stem(s) === stem(w)))));
}

/**
 * The day the rule goes live, set in the release's own commit (owner, 18 November 2026): until then the
 * screens show "[release date]", so the preview shows where the date goes. The notice shows until the
 * end of January 2027, after which the rule is simply how it works.
 */
export const COVERAGE_RULE: { since: string | null; noticeUntil: string } = { since: null, noticeUntil: '2027-01-31' };
export const showsCoverageNotice = (now: Date): boolean => now.toISOString().slice(0, 10) <= COVERAGE_RULE.noticeUntil;
const sinceText = () => COVERAGE_RULE.since ?? '[release date]';

const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/**
 * What a person sees where the rule changed a process's figures: on the Assessment, in the Documents (an
 * approved revision's included, since its documents are rebuilt each time they are opened) and on the
 * process card. Null where nothing changed, or once the notice period is over. Wording: the owner's.
 */
export function coverageNotice(n: { steps: number; systems: string[] }, where: 'assessment' | 'documents' | 'card', now = new Date()): string | null {
  if (!n.steps || !showsCoverageNotice(now)) return null;
  const steps = n.steps === 1 ? '1 step' : `${n.steps} steps`;
  if (where === 'card') return `Figures changed on ${sinceText()}: a stricter API rule applies to ${steps}.`;
  const text = `Since ${sinceText()}, an application's API counts for a step only when one of its listed operations does that step's work: the same action on the same thing. `
    + `For this process, ${steps} ${n.steps === 1 ? 'is' : 'are'} no longer counted as covered by the API of ${list(n.systems)}, so the figures may differ from before. `
    + 'If the API does do that work, answer yes to the question on that step and it will count again.';
  return where === 'documents' ? `${text} These documents are rebuilt each time they are opened, so this applies to an approved revision too.` : text;
}

/** The question asked about one application and one step, and the one the step's panel puts to the open questions. */
export const apiQuestion = (system: string, step: string) => `Does ${system} have an API that covers "${step}"?`;
export const apiConfirmQuestion = (system: string, step: string) => `Confirm whether ${system} has an API that covers "${step}".`;

/**
 * Whether a person has answered that question for this application and step (yes or no). A yes also
 * records the step's name as an operation of the API, which is what makes it count (apiCovers); the
 * answered question is what keeps the question from being asked again after a no.
 */
export function apiAnswered(model: ProcessModel, system: SystemRef, step: Step): boolean {
  return apiAnswer(model, system, step) !== null;
}

/**
 * A person's answer for this application and step: 'yes', 'no', or 'other' for an answer in their own words
 * (from the open questions), null when none. A no wins over any listed operation (owner, 18 November 2026):
 * a yes for "Check invoice totals" does not make the API count for "Check invoice tax" left unticked.
 */
export function apiAnswer(model: ProcessModel, system: SystemRef, step: Step): 'yes' | 'no' | 'other' | null {
  const texts = [apiQuestion(system.name, step.name), apiConfirmQuestion(system.name, step.name)];
  const q = model.openQuestions.find(x => x.status === 'answered' && x.target.kind === 'system' && x.target.id === system.id && texts.includes(x.question));
  if (!q) return null;
  return /^Yes:/.test(q.answer ?? '') ? 'yes' : /^No:/.test(q.answer ?? '') ? 'no' : 'other';
}
