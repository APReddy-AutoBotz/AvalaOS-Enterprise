// The step assessment: a least-complex-first ladder, evaluated from the facts in the Process Model.
//
// Each rung is data: an id, what it recommends, whether AI is needed, and a check over the step's
// facts. A check answers "fires", "does not fire" (with the reason) or "unknown" (with the facts
// that would decide it). Evaluation walks the rungs in order and stops at the first that fires.
// Every rung above it is reported as rejected with its reason, and every "unknown" above it is a
// fact that could change the result. Nothing is assumed: an absent fact is unknown.
import type { AccessMethod, Fact, InputForm, ProcessModel, SourceRef, Step, StepTraits, SystemRef, WriteImpact } from '../processModel/types.ts';

export const RULES_VERSION = 'assess-rules-2026-11';

export type Mechanism =
  | 'already_automated'
  | 'eliminate'
  | 'keep_human'
  | 'rules'
  | 'api'
  | 'api_candidate'
  | 'rpa'
  | 'extraction'
  | 'ai_assist'
  | 'agent'
  | 'no_option';

export type AiNeed = 'no' | 'yes' | 'undecided';
export type HumanPoint = 'none' | 'review' | 'approve' | 'decide' | 'does_it';
export type Confidence = 'high' | 'medium' | 'low';

/** A fact the result rests on, with where it came from. */
export interface FactUsed {
  /** For example "traits.rulesComplete" or "systems.sys-1.access.api". */
  path: string;
  label: string;
  value: unknown;
  status: Fact<unknown>['status'];
  sources: SourceRef[];
}

export interface Reason {
  text: string;
  facts: FactUsed[];
}

/** A fact nobody has stated whose answer could change the recommendation. */
export interface Unknown {
  path: string;
  question: string;
  /** The rung it could lead to. */
  couldLeadTo: RungId;
}

export interface Rejected {
  rung: RungId;
  label: string;
  reason: string;
}

export interface StepResult {
  stepId: string;
  rung: RungId;
  mechanism: Mechanism;
  label: string;
  aiNeeded: AiNeed;
  /** Said outright when a simpler mechanism does the job. */
  aiUnnecessary: boolean;
  human: HumanPoint;
  reasons: Reason[];
  rejected: Rejected[];
  unknowns: Unknown[];
  /** Questions to raise in the model, such as confirming an API for a system and operation. */
  questions: { target: { kind: 'step' | 'system'; id: string; field: string }; question: string; whyItMatters: string }[];
  confidence: Confidence;
}

export type RungId = '0' | '1' | '2' | '3' | '4' | '4a' | '5' | '6' | '7' | '8' | 'none';

// ---------------------------------------------------------------- facts of a step

interface Ctx {
  model: ProcessModel;
  step: Step;
  traits: StepTraits;
  systems: SystemRef[];
}

const LABEL: Record<string, string> = {
  rework: 'Rework or duplicate entry', physical: 'Physical action', judgment: 'Judgment or accountable decision',
  input: 'Form of the input', rulesComplete: 'Rules stated in full and stable', language: 'Works with free text',
  write: 'What the step changes', 'agent.ambiguity': 'Next action cannot be written as rules', 'agent.adaptive': 'Next step depends on findings',
  'agent.toolChoice': 'Needs a choice of tools or lines of enquiry', 'agent.value': 'An agent adds value over rules and a person',
  'agent.controllable': 'Actions can be bounded, logged and reversed',
};

const QUESTION: Record<string, (s: Step) => string> = {
  rework: s => `Is "${s.name}" rework or a duplicate entry of something done elsewhere?`,
  physical: s => `Does "${s.name}" need a physical action, such as handling paper or signing?`,
  judgment: s => `Does "${s.name}" need a judgment or a decision someone is accountable for?`,
  input: s => `What form is the input to "${s.name}": structured data, a document, or paper?`,
  rulesComplete: s => `Are the rules for "${s.name}" written down in full and stable?`,
  language: s => `Does "${s.name}" involve drafting, summarising or classifying free text?`,
  'agent.ambiguity': s => `Can the next action in "${s.name}" be written down as rules in advance?`,
};

function trait<K extends Exclude<keyof StepTraits, 'agent'>>(ctx: Ctx, k: K): Fact<NonNullable<StepTraits[K]> extends Fact<infer V> ? V : never> | null {
  const f = ctx.traits[k] as Fact<any> | undefined;
  return f && f.status !== 'unknown' && f.value !== null ? f : null;
}
function agentTrait(ctx: Ctx, k: keyof NonNullable<StepTraits['agent']>): Fact<boolean> | null {
  const f = ctx.traits.agent?.[k];
  return f && f.status !== 'unknown' && f.value !== null ? f : null;
}
const used = (path: string, f: Fact<unknown>, label = LABEL[path.replace(/^traits\./, '')] ?? path): FactUsed =>
  ({ path, label, value: f.value, status: f.status, sources: f.sources });

// Both variants name every field, so narrowing on `fires` works without strictNullChecks.
type Check =
  | { fires: true; reasons: Reason[]; reason?: undefined; human?: HumanPoint; questions?: StepResult['questions']; unknowns?: Unknown[] }
  | { fires: false; reason: string; reasons?: undefined; human?: undefined; questions?: undefined; unknowns?: Unknown[] };

interface Rung {
  id: RungId;
  mechanism: Mechanism;
  label: string;
  ai: AiNeed;
  human: HumanPoint;
  check(ctx: Ctx): Check;
}

const unknownTrait = (ctx: Ctx, k: string, rung: RungId): Unknown => ({ path: `traits.${k}`, question: (QUESTION[k] ?? (() => `${LABEL[k]}?`))(ctx.step), couldLeadTo: rung });

// ---------------------------------------------------------------- systems and their interfaces

const NON_INTEGRABLE: SystemRef['kind'][] = ['scanner'];
const apiOf = (s: SystemRef): AccessMethod[] => s.access.filter(a => a.method === 'api');
const words = (t: string) => new Set(t.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(w => w.length > 3));

/** Whether an interface's stated operations mention the work of the step. Unknown when none are listed. */
function covers(a: AccessMethod, step: Step): boolean | null {
  if (!a.operations.length) return null;
  const stepWords = words(`${step.name} ${step.description}`);
  return a.operations.some(op => [...words(op)].some(w => stepWords.has(w) || [...stepWords].some(s => s.startsWith(w.slice(0, 5)) && w.length >= 5)));
}

const integrable = (ctx: Ctx) => ctx.systems.filter(s => !NON_INTEGRABLE.includes(s.kind));
const accessFact = (s: SystemRef, a: AccessMethod): FactUsed =>
  ({ path: `systems.${s.id}.access.api`, label: `${s.name} API${a.name ? ` (${a.name})` : ''}`, value: a.access, status: a.status, sources: a.sources });

const UNSTRUCTURED: InputForm[] = ['unstructured', 'paper'];
const inputIsUnstructured = (ctx: Ctx) => { const f = trait(ctx, 'input'); return f ? UNSTRUCTURED.includes(f.value as InputForm) : null; };

/** Rungs 3 to 5 handle structured work; a step whose input must first be captured skips them. */
function needsCapture(ctx: Ctx): Check | null {
  const f = trait(ctx, 'input');
  if (f && UNSTRUCTURED.includes(f.value as InputForm)) return { fires: false, reason: `The input is ${f.value === 'paper' ? 'on paper' : 'unstructured'}; its fields have to be captured first.` };
  return null;
}

// ---------------------------------------------------------------- the ladder

export const LADDER: Rung[] = [
  {
    id: '0', mechanism: 'already_automated', label: 'Already done by a system', ai: 'no', human: 'none',
    check: ctx => ctx.step.taskType === 'service'
      ? { fires: true, reasons: [{ text: 'The sources describe this step as done by a system on its own; there is nothing to automate.', facts: [{ path: 'taskType', label: 'Step type', value: 'service', status: ctx.step.status, sources: ctx.step.sources }] }] }
      : { fires: false, reason: 'A person does this step today.' },
  },
  {
    id: '1', mechanism: 'eliminate', label: 'Eliminate or simplify first', ai: 'no', human: 'none',
    check: ctx => {
      const f = trait(ctx, 'rework');
      if (f?.value === true) return { fires: true, reasons: [{ text: 'This step is rework or a duplicate entry. Remove or simplify it before automating anything.', facts: [used('traits.rework', f)] }] };
      if (!f) return { fires: false, reason: 'Not known to be rework.', unknowns: [unknownTrait(ctx, 'rework', '1')] };
      return { fires: false, reason: 'The step produces its own output; it is not rework.' };
    },
  },
  {
    id: '2', mechanism: 'keep_human', label: 'Keep with a person', ai: 'no', human: 'decide',
    check: ctx => {
      const physical = trait(ctx, 'physical'), judgment = trait(ctx, 'judgment');
      const reasons: Reason[] = [];
      if (physical?.value === true) reasons.push({ text: 'The step needs a physical action.', facts: [used('traits.physical', physical)] });
      if (judgment?.value === true) reasons.push({ text: 'The step needs a judgment or a decision someone is accountable for.', facts: [used('traits.judgment', judgment)] });
      if (reasons.length) return { fires: true, reasons, human: judgment?.value === true ? 'decide' : 'does_it' };
      const unknowns = [...(!physical ? [unknownTrait(ctx, 'physical', '2')] : []), ...(!judgment ? [unknownTrait(ctx, 'judgment', '2')] : [])];
      return { fires: false, reason: unknowns.length ? 'Not known to need a physical action or an accountable judgment.' : 'No physical action or accountable judgment is involved.', unknowns };
    },
  },
  {
    id: '3', mechanism: 'rules', label: 'Rules or workflow, no AI', ai: 'no', human: 'none',
    check: ctx => {
      const skip = needsCapture(ctx);
      if (skip) return skip;
      const rules = trait(ctx, 'rulesComplete'), input = trait(ctx, 'input');
      const structured = input && (input.value === 'structured');
      if (rules?.value === true && structured) {
        const ruleFacts: FactUsed[] = ctx.step.ruleIds.map(id => ctx.model.rules.find(r => r.id === id)).filter(Boolean)
          .map(r => ({ path: `rules.${r!.id}`, label: r!.name, value: `${r!.condition} → ${r!.action}`, status: r!.status, sources: r!.sources }));
        return { fires: true, reasons: [{ text: 'The rules are stated in full and the input is structured data, so fixed rules or a workflow can do this. AI is unnecessary.', facts: [used('traits.rulesComplete', rules), used('traits.input', input!), ...ruleFacts] }] };
      }
      const unknowns: Unknown[] = [];
      if (!rules) unknowns.push(unknownTrait(ctx, 'rulesComplete', '3'));
      if (!input) unknowns.push(unknownTrait(ctx, 'input', '3'));
      if (rules?.value === false) return { fires: false, reason: 'The rules are not complete or not stable.', unknowns };
      if (input && !structured) return { fires: false, reason: 'The input is not fully structured.', unknowns };
      return { fires: false, reason: 'Not known whether complete rules and structured input exist.', unknowns };
    },
  },
  {
    id: '4', mechanism: 'api', label: 'System integration through an API', ai: 'no', human: 'none',
    check: ctx => {
      const skip = needsCapture(ctx);
      if (skip) return skip;
      const systems = integrable(ctx);
      if (!systems.length) return { fires: false, reason: 'The step does not read or write a system.' };
      for (const s of systems) for (const a of apiOf(s)) {
        if (a.access === 'confirmed' && covers(a, ctx.step) === true) {
          return { fires: true, reasons: [{ text: `${s.name} has a confirmed API${a.name ? ` (${a.name})` : ''} covering this work. Integrate through it; AI is unnecessary.`, facts: [accessFact(s, a)] }] };
        }
      }
      return { fires: false, reason: 'No confirmed API is known to cover this work.' };
    },
  },
  {
    id: '4a', mechanism: 'api_candidate', label: 'API first, once the API is confirmed', ai: 'undecided', human: 'none',
    check: ctx => {
      const skip = needsCapture(ctx);
      if (skip) return skip;
      const systems = integrable(ctx);
      if (!systems.length) return { fires: false, reason: 'The step does not read or write a system.' };
      const open = systems.filter(s => !apiOf(s).length || apiOf(s).some(a => a.access === 'reported' || a.access === 'unknown' || (a.access === 'confirmed' && covers(a, ctx.step) !== true)));
      if (!open.length) return { fires: false, reason: 'Every system involved is confirmed to have no usable API.' };
      const reasons: Reason[] = open.map(s => {
        const apis = apiOf(s);
        if (!apis.length) return { text: `Nobody has said whether ${s.name} has an API for this work.`, facts: [] };
        const a = apis[0];
        const text = a.access === 'confirmed'
          ? `${s.name} has a confirmed API, but it is not known to cover this operation.`
          : `${s.name} is ${a.access === 'reported' ? 'reported' : 'not known'} to have an API${a.name ? ` (${a.name})` : ''}; it is not confirmed for this work.`;
        return { text, facts: [accessFact(s, a)] };
      });
      return {
        fires: true, reasons: [...reasons, { text: 'Confirm the API before choosing between integration and UI automation.', facts: [] }],
        questions: open.map(s => ({ target: { kind: 'system' as const, id: s.id, field: 'access' }, question: `Confirm whether ${s.name} has an API that covers "${ctx.step.name}".`, whyItMatters: 'An API decides between system integration and UI automation for this step.' })),
      };
    },
  },
  {
    id: '5', mechanism: 'rpa', label: 'UI automation as a bridge', ai: 'no', human: 'none',
    check: ctx => {
      const skip = needsCapture(ctx);
      if (skip) return skip;
      const systems = integrable(ctx);
      if (!systems.length) return { fires: false, reason: 'The step does not use a system with screens to automate.' };
      const facts: FactUsed[] = [];
      const unknowns: Unknown[] = [];
      for (const s of systems) {
        const absent = apiOf(s).find(a => a.access === 'confirmed_absent');
        if (!absent) return { fires: false, reason: `${s.name} is not confirmed to lack an API.` };
        facts.push(accessFact(s, absent));
        if (s.uiStable && s.uiStable.status !== 'unknown' && s.uiStable.value !== null) {
          if (s.uiStable.value === false) return { fires: false, reason: `The screens of ${s.name} are not stable enough for UI automation.` };
          facts.push({ path: `systems.${s.id}.uiStable`, label: `${s.name} screens are stable`, value: true, status: s.uiStable.status, sources: s.uiStable.sources });
        } else {
          unknowns.push({ path: `systems.${s.id}.uiStable`, question: `Are the screens of ${s.name} stable enough for UI automation?`, couldLeadTo: 'none' });
        }
      }
      return { fires: true, reasons: [{ text: 'There is no API, so automating the screens is the bridge until one exists. AI is unnecessary.', facts }], unknowns };
    },
  },
  {
    id: '6', mechanism: 'extraction', label: 'Document extraction with validation', ai: 'yes', human: 'review',
    check: ctx => {
      const f = trait(ctx, 'input');
      if (f && UNSTRUCTURED.includes(f.value as InputForm)) {
        return { fires: true, reasons: [{ text: `The input is ${f.value === 'paper' ? 'on paper' : 'an unstructured document'}, so its fields need capturing. Use narrow extraction with a person reviewing low-confidence fields.`, facts: [used('traits.input', f)] }] };
      }
      return f ? { fires: false, reason: 'The input is already data, not a document to read.' } : { fires: false, reason: 'The form of the input is not known.', unknowns: [unknownTrait(ctx, 'input', '6')] };
    },
  },
  {
    id: '7', mechanism: 'ai_assist', label: 'AI assistance with a person reviewing', ai: 'yes', human: 'review',
    check: ctx => {
      const lang = trait(ctx, 'language'), rules = trait(ctx, 'rulesComplete');
      if (lang?.value === true && rules?.value !== true) {
        return { fires: true, reasons: [{ text: 'The step works with free text and no complete rules exist for it, so AI can draft or classify while a person reviews.', facts: [used('traits.language', lang), ...(rules ? [used('traits.rulesComplete', rules)] : [])] }] };
      }
      if (!lang) return { fires: false, reason: 'Not known to work with free text.', unknowns: [unknownTrait(ctx, 'language', '7')] };
      return { fires: false, reason: lang.value ? 'Complete rules exist, so AI is not needed.' : 'The step does not work with free text.' };
    },
  },
  {
    id: '8', mechanism: 'agent', label: 'Bounded agent', ai: 'yes', human: 'approve',
    check: ctx => {
      const keys = ['ambiguity', 'adaptive', 'toolChoice', 'value', 'controllable'] as const;
      const facts: FactUsed[] = [];
      for (const k of keys) {
        const f = agentTrait(ctx, k);
        if (!f) return { fires: false, reason: 'Not every condition for an agent is known to hold.', unknowns: [] };
        if (f.value !== true) return { fires: false, reason: `${LABEL[`agent.${k}`]}: no.` };
        facts.push(used(`traits.agent.${k}`, f, LABEL[`agent.${k}`]));
      }
      return { fires: true, reasons: [{ text: 'All five conditions for bounded agency hold: the path cannot be fixed in advance, it adapts to findings, it chooses tools, it adds value, and it can be controlled. A person approves its actions.', facts }] };
    },
  },
];

// ---------------------------------------------------------------- evaluation

const HUMAN_ORDER: HumanPoint[] = ['none', 'review', 'approve', 'decide', 'does_it'];
const stronger = (a: HumanPoint, b: HumanPoint) => (HUMAN_ORDER.indexOf(a) >= HUMAN_ORDER.indexOf(b) ? a : b);

function confidenceOf(reasons: Reason[], unknowns: Unknown[]): Confidence {
  const facts = reasons.flatMap(r => r.facts);
  if (facts.some(f => f.status === 'assumed') || unknowns.length > 2 || facts.length === 0) return 'low';
  if (facts.some(f => f.status === 'inferred') || unknowns.length > 0) return 'medium';
  return 'high';
}

export function evaluateStep(model: ProcessModel, step: Step): StepResult {
  const ctx: Ctx = { model, step, traits: step.traits ?? {}, systems: step.systemIds.map(id => model.systems.find(s => s.id === id)).filter((s): s is SystemRef => Boolean(s)) };
  const rejected: Rejected[] = [];
  const unknowns: Unknown[] = [];
  for (const rung of LADDER) {
    const c = rung.check(ctx);
    if (!c.fires) {
      rejected.push({ rung: rung.id, label: rung.label, reason: c.reason ?? '' });
      for (const u of c.unknowns ?? []) if (!unknowns.some(x => x.path === u.path)) unknowns.push(u);
      continue;
    }
    for (const u of c.unknowns ?? []) if (!unknowns.some(x => x.path === u.path)) unknowns.push(u);
    return finish(ctx, rung, c.reasons ?? [], c.human ?? rung.human, rejected, unknowns, c.questions ?? []);
  }
  const reasons: Reason[] = [{ text: 'No simpler mechanism fits on what is known, and the conditions for an agent do not all hold. Keep the step with a person; the facts below could change this.', facts: [] }];
  return finish(ctx, { id: 'none', mechanism: 'no_option', label: 'Keep with a person for now', ai: 'no', human: 'does_it', check: () => ({ fires: false, reason: '' }) }, reasons, 'does_it', rejected, unknowns, []);
}

const IMPACT_TEXT: Record<WriteImpact, string> = { none: '', record: '', financial: 'The step makes a financial change, so a person approves it before it takes effect.', irreversible: 'The step makes a change that cannot be undone, so a person approves it before it takes effect.' };

function finish(ctx: Ctx, rung: Rung, reasons: Reason[], human: HumanPoint, rejected: Rejected[], unknowns: Unknown[], questions: StepResult['questions']): StepResult {
  // Irreversible or financial writes keep a person's approval, whatever does the work (INT-005 to INT-007).
  const write = trait(ctx, 'write');
  const automated = !['keep_human', 'no_option', 'eliminate'].includes(rung.mechanism);
  if (automated && write && (write.value === 'financial' || write.value === 'irreversible')) {
    human = stronger(human, 'approve');
    reasons = [...reasons, { text: IMPACT_TEXT[write.value as WriteImpact], facts: [used('traits.write', write)] }];
  }
  return {
    stepId: ctx.step.id, rung: rung.id, mechanism: rung.mechanism, label: rung.label, aiNeeded: rung.ai,
    aiUnnecessary: rung.ai === 'no' && ['rules', 'api', 'rpa', 'already_automated'].includes(rung.mechanism),
    human, reasons, rejected, unknowns, questions, confidence: confidenceOf(reasons, unknowns),
  };
}

export function evaluateSteps(model: ProcessModel): StepResult[] {
  return model.steps.map(s => evaluateStep(model, s));
}

export { inputIsUnstructured };
