// Input cards (package B, plan section 3): the inputs the assessment lists as most useful next
// (`priority.nextInputs`) are fields of the Inputs view, not questions, so Discovery asks each with the
// same field and writes it with the same operation. A number can also be said in words; its period is
// read from the words by a rule here, never by the AI. A process documented as it is has no assessment,
// so it gets no input card.
import type { ProcessModel, Step } from '../processModel/types.ts';
import type { ProcessAssessment } from '../assess/process.ts';
import { answerApiCoverage, PERIODS, setProcessMetric, setProfileFact, setStepTrait, setSystemUiStable, setTypicalTrait, type OpResult, type TraitName } from '../processModel/patch.ts';
import { orderedSteps } from '../processModel/selectors.ts';
import { purposeOf } from '../plan/purpose.ts';
import { all, choicesFor, type Op } from '../questions/answer.ts';
import { makeCard, type Card } from './card.ts';

export type Period = (typeof PERIODS)[number];

export type InputField =
  | { kind: 'figure'; metric: 'volume' | 'handling_time' | 'fte'; period: boolean; units?: ('minutes' | 'hours')[] }
  | { kind: 'change' }
  | { kind: 'api'; systemId: string; stepIds: string[] }
  | { kind: 'fact'; key: string; stepIds: string[]; choices: [string, string][]; sameForAll: boolean }
  | { kind: 'per_step'; trait: 'effortMinutes' | 'sharePercent'; stepIds: string[] };

export interface InputCard extends Card { inputId: string; field: InputField }

export interface InputValue {
  number?: number;
  period?: Period;
  unit?: 'minutes' | 'hours';
  level?: 'none' | 'minor' | 'major';
  covers?: string[];
  notCovers?: string[];
  pick?: string;
  /** For a step fact: the same answer for every step (`setTypicalTrait`). */
  sameForAll?: boolean;
  perStep?: Record<string, number>;
}

const TYPICAL = new Set(['rulesComplete', 'input', 'judgment', 'physical', 'language', 'write']);
const CHOICE_VALUE = (trait: string, v: string): unknown => (trait === 'input' || trait === 'write' ? v : v === 'true');

/** The input cards, in the order the assessment lists its inputs; none for a process documented as it is or with no step to assess. */
export function inputCards(m: ProcessModel, a: ProcessAssessment): InputCard[] {
  // Nothing to sharpen before there are steps to assess, nor for a process documented as it is.
  if (purposeOf(m) === 'as_is' || a.assessed === 0) return [];
  const steps = orderedSteps(m);
  const names = (ids: string[]) => ids.map(id => steps.find(s => s.id === id)?.name).filter(Boolean).map(n => `"${n}"`);
  const out: InputCard[] = [];
  const add = (inputId: string, label: string, why: string, question: string, target: Card['target'], updates: string[], field: InputField) => {
    const c = makeCard({ key: `input:${inputId}`, group: 'input', origin: { kind: 'gap', gap: `Not recorded yet: ${label.charAt(0).toLowerCase()}${label.slice(1)}.` }, question, why, target, updates, answer: 'field', inputId });
    if (c) out.push({ ...c, inputId, field });
  };
  const people = Boolean(m.meta.metrics.some(x => x.kind === 'fte' && x.value !== null));
  for (const n of a.priority.nextInputs) {
    if (n.id === 'volume') add('volume', n.label, n.why, 'About how many cases does this process handle, and in what period?', { kind: 'meta', field: 'metrics.volume' }, ['The value', 'The placement'], { kind: 'figure', metric: 'volume', period: true });
    else if (n.id === 'time') add('time', n.label, n.why, people ? 'About how long does one case take by hand, from start to finish?' : 'About how long does one case take by hand, from start to finish? Or, how many people work on it?',
      { kind: 'meta', field: 'metrics.handling_time' }, ['The value'], { kind: 'figure', metric: 'handling_time', period: false, units: ['minutes', 'hours'] });
    else if (n.id === 'change') add('change', n.label, n.why, 'Do you expect the process to change in the next six months?', { kind: 'meta', field: 'profile.processChange' }, ['Readiness', 'Ease of implementation'], { kind: 'change' });
    else if (n.id === 'api') {
      // The first application whose API would move steps, with those steps.
      const bySystem = new Map<string, string[]>();
      for (const s of a.steps.filter(x => x.apiWouldWin)) for (const q of s.questions.filter(x => x.target.kind === 'system')) bySystem.set(q.target.id, [...(bySystem.get(q.target.id) ?? []), s.stepId]);
      // The application whose API would move the most steps (the first named on a tie), with those steps.
      const [systemId, stepIds] = [...bySystem.entries()].sort((x, y) => new Set(y[1]).size - new Set(x[1]).size)[0] ?? [];
      const sys = m.systems.find(x => x.id === systemId);
      const ids = [...new Set(stepIds ?? [])];
      const listed = names(ids);
      const which = listed.length <= 2 ? listed.join(' and ') : `${listed.slice(0, 2).join(', ')} and ${listed.length - 2} more ${listed.length - 2 === 1 ? 'step' : 'steps'}`;
      if (sys && ids.length) add('api', n.label, n.why, `Does ${sys.name} have an API that covers ${which}?`, { kind: 'system', id: sys.id, field: 'access' }, ['The recommendation of those steps'], { kind: 'api', systemId: sys.id, stepIds: ids });
    } else if (n.id === 'fact') {
      const k = a.keyQuestions[0];
      if (!k) continue;
      const key = k.key.replace(/^(trait|screens|api):/, '');
      if (k.key.startsWith('trait:')) add('fact', n.label, n.why, k.question, { kind: 'step', id: k.stepIds[0]!, field: `traits.${key}` }, ['The recommendation of those steps'],
        { kind: 'fact', key: k.key, stepIds: k.stepIds, choices: choicesFor(key), sameForAll: TYPICAL.has(key) });
      else if (k.key.startsWith('screens:')) add('fact', n.label, n.why, k.question, { kind: 'system', id: key, field: 'uiStable' }, ['The recommendation of the steps done in it'],
        { kind: 'fact', key: k.key, stepIds: k.stepIds, choices: choicesFor('uiStable'), sameForAll: false });
    } else if (n.id === 'step_time' || n.id === 'share') {
      const trait = n.id === 'step_time' ? 'effortMinutes' as const : 'sharePercent' as const;
      const scored = a.steps.filter(s => !s.alreadyAutomated).map(s => s.stepId);
      const ids = steps.filter((s: Step) => scored.includes(s.id) && s.traits?.[trait]?.value == null).map(s => s.id);
      if (ids.length) add(n.id, n.label, n.why, n.id === 'step_time' ? 'About how many minutes does each of these steps take?' : 'What share of cases goes through each of these steps?',
        { kind: 'step', id: ids[0]!, field: `traits.${trait}` }, ['The value'], { kind: 'per_step', trait, stepIds: ids });
    }
  }
  return out;
}

/** The edit an input card's answer makes, through the same operations as the Inputs view; null when the answer is not complete. */
export function inputEdit(card: InputCard, v: InputValue): Op | null {
  const f = card.field;
  const num = (x: number | undefined) => typeof x === 'number' && Number.isFinite(x) && x >= 0;
  switch (f.kind) {
    case 'figure':
      if (!num(v.number) || (f.period && !v.period)) return null;
      return m => setProcessMetric(m, { kind: f.metric, value: v.number!, ...(f.period ? { period: v.period } : {}), ...(f.units && v.unit ? { unit: v.unit } : {}) });
    case 'change':
      return v.level ? m => setProfileFact(m, { fact: 'processChange', value: v.level! }) : null;
    case 'api': {
      const covers = (v.covers ?? []).filter(id => f.stepIds.includes(id)), notCovers = (v.notCovers ?? []).filter(id => f.stepIds.includes(id) && !covers.includes(id));
      return covers.length || notCovers.length ? m => answerApiCoverage(m, { systemId: f.systemId, covers, notCovers }) : null;
    }
    case 'fact': {
      if (!v.pick || !f.choices.some(c => c[0] === v.pick)) return null;
      if (f.key.startsWith('screens:')) return m => setSystemUiStable(m, { systemId: f.key.slice('screens:'.length), value: v.pick === 'true' });
      const trait = f.key.slice('trait:'.length);
      const value = CHOICE_VALUE(trait, v.pick);
      if (v.sameForAll && f.sameForAll) return m => setTypicalTrait(m, { trait: trait as never, value });
      return all(...f.stepIds.map(id => (m: ProcessModel): OpResult => setStepTrait(m, { stepId: id, trait: trait as TraitName, value })));
    }
    case 'per_step': {
      const given = Object.entries(v.perStep ?? {}).filter(([id, x]) => f.stepIds.includes(id) && num(x) && (f.trait !== 'sharePercent' || x <= 100));
      return given.length ? all(...given.map(([id, x]) => (m: ProcessModel): OpResult => setStepTrait(m, { stepId: id, trait: f.trait, value: x }))) : null;
    }
  }
}

const PERIOD_WORDS: [RegExp, Period][] = [
  [/\b(per|a|an|each|every)\s+(working\s+)?day\b|\bdaily\b|\bper\s+diem\b/i, 'day'],
  [/\b(per|a|an|each|every)\s+week\b|\bweekly\b/i, 'week'],
  [/\b(per|a|an|each|every)\s+month\b|\bmonthly\b|\bper\s+mo\b|\/\s*month\b/i, 'month'],
  [/\b(per|a|an|each|every)\s+quarter\b|\bquarterly\b/i, 'quarter'],
  [/\b(per|a|an|each|every)\s+year\b|\byearly\b|\bannually\b|\bper\s+annum\b|\/\s*year\b/i, 'year'],
];

/** The period a figure said in words is for ("about 500 a month" is a month); null when the words name none, or more than one. */
export function periodFrom(text: string): Period | null {
  const hits = PERIOD_WORDS.filter(([re]) => re.test(text)).map(([, p]) => p);
  return hits.length === 1 ? hits[0]! : null;
}
