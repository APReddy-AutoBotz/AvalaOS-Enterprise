// Fewer questions (docs/effort-first-plan.md, part D): of everything triage lists, only a short first
// list is put to people: questions whose answer could change the recommended approach or that a
// document cannot do without, ranked, at most `FIRST_LIST.cap`. A question a source already answers is
// offered to confirm instead of asked. Everything else is kept, one click away, under "can wait until
// sign-off", with why it was held back. Nothing is closed or changed here: this only decides what is
// shown first. All by rule; no AI decides anything.
import type { ProcessModel } from '../processModel/types.ts';
import { wordOverlap, type Triage, type TriageItem } from './triage.ts';

/** The most questions put to people at first. A working default the owner may change. */
export const FIRST_LIST = { cap: 7 } as const;

/** Why a question that is still open is not in the first list. */
export type Hold =
  /** One of the first-list questions (or another listed question) asks the same thing in a structured way. */
  | { kind: 'covered'; by: string; byQuestion: string }
  /** Close in wording to a question already in the first list, so it is asked once that one is answered. */
  | { kind: 'near'; to: string; toQuestion: string }
  /** It could change the recommendation (documented as it is: the document needs it), but the first list is full. */
  | { kind: 'full'; forDocument?: true }
  /** Its answer completes the documents but changes neither the recommendation nor whether a document can be written. */
  | { kind: 'later' };

export interface QuestionPlan {
  /** Only people can tell us: the first list, most decisive first. */
  now: TriageItem[];
  /** A source states an answer: offered to confirm with one click. */
  found: TriageItem[];
  /** Can wait until sign-off, in triage's order. */
  wait: TriageItem[];
  /** Left with a named person. */
  deferred: TriageItem[];
  /** Why each question in `wait` was held back, by its key. */
  held: Record<string, Hold>;
  /** For the summary: questions the sources raised, wordings merged, and those the record already answers. */
  counts: { raised: number; merged: number; alreadyKnown: number };
}

/** A document cannot be written without it: the process's objective and owner open the BRD and the PDD. */
export const blocksDocument = (i: TriageItem) => i.target.kind === 'meta' && (i.target.field === 'objective' || i.target.field === 'owner');

/**
 * Whether a question may be in the first list at all. For a process documented as it is there is no
 * recommendation to change, and the documents are the whole point: what sign-off needs comes first.
 */
export const decisive = (i: TriageItem, opts?: { asIs?: boolean }) => !i.deferred && (i.group === (opts?.asIs ? 'signoff' : 'decides') || blocksDocument(i));

/**
 * How strongly the answer weighs, for the order of the first list. A missing objective or owner first;
 * then an application's ways in, by how many steps still to decide use it; then a process figure the
 * value rests on; then other questions that change the recommendation, a little higher for each other
 * wording merged into them (asked several times in the sources).
 */
export const weightOf = (i: TriageItem): number => weightFor(i);

/** The same weight, for a process documented as it is when `asIs` holds: what sign-off needs comes first. */
export function weightFor(i: TriageItem, opts?: { asIs?: boolean }): number {
  if (blocksDocument(i)) return 1000;
  if (opts?.asIs) return i.group === 'signoff' ? 100 + 5 * (i.also?.length ?? 0) : 0;
  if (i.group !== 'decides') return 0;
  if (i.target.kind === 'system') return 200 + 10 * (i.uses ?? 0);
  if (i.target.kind === 'metric') return 150;
  return 100 + 5 * (i.also?.length ?? 0);
}

const isFree = (i: TriageItem) => i.target.kind === 'meta' && !i.target.field;
const ACCESS_WORDS = /\b(access\w*|apis?|interfaces?|integrat\w*|connect\w*|permissions?|permitted)\b/i;
const FIGURE_WORDS: [RegExp, string][] = [
  [/\b(handling[- ]times?|time per (?:case|item|invoice|request)|how long)\b/i, 'handling_time'],
  [/\b(volumes?|(?:cases|items|invoices|requests) per)\b/i, 'volume'],
  [/\b(exception rate|share of exceptions)\b/i, 'exception_rate'],
];
const ROUTE_WORDS = /\b(who handles|handled by|rout(?:ed|ing)|routed owner)\b/i;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/**
 * Whether the text names the application: its name, its name without a part in brackets, or the
 * acronym it starts with ("SAP" for "SAP S/4HANA"), as whole words. Never a common word of its name
 * ("Teams" in "Microsoft Teams" is also a group of people).
 */
export function names(text: string, name: string): boolean {
  const lead = name.match(/^([A-Z][A-Z0-9]{1,5})\b/)?.[1];
  return [name, name.replace(/\s*\([^)]*\)\s*/g, ' ').trim(), lead ?? ''].filter(n => n.length >= 2)
    .some(n => new RegExp(`(^|[^a-z0-9])${escape(n.toLowerCase())}($|[^a-z0-9])`).test(text.toLowerCase()));
}

/**
 * A question in free words that a structured question already asks: about an application's access
 * when that application has its own question, about volumes or handling times when a figure is asked
 * for, about who handles a case when an exception's handler is asked for. Such a question is held back,
 * not closed: answering the structured one usually answers it, and it stays listed until someone does.
 */
export function coveredBy(i: TriageItem, items: TriageItem[], m: ProcessModel): TriageItem | null {
  if (!isFree(i)) return null;
  const open = items.filter(x => x !== i && !x.deferred);
  if (ACCESS_WORDS.test(i.question)) {
    const sys = open.find(x => x.target.kind === 'system' && x.target.field === 'access' && names(i.question, m.systems.find(s => s.id === x.target.id)?.name ?? ''));
    if (sys) return sys;
  }
  for (const [re, kind] of FIGURE_WORDS) {
    if (!re.test(i.question)) continue;
    // A figure not recorded yet is asked for by its kind (`field`); one recorded, by its id.
    const fig = open.find(x => x.target.kind === 'metric' && (x.target.id ? m.meta.metrics.find(y => y.id === x.target.id)?.kind : x.target.field) === kind);
    if (fig) return fig;
  }
  if (ROUTE_WORDS.test(i.question)) { const route = open.find(x => x.target.kind === 'exception' && x.target.field === 'routedToRoleId'); if (route) return route; }
  return null;
}

/** Two free questions this close are about the same matter; the second waits for the first's answer. */
const NEAR = 0.5;

/**
 * The plan of questions for a process. `found` holds the keys of questions a source states an answer
 * to (found by Ask Avala and not dismissed); `cap` is the size of the first list.
 */
export function planQuestions(t: Triage, m: ProcessModel, opts: { found?: ReadonlySet<string>; cap?: number } = {}): QuestionPlan {
  const cap = Math.max(0, opts.cap ?? FIRST_LIST.cap);
  const found = opts.found ?? new Set<string>();
  const held: Record<string, Hold> = {};
  const deferred = t.items.filter(i => i.deferred);
  const open = t.items.filter(i => !i.deferred);
  const foundItems = open.filter(i => found.has(i.key));
  const rest = open.filter(i => !found.has(i.key));

  const asIs = { asIs: t.purpose === 'as_is' };
  const pool = rest.filter(i => decisive(i, asIs)).map((i, n) => ({ i, n, w: weightFor(i, asIs) })).sort((a, b) => b.w - a.w || a.n - b.n).map(x => x.i);
  const now: TriageItem[] = [];
  for (const i of pool) {
    const cover = coveredBy(i, t.items, m);
    if (cover) { held[i.key] = { kind: 'covered', by: cover.key, byQuestion: cover.question }; continue; }
    const near = isFree(i) ? now.find(x => isFree(x) && wordOverlap(x.question, i.question) >= NEAR) : undefined;
    if (near) { held[i.key] = { kind: 'near', to: near.key, toQuestion: near.question }; continue; }
    if (now.length >= cap) { held[i.key] = asIs.asIs ? { kind: 'full', forDocument: true } : { kind: 'full' }; continue; }
    now.push(i);
  }
  const inNow = new Set(now.map(i => i.key));
  const wait = rest.filter(i => !inNow.has(i.key));
  for (const i of wait) if (!held[i.key]) {
    const cover = coveredBy(i, t.items, m);
    held[i.key] = cover ? { kind: 'covered', by: cover.key, byQuestion: cover.question } : { kind: 'later' };
  }
  const merged = t.items.reduce((n, i) => n + (i.also?.length ?? 0), 0);
  return { now, found: foundItems, wait, deferred, held, counts: { raised: t.raw, merged, alreadyKnown: t.alreadyKnown.length } };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The heading over the first list. */
export const nowHeading = (p: QuestionPlan) => p.now.length
  ? `${plural(p.now.length, 'thing', 'things')} only your people can tell us`
  : 'Nothing that only your people can tell us right now';

/** One line under the heading: what else there is and how the list was made shorter, from counts only. */
export function planSummary(p: QuestionPlan): string {
  const parts = [
    p.found.length ? `${p.found.length} found in your sources to confirm` : '',
    p.wait.length ? `${p.wait.length} can wait until sign-off` : '',
    p.deferred.length ? `${p.deferred.length} with someone else` : '',
  ].filter(Boolean);
  const set = [
    p.counts.merged ? `${plural(p.counts.merged, 'repeat', 'repeats')} merged` : '',
    p.counts.alreadyKnown ? `${p.counts.alreadyKnown} already answered by the process record` : '',
  ].filter(Boolean);
  const first = parts.length ? `${parts.join(' · ').replace(/^./, c => c.toUpperCase())}.` : '';
  const second = set.length ? `${set.join('; ').replace(/^./, c => c.toUpperCase())}.` : '';
  return [first, second].filter(Boolean).join(' ');
}

/** Why a question waits, in a sentence. */
export function holdReason(h: Hold | undefined): string {
  switch (h?.kind) {
    case 'covered': return `Asked by another question first: "${h.byQuestion}"`;
    case 'near': return `Close to a question already asked: "${h.toQuestion}"`;
    case 'full': return h.forDocument ? 'The document needs it; asked once the first list is answered.' : 'Could change the recommendation; asked once the first list is answered.';
    case 'later': return 'Completes the documents; needed before sign-off.';
    default: return '';
  }
}

/** The order the interview asks in: the first list, then (when the person goes on) what can wait. */
export const askingOrder = (p: QuestionPlan, includeWait: boolean): TriageItem[] => (includeWait ? [...p.now, ...p.wait] : p.now);

/**
 * The count the Process stage's "Open questions" tab shows: the first list, as Ask Avala's questions tab
 * counts it (what needs people now and answers found to confirm). The tab itself lists every open item
 * as recorded; when that is a different number, `note` says why the two differ.
 */
export function questionsTabCount(plan: QuestionPlan, raw: number): { count: number; note: string | null } {
  const count = plan.now.length + plan.found.length;
  if (raw === count) return { count, note: null };
  const need = `${count} ${count === 1 ? 'question needs' : 'questions need'} people now`;
  const found = plan.found.length ? ` (${plan.found.length} of them found in the sources, to confirm)` : '';
  return { count, note: `${need}${found}: the same list as Ask Avala's questions. Below is every open item as recorded, ${raw} in all; the first list merges repeated wordings and leaves out what can wait until sign-off.` };
}
