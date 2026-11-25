// Turning the raw list of open questions and gaps into the questions that matter, by fixed rules:
// duplicates merged, questions the model already answers set aside, each one grouped by what it
// changes and given a likely owner. Nothing here is decided by AI.
import { waysInterfaces } from './ways.ts';
import { asksOnlyFor } from './matter.ts';
import type { AccessStatus, ElementTarget, OpenQuestion, ProcessModel } from '../processModel/types.ts';
import { gaps, stepsForSystem, type Gap } from '../processModel/selectors.ts';
import type { ProcessAssessment } from '../assess/process.ts';
import { buildingSystem } from '../plan/intended.ts';
import { asksQuestion, purposeOf, type PurposeValue } from '../plan/purpose.ts';
import { APPROACH_LABEL, NON_INTEGRABLE } from '../assess/scoring.ts';
import { choicesFor } from './answer.ts';
import { closedByPerson } from './closedGaps.ts';

export type QGroup = 'decides' | 'signoff' | 'detail';
export type QOwner = 'business' | 'it' | 'finance';
/** `ways`: an application with no way in recorded; its interfaces are the six ways in (domain/questions/ways.ts). */
export type AnswerKind = 'role' | 'system' | 'number' | 'text' | 'access' | 'ways' | 'free' | 'choice';

export const GROUP_LABEL: Record<QGroup, string> = { decides: 'Changes the recommendation', signoff: 'Needed for sign-off', detail: 'Detail' };
/** An item's group in words: for an approach decided for the process, what leads settles that approach. */
export const groupLabel = (i: Pick<TriageItem, 'group' | 'affects'>) => (i.group === 'decides' && i.affects[0]?.startsWith('Settles whether') ? 'Settles the decided approach' : GROUP_LABEL[i.group]);
export const OWNER_LABEL: Record<QOwner, string> = { business: 'Process owner or SME', it: 'IT or application owner', finance: 'Finance or controls' };

export interface TriageItem {
  /** Stable while the question is open. */
  key: string;
  question: string;
  target: ElementTarget;
  /** Stored open questions this item answers (none for a gap found by rule). */
  questionIds: string[];
  group: QGroup;
  owner: QOwner;
  /** Where the answer lands. */
  affects: string[];
  kind: AnswerKind;
  /** For merged interface questions: the interfaces to settle, by their index in the system's access list. */
  interfaces?: { index: number; label: string; access: AccessStatus }[];
  /** For a fact of a step or an application that settles a decided approach (package 9): the answers to choose from. */
  choices?: [string, string][];
  /** A person it is assigned to, when deferred. */
  assignedTo: string | null;
  deferred: boolean;
  /** Other wordings of the same question, merged into this one (an answer closes them all). */
  also?: string[];
  /** For a question about an application: how many steps still to decide use it. */
  uses?: number;
}

export interface Triage {
  items: TriageItem[];
  /** Stored questions the model already answers, with why. */
  alreadyKnown: { questionId: string; question: string; why: string }[];
  /** Raw count before merging, for "50 raised, 20 to answer". */
  raw: number;
  /** What the person wants from the process; "as_is": no question exists to choose an approach or size a saving. */
  purpose?: PurposeValue;
}

const IT = /\b(api|apis|sap|system|integration|interface|enable|it|access|fiori|servicenow|landscape|expos\w*|gateway|ocr|tool)\b/i;
const FINANCE = /\b(tolerance|threshold|approv\w*|policy|doa|controller|gl account|lakh|audit|tax|gst|payment terms?)\b/i;
const ORDER: Record<QGroup, number> = { decides: 0, signoff: 1, detail: 2 };

// Two wordings of one question (a merge across sources often keeps both): the same words that carry
// meaning, the same numbers, and no "not" or "non" on one side only. Stricter than "about the same
// topic", because answering the merged question closes both: "volume of PO invoices" and "volume of
// non-PO invoices" stay two questions.
const STOP = new Set('a an and any are as at be been by can could do does for from has have how if in into is it its of on or should that the their them there these this those to was were what when where which who whom why will with would'.split(' '));
const NEGATION = new Set(['no', 'non', 'not', 'never', 'without', 'except', 'unless']);
/** The words of a question that carry its meaning, lower case, without common words. */
export const contentWords = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter(w => w.length > 1 && !STOP.has(w)));
/** Shared content words, from 0 (none) to 1 (the same words). */
export function wordOverlap(a: string, b: string): number {
  const x = contentWords(a), y = contentWords(b);
  if (!x.size || !y.size) return 0;
  let common = 0;
  for (const w of x) if (y.has(w)) common++;
  return (2 * common) / (x.size + y.size);
}
export function sameQuestion(a: string, b: string): boolean {
  if (wordOverlap(a, b) < 0.85) return false;
  const x = contentWords(a), y = contentWords(b);
  const only = [...x].filter(w => !y.has(w)).concat([...y].filter(w => !x.has(w)));
  return !only.some(w => NEGATION.has(w) || /\d/.test(w));
}
const VALUE_METRICS = new Set(['volume', 'handling_time', 'exception_rate', 'fte']);

function kindOf(t: ElementTarget): AnswerKind {
  if (t.kind === 'step' && t.field === 'roleIds') return 'role';
  if (t.kind === 'step' && t.field === 'systemIds') return 'system';
  if (t.kind === 'exception' && t.field === 'routedToRoleId') return 'role';
  if (t.kind === 'meta' && (t.field === 'objective' || t.field === 'owner')) return 'text';
  if (t.kind === 'metric' && t.field === 'value') return 'number';
  return 'free';
}

/** Whether the model already holds what a stored question asks for. */
function answeredBy(m: ProcessModel, q: OpenQuestion): string | null {
  const t = q.target;
  if (t.kind === 'metric') {
    const x = m.meta.metrics.find(y => y.id === t.id);
    if (x && x.status !== 'unknown' && (x.value !== null || x.range)) return `${x.label} is recorded: ${x.value ?? `${x.range![0]} to ${x.range![1]}`} ${x.unit}.`;
  }
  if (t.kind === 'step' && t.field === 'roleIds') { const s = m.steps.find(y => y.id === t.id); if (s?.roleIds.length) return 'The step now has a role.'; }
  if (t.kind === 'step' && t.field === 'systemIds') { const s = m.steps.find(y => y.id === t.id); if (s?.systemIds.length) return 'The step now has a system.'; }
  if (t.kind === 'meta' && (t.field === 'objective' || t.field === 'owner') && m.meta[t.field].status !== 'unknown') return `The ${t.field} is recorded.`;
  if (t.kind === 'exception' && t.field === 'routedToRoleId') { const e = m.exceptions.find(y => y.id === t.id); if (e?.routedToRoleId) return 'The exception now has a handler.'; }
  return null;
}

function classify(m: ProcessModel, t: ElementTarget, text: string, open: Set<string>): { group: QGroup; owner: QOwner; affects: string[]; uses?: number } {
  switch (t.kind) {
    case 'system': {
      // A device the assessment does not route through (NON_INTEGRABLE, a scanner): its access question is still
      // asked, for the documents, but cannot change the recommendation (owner, 24 November 2026).
      const sys = m.systems.find(x => x.id === t.id);
      if (sys && NON_INTEGRABLE.includes(sys.kind)) return { group: 'detail', owner: 'it', affects: ['PDD 2.2 Applications'] };
      const used = stepsForSystem(m, t.id!).filter(s => open.has(s.id)).length;
      return { group: used ? 'decides' : 'detail', owner: 'it', affects: [`Assessment: ${used} ${used === 1 ? 'step uses' : 'steps use'} it`, 'PDD 2.2 Applications'], uses: used };
    }
    case 'step': return { group: 'signoff', owner: 'business', affects: ['PDD 2.4 Detailed steps', 'BRD stakeholders'] };
    case 'exception': return { group: 'signoff', owner: 'business', affects: ['PDD 3.6 Exception handling'] };
    case 'gateway': return { group: 'signoff', owner: 'business', affects: ['PDD 2.5 Decision points', 'Process map'] };
    case 'metric': {
      const x = m.meta.metrics.find(y => y.id === t.id);
      const value = x && VALUE_METRICS.has(x.kind) && (!x.appliesTo || x.appliesTo === 'process');
      return { group: value ? 'decides' : 'detail', owner: 'business', affects: value ? ['Value and priority', 'BRD benefits'] : ['PDD 2.1 Process overview'] };
    }
    case 'meta':
      if (t.field === 'owner' || t.field === 'objective') return { group: 'signoff', owner: 'business', affects: ['BRD 2 and 5', 'PDD 1.2 and 1.3'] };
      break;
  }
  if (FINANCE.test(text)) return { group: 'signoff', owner: 'finance', affects: ['Business rules', 'BRD 8'] };
  if (IT.test(text)) return { group: 'decides', owner: 'it', affects: ['Assessment', 'PDD 2.2 Applications'] };
  return { group: 'detail', owner: 'business', affects: ['PDD'] };
}

export function triage(m: ProcessModel, a: ProcessAssessment): Triage {
  const openSteps = new Set(a.steps.filter(s => !s.alreadyAutomated && !s.mustStayHuman).map(s => s.stepId));
  const stored = m.openQuestions.filter(q => q.status === 'open' || q.status === 'deferred');
  const alreadyKnown: Triage['alreadyKnown'] = [];
  const items: TriageItem[] = [];
  const bySystem = new Map<string, OpenQuestion[]>();

  // The application being built (part C) is not one the automation reaches: how it is reached is part of its own design.
  const building = buildingSystem(m);
  const designOwn = (q: OpenQuestion) => building && q.target.kind === 'system' && q.target.id === building.id
    ? `${building.name} is what is being built; how it is reached is part of its own design.` : null;
  for (const q of stored) {
    const why = q.status === 'open' ? answeredBy(m, q) ?? designOwn(q) : null;
    if (why) { alreadyKnown.push({ questionId: q.id, question: q.question, why }); continue; }
    if (q.target.kind === 'system' && q.target.field === 'access' && q.target.id) {
      bySystem.set(q.target.id, [...(bySystem.get(q.target.id) ?? []), q]);
      continue;
    }
    // A second wording of a question already listed on the same target joins it.
    const twin = items.find(i => i.questionIds.length && i.target.kind === q.target.kind && i.target.id === q.target.id && i.target.field === q.target.field
      && i.deferred === (q.status === 'deferred') && sameQuestion(i.question, q.question));
    if (twin) { twin.questionIds.push(q.id); twin.also = [...(twin.also ?? []), q.question]; continue; }
    items.push({ key: q.id, question: q.question, target: q.target, questionIds: [q.id], kind: kindOf(q.target), assignedTo: q.owner, deferred: q.status === 'deferred', ...classify(m, q.target, q.question, openSteps) });
  }

  // One question per system about its interfaces, however many were raised.
  const systemIds = new Set([...bySystem.keys(), ...gaps(m).filter(g => g.kind === 'system_access_unknown').map(g => g.target.id!)].filter(id => id !== building?.id));
  for (const id of systemIds) {
    const sys = m.systems.find(s => s.id === id);
    if (!sys) continue;
    const qs = bySystem.get(id) ?? [];
    const interfaces = sys.access.map((x, index) => ({ index, label: `${x.method.toUpperCase()}${x.name ? `: ${x.name}` : ''}${x.operations.length ? ` (${x.operations.slice(0, 3).join(', ')}${x.operations.length > 3 ? ', …' : ''})` : ''}`, access: x.access })).filter(x => x.access === 'unknown' || x.access === 'reported');
    const question = interfaces.length
      ? `Which ${sys.name} interfaces can the automation use? ${interfaces.length} ${interfaces.length === 1 ? 'is' : 'are'} not confirmed.`
      : `How can ${sys.name} be accessed by the automation (API, screens, file)?`;
    // An application with no way in recorded is asked as a choice of ways in, never in free words (plan of 23 November 2026).
    const ways = !interfaces.length && sys.access.length === 0;
    items.push({ key: `system:${id}`, question, target: { kind: 'system', id, field: 'access' }, questionIds: qs.map(q => q.id), kind: interfaces.length ? 'access' : ways ? 'ways' : 'free', interfaces: ways ? waysInterfaces() : interfaces,
      assignedTo: qs.find(q => q.owner)?.owner ?? null, deferred: qs.length > 0 && qs.every(q => q.status === 'deferred'), ...classify(m, { kind: 'system', id }, question, openSteps) });
  }

  // Gaps found by rule that no stored question covers. An answered question covers its gap too: a gap a person closed
  // ("Not applicable", or answered without a value) is not asked again until a person reopens it (closedGaps.ts).
  const covered = (g: Gap) => stored.some(q => q.target.kind === g.target.kind && q.target.id === g.target.id && q.target.field === g.target.field)
    || closedByPerson(m, g.target);
  for (const g of gaps(m)) {
    if (g.kind === 'system_access_unknown' || covered(g)) continue;
    if (building && g.target.kind === 'system' && g.target.id === building.id) continue;
    if (g.kind === 'unsourced_assumption') continue; // confirmed in the Process stage, not by a question
    items.push({ key: `gap:${g.kind}:${g.target.kind}:${g.target.id ?? ''}:${g.target.field ?? ''}`, question: g.label, target: g.target, questionIds: [], kind: kindOf(g.target), assignedTo: null, deferred: false, ...classify(m, g.target, g.label, openSteps) });
  }
  for (const e of m.exceptions.filter(x => !x.routedToRoleId)) {
    const target: ElementTarget = { kind: 'exception', id: e.id, field: 'routedToRoleId' };
    if (stored.some(q => q.target.kind === 'exception' && q.target.id === e.id) || closedByPerson(m, target)) continue;
    items.push({ key: `gap:route:${e.id}`, question: `Who handles the exception "${e.name}"?`, target, questionIds: [], kind: 'role', assignedTo: null, deferred: false, ...classify(m, target, '', openSteps) });
  }

  // A question in free words that asks only for the objective, or only for the owner, is the same question as
  // the structured one (questions/matter.ts): it joins it, so it is listed once, counted once, closed together.
  for (const free of [...items]) {
    if (free.target.kind !== 'meta' || free.target.field) continue;
    const matter = asksOnlyFor(free.question);
    const main = matter ? items.find(x => x !== free && x.target.kind === 'meta' && x.target.field === matter && x.deferred === free.deferred) : undefined;
    if (!main) continue;
    main.questionIds = [...main.questionIds, ...free.questionIds];
    main.also = [...(main.also ?? []), free.question, ...(free.also ?? [])];
    items.splice(items.indexOf(free), 1);
  }

  // Documented as it is (domain/plan/purpose.ts): what only serves an assessment is not asked, and
  // nothing left can change a recommendation, because there is none. The questions stay on the record.
  const purpose = purposeOf(m);
  // Decided (package 9): there is no recommendation to change. What leads instead is what settles whether
  // the decided approach can do a step not known yet: the question about that application's API.
  const settles = new Map<string, number>();
  if (purpose === 'decided') for (const s of a.steps) for (const q of s.decided?.status === 'unknown' ? s.decided.questions : []) {
    if (q.target.kind === 'api') settles.set(q.target.systemId, (settles.get(q.target.systemId) ?? 0) + 1);
  }
  const label = m.meta.decidedApproach ? APPROACH_LABEL[m.meta.decidedApproach.approach] : '';
  const asked = purpose === 'as_is'
    ? items.filter(i => asksQuestion(m, i)).map(i => (i.group === 'decides' ? { ...i, group: 'signoff' as const, affects: i.affects.filter(x => !x.startsWith('Assessment')) } : i))
    : purpose === 'decided'
    ? items.filter(i => asksQuestion(m, i)).map(i => {
      const n = i.target.kind === 'system' && i.target.field === 'access' && i.target.id ? settles.get(i.target.id) ?? 0 : 0;
      if (n) return { ...i, group: 'decides' as const, uses: n, affects: [`Settles whether ${label} can do ${n} ${n === 1 ? 'step' : 'steps'}`, ...i.affects.filter(x => !x.startsWith('Assessment'))] };
      return i.group === 'decides' ? { ...i, group: 'signoff' as const, affects: i.affects.filter(x => !x.startsWith('Assessment')) } : i;
    })
    : items;
  // The facts of a step or of an application's screens that settle a step not known yet lead too, answered by a choice.
  if (purpose === 'decided') {
    const seen = new Set<string>();
    for (const s of a.steps) for (const q of s.decided?.status === 'unknown' ? s.decided.questions : []) {
      if (q.target.kind === 'api' || seen.has(q.key)) continue;
      seen.add(q.key);
      const target: ElementTarget = q.target.kind === 'trait' ? { kind: 'step', id: q.target.stepId, field: `traits.${q.target.trait}` } : { kind: 'system', id: q.target.systemId, field: 'uiStable' };
      const n = a.steps.filter(x => x.decided?.status === 'unknown' && x.decided.questions.some(y => y.key === q.key)).length;
      asked.push({ key: `decided:${q.key}`, question: q.question, target, questionIds: [], kind: 'choice', choices: choicesFor(q.target.kind === 'trait' ? q.target.trait : 'uiStable'),
        assignedTo: null, deferred: false, group: 'decides', owner: q.target.kind === 'screens' ? 'it' : 'business', uses: n,
        affects: [`Settles whether ${label} can do ${n} ${n === 1 ? 'step' : 'steps'}`] });
    }
  }
  asked.sort((x, y) => Number(x.deferred) - Number(y.deferred) || ORDER[x.group] - ORDER[y.group] || x.owner.localeCompare(y.owner));
  // Gaps a person closed are not counted as raised either, so "N in all" agrees with the lists.
  const gapCount = gaps(m).filter(g => !closedByPerson(m, g.target)).length
    + m.exceptions.filter(x => !x.routedToRoleId && !closedByPerson(m, { kind: 'exception', id: x.id, field: 'routedToRoleId' })).length;
  return { items: asked, alreadyKnown, raw: stored.length + gapCount, ...(purpose !== 'assess' ? { purpose } : {}) };
}
