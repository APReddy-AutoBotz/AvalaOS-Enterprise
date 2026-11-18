// When an application's API covers a step (finding F09 of the outside review, package 13 B, 18 November
// 2026). An operation the sources or a person list for an API covers a step only when it names the same
// action as the step's name (the same verb, or one of a small table of equal verbs) and the same thing (a
// word in common, whole words, a plural counted as its singular). "Read supplier" no longer covers "Update
// supplier"; a word stem no longer counts. A person who confirms an API without listing its operations has
// confirmed it for the whole process, as before.
//
// Until 18 November 2026 one shared word, or the same first five letters, was enough (`looseCovers`, kept
// only to say where the rule now gives a different answer, so nothing changes without a line saying so).

import type { AccessMethod, Step } from '../processModel/types.ts';

/** Verbs that name the same action, by group. A first word outside the table matches only the same word. */
export const ACTIONS: Record<string, readonly string[]> = {
  create: ['create', 'add', 'new', 'raise', 'register', 'open', 'submit', 'enter', 'post', 'record', 'log', 'book', 'capture', 'insert'],
  read: ['read', 'get', 'retrieve', 'fetch', 'look', 'lookup', 'view', 'check', 'query', 'search', 'list', 'find', 'download', 'export', 'validate', 'verify'],
  change: ['update', 'change', 'amend', 'edit', 'modify', 'set', 'maintain', 'correct'],
  remove: ['delete', 'remove', 'cancel', 'close', 'archive', 'reverse'],
  approve: ['approve', 'authorise', 'authorize', 'release', 'sign'],
  send: ['send', 'email', 'notify', 'forward', 'reply', 'return', 'share', 'upload', 'attach', 'publish'],
  match: ['match', 'reconcile', 'compare'],
};
const ACTION_OF = new Map(Object.entries(ACTIONS).flatMap(([group, verbs]) => verbs.map(v => [v, group] as const)));

const tokens = (t: string) => t.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean);
/** A plural counted as its singular: invoices → invoice, entries → entry; "process", "status" stay. */
const singular = (w: string) => (w.length > 4 && w.endsWith('ies') ? `${w.slice(0, -3)}y` : w.length > 3 && w.endsWith('s') && !/(ss|us|is)$/.test(w) ? w.slice(0, -1) : w);
const SMALL = new Set(['the', 'and', 'for', 'with', 'from', 'into', 'onto', 'its', 'their', 'our', 'all', 'any', 'one', 'per', 'via', 'new']);

/** The action groups a text names, and the things it names (every other word of three letters or more). */
export function partsOf(text: string): { actions: Set<string>; things: Set<string> } {
  const actions = new Set<string>(), things = new Set<string>();
  tokens(text).forEach((w, i) => {
    const group = ACTION_OF.get(w);
    if (group) actions.add(group);
    // A name starts with its verb ("Scan paper invoice"): one outside the table matches only itself.
    else if (i === 0) actions.add(`verb:${w}`);
    else if (w.length >= 3 && !SMALL.has(w)) things.add(singular(w));
  });
  return { actions, things };
}

/** Whether one listed operation names the same action and the same thing as the step's name. */
export function operationCovers(operation: string, stepName: string): boolean {
  const op = partsOf(operation), st = partsOf(stepName);
  const sameAction = [...op.actions].some(a => st.actions.has(a));
  const sameThing = [...op.things].some(t => st.things.has(t));
  return sameAction && sameThing;
}

/** Whether a confirmed API covers a step: a listed operation names its action and thing, or a person confirmed it without listing any. */
export function apiCovers(a: AccessMethod, step: Step): boolean {
  if (a.status === 'user-confirmed' && a.operations.length === 0) return true;
  return a.operations.some(op => operationCovers(op, step.name));
}

const words = (t: string) => new Set(t.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(w => w.length > 3));

/** The rule before 18 November 2026: one word in common, or the same first five letters, ignoring words common to the process. */
export function looseCovers(a: AccessMethod, step: Step, common: Set<string>): boolean {
  if (a.status === 'user-confirmed' && a.operations.length === 0) return true;
  const stepWords = [...words(`${step.name} ${step.description}`)].filter(w => !common.has(w));
  const stem = (w: string) => w.slice(0, 5);
  return a.operations.some(op => [...words(op)].filter(w => !common.has(w)).some(w => stepWords.some(s => s === w || (w.length >= 5 && s.length >= 5 && stem(s) === stem(w)))));
}

/** How long the screens say the rule changed, after which the change is simply how it works. */
export const COVERAGE_RULE = { since: '18 November 2026', noticeUntil: '2027-01-31' } as const;
export const showsCoverageNotice = (now: Date): boolean => now.toISOString().slice(0, 10) <= COVERAGE_RULE.noticeUntil;

const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/**
 * What a person sees where the rule changed a process's figures: on the Assessment, in the Documents (an
 * approved revision's included, since its documents are worked out each time they are opened) and on the
 * process card. Null where nothing changed, or once the notice period is over.
 */
export function coverageNotice(n: { steps: number; systems: string[] }, where: 'assessment' | 'documents' | 'card', now = new Date()): string | null {
  if (!n.steps || !showsCoverageNotice(now)) return null;
  const steps = n.steps === 1 ? '1 step' : `${n.steps} steps`;
  if (where === 'card') return `Figures changed on ${COVERAGE_RULE.since}: a stricter API rule applies to ${steps}.`;
  const rule = `Since ${COVERAGE_RULE.since} an application's API counts as covering a step only when one of its listed operations names the same action and the same thing as the step.`;
  const effect = `For this process that changes ${steps}, where the API of ${list(n.systems)} no longer counts as covering the work, so the figures may differ from before.`;
  const fix = 'Where an API does do that work, list the operation for the application under Settings → Applications and accept it in the process.';
  if (where === 'documents') return `${rule} ${effect} These documents are worked out each time they are opened, so this applies to an approved revision too. ${fix}`;
  return `${rule} ${effect} ${fix}`;
}
