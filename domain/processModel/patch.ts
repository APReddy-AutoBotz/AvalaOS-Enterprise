// Edit operations on a Process Model. Each takes a valid model and returns the next model and the
// JSON Patch that produces it. An operation that would leave the model invalid throws instead,
// so a stored model can only move from valid to valid.
//
// Edits made through these operations are a person's decisions: the element they touch becomes
// 'user-confirmed' and keeps the sources it already had.
import { applyPatch, diff, type JsonPatchOp } from './jsonPatch.ts';
import type { AccessStatus, ChangeLevel, ElementTarget, Fact, Flow, MetricKind, ProcessBrief, ProcessModel, ProcessProfile, Role, Step, StepTraits, SystemRef, TypicalTraits } from './types.ts';
import { isProcessLevel, metricNumber, processMetricSlot } from './selectors.ts';
import { errorsOf, validateModel, type ValidationIssue } from './validate.ts';
import { mergeApplication, type Application } from '../workspace/applications.ts';

export interface OpResult {
  model: ProcessModel;
  patch: JsonPatchOp[];
}

export class ModelOpError extends Error {
  readonly code: string;
  readonly issues: ValidationIssue[];
  constructor(code: string, message: string, issues: ValidationIssue[] = []) { super(message); this.code = code; this.issues = issues; }
}

const clone = (m: ProcessModel): ProcessModel => JSON.parse(JSON.stringify(m));

function allIds(m: ProcessModel): Set<string> {
  const ids = new Set<string>();
  const add = (list: { id: string }[]) => list.forEach(x => ids.add(x.id));
  add(m.meta.scopeIn); add(m.meta.scopeOut); add(m.meta.metrics);
  add(m.roles); add(m.systems); add(m.events); add(m.steps); add(m.gateways); add(m.flows); add(m.rules);
  add(m.exceptions); add(m.dataObjects); add(m.painPoints); add(m.controls); add(m.risks); add(m.openQuestions); add(m.conflicts);
  return ids;
}

/** The first unused id of the form `${prefix}-${n}`. Deterministic, so a replayed edit gets the same id. */
export function newId(m: ProcessModel, prefix: string, taken: Set<string> = allIds(m)): string {
  for (let n = 1; ; n++) {
    const id = `${prefix}-${n}`;
    if (!taken.has(id)) { taken.add(id); return id; }
  }
}

/** Runs `edit` on a copy, checks the result, and returns it with its patch. */
function commit(model: ProcessModel, edit: (m: ProcessModel) => void): OpResult {
  const before = validateModel(model);
  if (!before.valid) throw new ModelOpError('INVALID_INPUT', 'The model is not valid; fix it before editing.', errorsOf(before));
  const next = clone(model);
  edit(next);
  const after = validateModel(next);
  if (!after.valid) throw new ModelOpError('INVALID_RESULT', errorsOf(after)[0].message, errorsOf(after));
  const patch = diff(model, next);
  return { model: applyPatch(model, patch), patch };
}

const isNode = (m: ProcessModel, id: string) => m.steps.some(s => s.id === id) || m.events.some(e => e.id === id) || m.gateways.some(g => g.id === id);
const eventKind = (m: ProcessModel, id: string) => m.events.find(e => e.id === id)?.kind;

// ---------------------------------------------------------------- flow surgery (on a working copy)

function detach(m: ProcessModel, stepId: string): void {
  const ins = m.flows.filter(f => f.to === stepId);
  const outs = m.flows.filter(f => f.from === stepId);
  m.flows = m.flows.filter(f => f.to !== stepId && f.from !== stepId);
  const taken = allIds(m);
  for (const i of ins) {
    for (const o of outs) {
      if (i.from === o.to || m.flows.some(f => f.from === i.from && f.to === o.to)) continue;
      const label = outs.length > 1 ? o.label : i.label;
      const flow: Flow = { id: newId(m, 'f', taken), from: i.from, to: o.to };
      if (label !== undefined) flow.label = label;
      if (i.isException || o.isException) flow.isException = true;
      m.flows.push(flow);
    }
  }
}

function attach(m: ProcessModel, stepId: string, after?: string, before?: string): void {
  for (const [id, role] of [[after, 'after'], [before, 'before']] as const) {
    if (id === undefined) continue;
    if (id === stepId) throw new ModelOpError('BAD_POSITION', 'A step cannot be placed next to itself.');
    if (!isNode(m, id)) throw new ModelOpError('NOT_FOUND', `No event, step or gateway with id ${id}.`);
    if (role === 'after' && eventKind(m, id) === 'end') throw new ModelOpError('BAD_POSITION', 'Nothing can follow an end event.');
    if (role === 'before' && eventKind(m, id) === 'start') throw new ModelOpError('BAD_POSITION', 'Nothing can precede a start event.');
  }
  const taken = allIds(m);
  const split = (f: Flow) => {
    m.flows = m.flows.filter(x => x !== f);
    const first: Flow = { id: f.id, from: f.from, to: stepId };
    if (f.label !== undefined) first.label = f.label;
    if (f.isException) first.isException = true;
    const second: Flow = { id: newId(m, 'f', taken), from: stepId, to: f.to };
    if (f.isException) second.isException = true;
    m.flows.push(first, second);
  };
  const link = (from: string, to: string) => m.flows.push({ id: newId(m, 'f', taken), from, to });

  if (after !== undefined && before !== undefined) {
    const f = m.flows.find(x => x.from === after && x.to === before);
    if (!f) throw new ModelOpError('BAD_POSITION', `There is no flow from ${after} to ${before} to insert into.`);
    split(f);
  } else if (after !== undefined) {
    const outs = m.flows.filter(x => x.from === after);
    if (outs.length === 0) link(after, stepId);
    else if (outs.length === 1) split(outs[0]);
    else throw new ModelOpError('AMBIGUOUS_POSITION', `${after} has ${outs.length} outgoing paths; say which one with "before".`);
  } else if (before !== undefined) {
    const ins = m.flows.filter(x => x.to === before);
    if (ins.length === 0) link(stepId, before);
    else if (ins.length === 1) split(ins[0]);
    else throw new ModelOpError('AMBIGUOUS_POSITION', `${before} has ${ins.length} incoming paths; say which one with "after".`);
  }
}

// ---------------------------------------------------------------- operations

export type StepInput = Pick<Step, 'name' | 'taskType'> & Partial<Omit<Step, 'name' | 'taskType'>>;

/** Adds a step. With `after` and/or `before` it is inserted into the flow at that point. */
export function addStep(model: ProcessModel, args: { step: StepInput; after?: string; before?: string }): OpResult & { stepId: string } {
  let stepId = '';
  const result = commit(model, m => {
    stepId = args.step.id ?? newId(m, 's');
    if (allIds(m).has(stepId)) throw new ModelOpError('ID_TAKEN', `Id ${stepId} is already used.`);
    const step: Step = {
      id: stepId,
      name: args.step.name,
      description: args.step.description ?? '',
      roleIds: args.step.roleIds ?? [],
      systemIds: args.step.systemIds ?? [],
      taskType: args.step.taskType,
      inputs: args.step.inputs ?? [],
      outputs: args.step.outputs ?? [],
      ruleIds: args.step.ruleIds ?? [],
      exceptionIds: args.step.exceptionIds ?? [],
      status: args.step.status ?? 'user-confirmed',
      sources: args.step.sources ?? [],
    };
    m.steps.push(step);
    attach(m, stepId, args.after, args.before);
  });
  return { ...result, stepId };
}

/** Removes a step, joins its predecessors to its successors, and removes references to it. */
export function removeStep(model: ProcessModel, args: { stepId: string }): OpResult {
  if (!model.steps.some(s => s.id === args.stepId)) throw new ModelOpError('NOT_FOUND', `No step with id ${args.stepId}.`);
  return commit(model, m => takeOutStep(m, args.stepId));
}

/** Takes a step out of a working copy: its neighbours are joined and nothing keeps pointing at it. */
function takeOutStep(m: ProcessModel, stepId: string): void {
  detach(m, stepId);
  m.steps = m.steps.filter(s => s.id !== stepId);
  const drop = (ids: string[]) => ids.filter(id => id !== stepId);
  m.exceptions.forEach(x => { x.stepIds = drop(x.stepIds); });
  m.painPoints.forEach(n => { n.stepIds = drop(n.stepIds); });
  m.risks.forEach(n => { n.stepIds = drop(n.stepIds); });
  m.controls.forEach(n => { n.stepIds = drop(n.stepIds); });
  const targetsStep = (t: ElementTarget) => t.kind === 'step' && t.id === stepId;
  m.openQuestions = m.openQuestions.filter(q => !targetsStep(q.target));
  m.conflicts = m.conflicts.filter(c => !targetsStep(c.target));
  m.meta.metrics.forEach(x => { if (x.appliesTo === stepId) delete x.appliesTo; });
}

/** Moves a step to a new position in the flow; its old neighbours are joined. */
export function moveStep(model: ProcessModel, args: { stepId: string; after?: string; before?: string }): OpResult {
  if (!model.steps.some(s => s.id === args.stepId)) throw new ModelOpError('NOT_FOUND', `No step with id ${args.stepId}.`);
  if (args.after === undefined && args.before === undefined) throw new ModelOpError('BAD_POSITION', 'Say where the step goes with "after" or "before".');
  return commit(model, m => {
    detach(m, args.stepId);
    attach(m, args.stepId, args.after, args.before);
  });
}

export function addFlow(model: ProcessModel, args: { from: string; to: string; label?: string; isException?: boolean }): OpResult & { flowId: string } {
  let flowId = '';
  const result = commit(model, m => {
    flowId = newId(m, 'f');
    const flow: Flow = { id: flowId, from: args.from, to: args.to };
    if (args.label !== undefined) flow.label = args.label;
    if (args.isException) flow.isException = true;
    m.flows.push(flow);
  });
  return { ...result, flowId };
}

export function removeFlow(model: ProcessModel, args: { flowId: string }): OpResult {
  if (!model.flows.some(f => f.id === args.flowId)) throw new ModelOpError('NOT_FOUND', `No flow with id ${args.flowId}.`);
  return commit(model, m => { m.flows = m.flows.filter(f => f.id !== args.flowId); });
}

/** Fields a person may edit, per element kind. Ids and provenance are never edited directly. */
export const EDITABLE_FIELDS: Record<ElementTarget['kind'], readonly string[]> = {
  meta: ['name', 'objective', 'owner'],
  role: ['name', 'kind', 'inScope'],
  system: ['name', 'kind', 'version', 'inScope', 'access'],
  step: ['name', 'description', 'roleIds', 'systemIds', 'taskType', 'inputs', 'outputs', 'ruleIds', 'exceptionIds'],
  gateway: ['question', 'type'],
  rule: ['name', 'condition', 'action'],
  exception: ['name', 'kind', 'trigger', 'stepIds', 'handling', 'routedToRoleId'],
  metric: ['label', 'value', 'range', 'unit', 'appliesTo', 'period'],
  data: ['name', 'format', 'structured', 'classification'],
};

function collection(m: ProcessModel, kind: Exclude<ElementTarget['kind'], 'meta'>): any[] {
  switch (kind) {
    case 'role': return m.roles;
    case 'system': return m.systems;
    case 'step': return m.steps;
    case 'gateway': return m.gateways;
    case 'rule': return m.rules;
    case 'exception': return m.exceptions;
    case 'metric': return m.meta.metrics;
    case 'data': return m.dataObjects;
  }
}

function setField(m: ProcessModel, target: ElementTarget, value: unknown): void {
  const field = target.field;
  if (!field || !EDITABLE_FIELDS[target.kind]?.includes(field)) {
    throw new ModelOpError('NOT_EDITABLE', `${target.kind}.${String(field)} cannot be edited.`);
  }
  if (target.kind === 'meta') {
    if (field === 'name') { m.meta.name = value as string; return; }
    const fact = m.meta[field as 'objective' | 'owner'];
    fact.value = value as string | null;
    fact.status = value === null ? 'unknown' : 'user-confirmed';
    return;
  }
  const el = collection(m, target.kind).find(x => x.id === target.id);
  if (!el) throw new ModelOpError('NOT_FOUND', `No ${target.kind} with id ${String(target.id)}.`);
  if (value === undefined) delete el[field];
  else el[field] = value;
  el.status = target.kind === 'metric' && value === null && field === 'value' ? 'unknown' : 'user-confirmed';
}

/** Sets one field of one element. The element becomes user-confirmed (or unknown when a metric is cleared). */
export function updateFact(model: ProcessModel, args: { target: ElementTarget; value: unknown }): OpResult {
  return commit(model, m => setField(m, args.target, args.value));
}

/** Answers an open question. With `value`, the answer is also written to the field the question is about. */
export function answerQuestion(model: ProcessModel, args: { questionId: string; answer: string; value?: unknown }): OpResult {
  return commit(model, m => {
    const q = m.openQuestions.find(x => x.id === args.questionId);
    if (!q) throw new ModelOpError('NOT_FOUND', `No question with id ${args.questionId}.`);
    q.status = 'answered';
    q.answer = args.answer;
    if (args.value !== undefined) setField(m, q.target, args.value);
  });
}

/** Records which conflicting value is correct, who chose it and why. With `value`, it is written to the target field. */
export function resolveConflict(model: ProcessModel, args: { conflictId: string; chosen: string; by: string; reason: string; value?: unknown }): OpResult {
  return commit(model, m => {
    const c = m.conflicts.find(x => x.id === args.conflictId);
    if (!c) throw new ModelOpError('NOT_FOUND', `No conflict with id ${args.conflictId}.`);
    c.resolution = { chosen: args.chosen, by: args.by, reason: args.reason };
    if (args.value !== undefined) setField(m, c.target, args.value);
  });
}

// ---------------------------------------------------------------- roles, systems, rules

/** Adds a role a person named. It starts with no sources: it is the person's statement. */
export function addRole(model: ProcessModel, args: { name: string; kind: Role['kind'] }): OpResult & { roleId: string } {
  let roleId = '';
  const name = args.name.trim();
  if (!name) throw new ModelOpError('EMPTY', 'Name the role.');
  if (model.roles.some(r => r.name.toLowerCase() === name.toLowerCase())) throw new ModelOpError('DUPLICATE', `There is already a role called ${name}.`);
  const result = commit(model, m => {
    roleId = newId(m, 'r');
    m.roles.push({ id: roleId, name, kind: args.kind, inScope: args.kind !== 'external', status: 'user-confirmed', sources: [] });
  });
  return { ...result, roleId };
}

/** Adds a system a person named. Its access methods start empty: unknown until someone confirms one. */
export function addSystem(model: ProcessModel, args: { name: string; kind: SystemRef['kind'] }): OpResult & { systemId: string } {
  let systemId = '';
  const name = args.name.trim();
  if (!name) throw new ModelOpError('EMPTY', 'Name the system.');
  if (model.systems.some(s => s.name.toLowerCase() === name.toLowerCase())) throw new ModelOpError('DUPLICATE', `There is already a system called ${name}.`);
  const result = commit(model, m => {
    systemId = newId(m, 'sys');
    m.systems.push({ id: systemId, name, kind: args.kind, inScope: true, access: [], status: 'user-confirmed', sources: [] });
  });
  return { ...result, systemId };
}

/** Adds a business rule; both the condition and the action are required. */
export function addRule(model: ProcessModel, args: { name: string; condition: string; action: string }): OpResult & { ruleId: string } {
  let ruleId = '';
  const result = commit(model, m => {
    ruleId = newId(m, 'br');
    m.rules.push({ id: ruleId, name: args.name.trim(), condition: args.condition.trim(), action: args.action.trim(), status: 'user-confirmed', sources: [] });
  });
  return { ...result, ruleId };
}

/** Removes a role, system, rule, exception or data object and every reference to it. */
export function removeElement(model: ProcessModel, args: { kind: 'role' | 'system' | 'rule' | 'exception' | 'data'; id: string }): OpResult {
  const { kind, id } = args;
  const list = { role: model.roles, system: model.systems, rule: model.rules, exception: model.exceptions, data: model.dataObjects }[kind];
  if (!list.some(x => x.id === id)) throw new ModelOpError('NOT_FOUND', `No ${kind} with id ${id}.`);
  return commit(model, m => {
    const drop = (ids: string[]) => ids.filter(x => x !== id);
    if (kind === 'role') {
      m.roles = m.roles.filter(x => x.id !== id);
      m.steps.forEach(s => { s.roleIds = drop(s.roleIds); });
      m.exceptions.forEach(x => { if (x.routedToRoleId === id) delete x.routedToRoleId; });
    } else if (kind === 'system') {
      m.systems = m.systems.filter(x => x.id !== id);
      m.steps.forEach(s => { s.systemIds = drop(s.systemIds); });
    } else if (kind === 'rule') {
      m.rules = m.rules.filter(x => x.id !== id);
      m.steps.forEach(s => { s.ruleIds = drop(s.ruleIds); });
      m.controls.forEach(c => { c.ruleIds = drop(c.ruleIds); });
    } else if (kind === 'exception') {
      m.exceptions = m.exceptions.filter(x => x.id !== id);
      m.steps.forEach(s => { s.exceptionIds = drop(s.exceptionIds); });
    } else {
      m.dataObjects = m.dataObjects.filter(x => x.id !== id);
    }
    const about = (t: ElementTarget) => t.kind === kind && t.id === id;
    m.openQuestions = m.openQuestions.filter(q => !about(q.target));
    m.conflicts = m.conflicts.filter(c => !about(c.target));
  });
}

/** Records an open question about one element or field, for example a gap someone wants tracked. */
export function addQuestion(model: ProcessModel, args: { target: ElementTarget; question: string; whyItMatters?: string; owner?: string | null }): OpResult & { questionId: string } {
  const question = args.question.trim();
  if (!question) throw new ModelOpError('EMPTY', 'Write the question.');
  const same = (t: ElementTarget) => t.kind === args.target.kind && t.id === args.target.id && t.field === args.target.field;
  if (model.openQuestions.some(q => q.status === 'open' && same(q.target) && q.question === question)) throw new ModelOpError('DUPLICATE', 'This question is already open.');
  let questionId = '';
  const result = commit(model, m => {
    questionId = newId(m, 'q');
    m.openQuestions.push({ id: questionId, target: args.target, question, whyItMatters: (args.whyItMatters ?? '').trim(), owner: args.owner ?? null, status: 'open' });
  });
  return { ...result, questionId };
}

// ---------------------------------------------------------------- assessment facts

export type TraitName = Exclude<keyof StepTraits, 'agent'> | `agent.${keyof NonNullable<StepTraits['agent']>}`;

const confirmed = <T>(value: T | null): Fact<T> => ({ value, status: value === null ? 'unknown' : 'user-confirmed', sources: [] });

/**
 * A person states (or clears, with null) one assessment trait of a step. Only the trait changes;
 * the step's own status does not, because the step itself was not edited.
 */
export function setStepTrait(model: ProcessModel, args: { stepId: string; trait: TraitName; value: unknown }): OpResult {
  return commit(model, m => {
    const step = m.steps.find(s => s.id === args.stepId);
    if (!step) throw new ModelOpError('NOT_FOUND', `No step with id ${args.stepId}.`);
    const traits: StepTraits = step.traits ?? {};
    const [head, sub] = args.trait.split('.') as [keyof StepTraits, string | undefined];
    if (head === 'agent') {
      const agent = { ...(traits.agent ?? {}) } as Record<string, Fact<boolean>>;
      agent[sub!] = confirmed(args.value as boolean | null);
      traits.agent = agent;
    } else {
      (traits as Record<string, unknown>)[head] = confirmed(args.value);
    }
    step.traits = traits;
  });
}

/** A person states whether a system's screens are stable enough for UI automation (null clears it). */
export function setSystemUiStable(model: ProcessModel, args: { systemId: string; value: boolean | null }): OpResult {
  return commit(model, m => {
    const sys = m.systems.find(s => s.id === args.systemId);
    if (!sys) throw new ModelOpError('NOT_FOUND', `No system with id ${args.systemId}.`);
    sys.uiStable = confirmed(args.value);
  });
}

/** A person states whether a system is reached through a remote desktop (null clears it). */
export function setSystemRemote(model: ProcessModel, args: { systemId: string; value: boolean | null }): OpResult {
  return commit(model, m => {
    const sys = m.systems.find(s => s.id === args.systemId);
    if (!sys) throw new ModelOpError('NOT_FOUND', `No system with id ${args.systemId}.`);
    sys.remote = confirmed(args.value);
  });
}

/**
 * A person states whether a system has an API that can be used for this process. Interfaces read
 * from the sources keep their names and operations and take the new status; when none is recorded,
 * one is added. An API a person confirms without listing operations counts for all the system's steps.
 */
export function setSystemApi(model: ProcessModel, args: { systemId: string; access: AccessStatus }): OpResult {
  return commit(model, m => {
    const sys = m.systems.find(s => s.id === args.systemId);
    if (!sys) throw new ModelOpError('NOT_FOUND', `No system with id ${args.systemId}.`);
    const apis = sys.access.filter(a => a.method === 'api');
    if (apis.length) for (const a of apis) { a.access = args.access; a.status = 'user-confirmed'; }
    else if (args.access !== 'unknown') sys.access.push({ method: 'api', operations: [], access: args.access, status: 'user-confirmed', sources: [] });
  });
}

/** A person states (or clears, with null) one fact of the process profile. */
export function setProfileFact(model: ProcessModel, args: { fact: 'processChange' | 'systemChange'; value: ChangeLevel | null }): OpResult {
  return commit(model, m => {
    m.meta.profile = { ...(m.meta.profile ?? {}), [args.fact]: confirmed(args.value) };
  });
}

/**
 * A person states (or clears, with null) one line of the brief (docs/effort-first-plan.md, part A).
 * The line becomes theirs: a later reading of the sources never overwrites it (`adoptBrief`).
 */
export function setBriefFact<K extends keyof ProcessBrief>(model: ProcessModel, args: { fact: K; value: NonNullable<ProcessBrief[K]>['value'] }): OpResult {
  return commit(model, m => {
    m.meta.brief = { ...(m.meta.brief ?? {}), [args.fact]: confirmed(args.value as never) };
  });
}

/**
 * A person confirms the brief as it stands: every line read from the sources becomes confirmed and
 * keeps its passages. Lines the sources are silent on stay unknown; nothing is filled in for them.
 */
export function confirmBrief(model: ProcessModel): OpResult {
  return commit(model, m => {
    const b = m.meta.brief ?? {};
    for (const k of Object.keys(b) as (keyof ProcessBrief)[]) {
      const f = b[k];
      if (f && (f.status === 'stated' || f.status === 'inferred')) f.status = 'user-confirmed';
    }
    m.meta.brief = b;
  });
}

/**
 * The brief as read from the sources goes into the model. A line a person gave or confirmed is never
 * replaced; every other line takes the reading, including "the sources do not say" (unknown).
 */
export function adoptBrief(model: ProcessModel, read: ProcessBrief): OpResult {
  return commit(model, m => {
    const b: ProcessBrief = { ...(m.meta.brief ?? {}) };
    for (const k of Object.keys(read) as (keyof ProcessBrief)[]) {
      if (b[k]?.status === 'user-confirmed') continue;
      (b as Record<string, unknown>)[k] = read[k];
    }
    m.meta.brief = b;
  });
}

// ---- a typical process to start from (docs/effort-first-plan.md, part I) ----------------------

/**
 * Starts an empty process from a reference process: every element typical, the applications mapped to
 * the ones the person named (domain/reference/typical.ts `typicalElements`). Only on a process with no
 * steps yet: a reference is a start, never laid over what the sources say.
 */
export function startFromTypical(model: ProcessModel, args: { elements: Pick<ProcessModel, 'roles' | 'systems' | 'events' | 'steps' | 'gateways' | 'flows' | 'rules' | 'exceptions'>; from?: string }): OpResult {
  if (model.steps.length) throw new ModelOpError('NOT_EMPTY', 'A typical process is only a start: this process already has steps.');
  return commit(model, m => {
    const e = args.elements;
    m.roles = [...m.roles, ...e.roles.filter(r => !m.roles.some(x => x.id === r.id))];
    m.systems = [...m.systems, ...e.systems.filter(s => !m.systems.some(x => x.id === s.id || x.name.toLowerCase() === s.name.toLowerCase()))];
    m.events = e.events; m.steps = e.steps; m.gateways = e.gateways; m.flows = e.flows; m.rules = e.rules; m.exceptions = e.exceptions;
    if (args.from) m.meta.startedFrom = args.from;
  });
}

type TypicalTarget = { kind: 'step' | 'rule' | 'exception' | 'role' | 'system' | 'gateway' | 'event'; id: string };
const typicalList = (m: ProcessModel, kind: TypicalTarget['kind']): { id: string; status: string }[] =>
  ({ step: m.steps, rule: m.rules, exception: m.exceptions, role: m.roles, system: m.systems, gateway: m.gateways, event: m.events })[kind];

/**
 * After typical steps are taken out of a working copy, what only they needed goes too, so nobody is
 * asked about it: a typical application no step uses any more, and a typical decision point that no
 * longer decides anything (every way out of it leads to the same place). A person's own applications
 * and decision points are never touched.
 */
function tidyTypical(m: ProcessModel): void {
  const unused = new Set(m.systems.filter(s => s.status === 'typical' && !m.steps.some(st => st.systemIds.includes(s.id))).map(s => s.id));
  if (unused.size) {
    m.systems = m.systems.filter(s => !unused.has(s.id));
    const about = (t: ElementTarget) => t.kind === 'system' && unused.has(t.id ?? '');
    m.openQuestions = m.openQuestions.filter(q => !about(q.target));
    m.conflicts = m.conflicts.filter(c => !about(c.target));
  }
  for (let again = true; again;) {
    again = false;
    for (const g of m.gateways.filter(x => x.status === 'typical')) {
      const outs = m.flows.filter(f => f.from === g.id);
      const targets = [...new Set(outs.map(f => f.to))];
      if (targets.length !== 1 || targets[0] === g.id) continue;
      const to = targets[0];
      const ins = m.flows.filter(f => f.to === g.id);
      m.flows = m.flows.filter(f => f.from !== g.id && f.to !== g.id);
      for (const i of ins) {
        if (i.from === to || m.flows.some(f => f.from === i.from && f.to === to)) continue;
        const flow: Flow = { id: i.id, from: i.from, to };
        if (i.label !== undefined) flow.label = i.label;
        if (i.isException || outs.every(o => o.isException)) flow.isException = true;
        m.flows.push(flow);
      }
      m.gateways = m.gateways.filter(x => x.id !== g.id);
      const about = (t: ElementTarget) => t.kind === 'gateway' && t.id === g.id;
      m.openQuestions = m.openQuestions.filter(q => !about(q.target));
      m.conflicts = m.conflicts.filter(c => !about(c.target));
      again = true;
      break;
    }
  }
}

/**
 * A person confirms a typical item: "we do this" (as it stands) or "ours is different" (with their own
 * name and description, or rule wording). It becomes theirs (confirmed by a person).
 */
export function confirmTypical(model: ProcessModel, args: TypicalTarget & { name?: string; detail?: string }): OpResult {
  const item = typicalList(model, args.kind).find(x => x.id === args.id);
  if (!item) throw new ModelOpError('NOT_FOUND', `No ${args.kind} with id ${args.id}.`);
  if (item.status !== 'typical') throw new ModelOpError('NOT_TYPICAL', 'Only a typical item is confirmed this way.');
  const name = args.name?.trim(), detail = args.detail?.trim();
  return commit(model, m => {
    const x = typicalList(m, args.kind).find(y => y.id === args.id)! as Record<string, unknown>;
    x.status = 'user-confirmed';
    if (name) { if (args.kind === 'gateway') x.question = name; else x.name = name; }
    if (detail !== undefined && detail !== '') {
      if (args.kind === 'step') x.description = detail;
      else if (args.kind === 'rule') x.action = detail;
      else if (args.kind === 'exception') x.handling = detail;
    }
  });
}

/**
 * The last card of the confirm pass: the typical roles, applications, decision points and events that
 * connect the steps people have confirmed. Only once no typical step, rule or exception is left; roles and
 * applications may be renamed on the way (an application still named "Your ..." must be named first).
 */
export function confirmTypicalRest(model: ProcessModel, args: { names?: Record<string, string> } = {}): OpResult {
  if ([...model.steps, ...model.rules, ...model.exceptions].some(x => x.status === 'typical')) {
    throw new ModelOpError('STEPS_FIRST', 'Confirm or take out the typical steps, rules and exceptions first.');
  }
  const names = args.names ?? {};
  const named = (id: string, old: string) => (names[id]?.trim() || old);
  // Only an application a step still uses needs a name; one no step uses goes out with this confirmation.
  const used = (id: string) => model.steps.some(st => st.systemIds.includes(id));
  const placeholder = model.systems.find(s => s.status === 'typical' && used(s.id) && /^Your /.test(named(s.id, s.name)));
  if (placeholder) throw new ModelOpError('NAME_APPLICATION', `Give "${placeholder.name}" the name of your application first, or say you don't use it.`);
  return commit(model, m => {
    tidyTypical(m);
    for (const r of m.roles) if (r.status === 'typical') { r.name = named(r.id, r.name); r.status = 'user-confirmed'; }
    for (const s of m.systems) if (s.status === 'typical') { s.name = named(s.id, s.name); s.status = 'user-confirmed'; }
    for (const g of m.gateways) if (g.status === 'typical') g.status = 'user-confirmed';
    for (const e of m.events) if (e.status === 'typical') e.status = 'user-confirmed';
  });
}

/**
 * "We don't do this": a typical step, rule or exception is taken out (a step's neighbours are joined),
 * and "We don't use it": a typical application is taken off the steps that named it. What only the
 * taken-out steps needed goes with them (`tidyTypical`).
 */
export function dropTypical(model: ProcessModel, args: { kind: 'step' | 'rule' | 'exception' | 'system'; id: string }): OpResult {
  const item = typicalList(model, args.kind).find(x => x.id === args.id);
  if (!item) throw new ModelOpError('NOT_FOUND', `No ${args.kind} with id ${args.id}.`);
  if (item.status !== 'typical') throw new ModelOpError('NOT_TYPICAL', 'Only a typical item is taken out this way; delete your own in the Process stage.');
  if (args.kind === 'step') return commit(model, m => { takeOutStep(m, args.id); tidyTypical(m); });
  return removeElement(model, { kind: args.kind, id: args.id });
}

/**
 * With documents present, a person adds one step of the reference the sources do not mention: it comes
 * in typical, at the end of the steps, with no role or application the process does not have.
 */
export function addTypicalStep(model: ProcessModel, args: { step: Pick<Step, 'id' | 'name' | 'description' | 'taskType'> }): OpResult & { stepId: string } {
  const id = allIds(model).has(args.step.id) ? undefined : args.step.id;
  return addStep(model, { step: { ...(id ? { id } : {}), name: args.step.name, description: args.step.description, taskType: args.step.taskType, status: 'typical', sources: [] } });
}

export const PROCESS_METRICS: Partial<Record<MetricKind, { label: string; unit: string }>> = {
  volume: { label: 'Cases handled', unit: 'cases' },
  handling_time: { label: 'Hands-on time per case', unit: 'minutes' },
  fte: { label: 'People doing this work', unit: 'FTE' },
  exception_rate: { label: 'Cases that leave the standard path', unit: '%' },
};
export const PERIODS = ['day', 'week', 'month', 'quarter', 'year'] as const;

/**
 * A person states (or clears, with null) one whole-process number: volume, handling time, team
 * size or exception rate. The metric that holds the number (see `processMetricSlot`) is updated, so a figure read
 * from the sources is corrected in place and keeps its quotes; otherwise one is added.
 */
export function setProcessMetric(model: ProcessModel, args: { kind: keyof typeof PROCESS_METRICS; value: number | null; period?: typeof PERIODS[number]; /** For handling time. */ unit?: 'minutes' | 'hours' }): OpResult {
  const def = PROCESS_METRICS[args.kind];
  if (!def) throw new ModelOpError('BAD_INPUT', `${args.kind} is not a whole-process number.`);
  if (args.value !== null && (!Number.isFinite(args.value) || args.value < 0)) throw new ModelOpError('BAD_INPUT', 'Enter a number of zero or more.');
  if (args.kind === 'exception_rate' && args.value !== null && args.value > 100) throw new ModelOpError('BAD_INPUT', 'A percentage is between 0 and 100.');
  return commit(model, m => {
    const unit = args.kind === 'volume' ? `cases/${args.period ?? 'month'}` : args.kind === 'handling_time' && args.unit ? args.unit : def.unit;
    const existing = processMetricSlot(m, args.kind);
    if (existing) {
      existing.appliesTo = 'process';
      existing.value = args.value;
      delete existing.range;
      existing.status = args.value === null ? 'unknown' : 'user-confirmed';
      if (args.kind === 'volume') { existing.unit = unit; delete existing.period; } else existing.unit = unit;
    } else if (args.value !== null) {
      m.meta.metrics.push({ id: newId(m, 'metric'), kind: args.kind, label: def.label, value: args.value, unit, appliesTo: 'process', status: 'user-confirmed', sources: [] });
    }
  });
}

/**
 * A person chooses which figure from the sources is the whole-process number of its kind. The
 * figure keeps its value, status and quotes; any other marked for the process goes back to its label.
 */
export function adoptProcessMetric(model: ProcessModel, args: { metricId: string }): OpResult {
  return commit(model, m => {
    const metric = m.meta.metrics.find(x => x.id === args.metricId);
    if (!metric) throw new ModelOpError('NOT_FOUND', `No metric with id ${args.metricId}.`);
    for (const x of m.meta.metrics) if (x.kind === metric.kind && x !== metric && isProcessLevel(x)) x.appliesTo = x.label;
    metric.appliesTo = 'process';
  });
}

/**
 * A person records a working assumption: the hands-on time per case, less the time already known
 * on steps, is spread evenly over the steps people do whose time is not known. Each gets status
 * 'assumed', so it shows as an assumption until someone confirms the real time.
 */
export function assumeEvenEffort(model: ProcessModel, args: { minutesPerCase: number }): OpResult {
  return commit(model, m => {
    const people = m.steps.filter(s => s.taskType !== 'service');
    const knownEffort = (s: Step) => { const f = s.traits?.effortMinutes; return f && f.status !== 'unknown' && f.value !== null ? f.value : null; };
    const blank = people.filter(s => knownEffort(s) === null);
    const left = args.minutesPerCase - people.reduce((t, s) => t + (knownEffort(s) ?? 0), 0);
    if (!blank.length) throw new ModelOpError('BAD_INPUT', 'Every step already has a time.');
    if (!(left > 0)) throw new ModelOpError('BAD_INPUT', 'The step times already add up to the time per case.');
    const each = Math.round((left / blank.length) * 100) / 100;
    for (const s of blank) s.traits = { ...(s.traits ?? {}), effortMinutes: { value: each, status: 'assumed', sources: [], note: 'Time per case spread evenly over the steps.' } };
  });
}
export { metricNumber };

/**
 * A person answers (or clears, with null) one step fact for the process as a whole. Steps with a
 * fact of their own keep it; the others use this answer.
 */
export function setTypicalTrait(model: ProcessModel, args: { trait: keyof TypicalTraits; value: unknown }): OpResult {
  return commit(model, m => {
    const profile: ProcessProfile = m.meta.profile ?? {};
    profile.typical = { ...(profile.typical ?? {}), [args.trait]: confirmed(args.value) };
    m.meta.profile = profile;
  });
}

/** A person states whether robots may drive a system's screens (null clears it). */
export function setSystemUiAllowed(model: ProcessModel, args: { systemId: string; value: boolean | null }): OpResult {
  return commit(model, m => {
    const sys = m.systems.find(s => s.id === args.systemId);
    if (!sys) throw new ModelOpError('NOT_FOUND', `No system with id ${args.systemId}.`);
    sys.uiAllowed = confirmed(args.value);
  });
}

/**
 * A person accepts the workspace's applications list entry for a system: missing ways in are added,
 * availability and operations follow the list, and the screen facts are set where the list knows
 * them, each marked as confirmed by a person. What it changes is shown first (`applicationOffer`).
 */
export function adoptApplication(model: ProcessModel, args: { systemId: string; app: Application }): OpResult {
  return commit(model, m => {
    const sys = m.systems.find(s => s.id === args.systemId);
    if (!sys) throw new ModelOpError('NOT_FOUND', `No system with id ${args.systemId}.`);
    mergeApplication(sys, args.app);
  });
}

// ---------------------------------------------------------------- answering questions

/** Closes questions with one answer: questions the model already answers, or questions merged into one. */
export function closeQuestions(model: ProcessModel, args: { questionIds: string[]; answer: string; status?: 'answered' | 'deferred' }): OpResult {
  return commit(model, m => {
    for (const id of args.questionIds) {
      const q = m.openQuestions.find(x => x.id === id);
      if (!q) throw new ModelOpError('NOT_FOUND', `No question with id ${id}.`);
      q.status = args.status ?? 'answered';
      q.answer = args.answer;
    }
  });
}

/** Sets questions aside for someone to answer later. A gap without a stored question is recorded as one first. */
export function deferQuestion(model: ProcessModel, args: { questionIds: string[]; owner: string | null; gap?: { target: ElementTarget; question: string } }): OpResult {
  return commit(model, m => {
    const ids = [...args.questionIds];
    if (args.gap && ids.length === 0) {
      const id = newId(m, 'q');
      m.openQuestions.push({ id, target: args.gap.target, question: args.gap.question, whyItMatters: '', owner: null, status: 'open' });
      ids.push(id);
    }
    for (const id of ids) {
      const q = m.openQuestions.find(x => x.id === id);
      if (!q) throw new ModelOpError('NOT_FOUND', `No question with id ${id}.`);
      q.status = 'deferred';
      q.owner = args.owner?.trim() || q.owner;
    }
  });
}

/** Reopens deferred questions. */
export function reopenQuestions(model: ProcessModel, args: { questionIds: string[] }): OpResult {
  return commit(model, m => { for (const id of args.questionIds) { const q = m.openQuestions.find(x => x.id === id); if (q) q.status = 'open'; } });
}

/** A person states the status of one interface of a system (by its position in the access list). */
export function setAccessStatus(model: ProcessModel, args: { systemId: string; index: number; access: AccessStatus }): OpResult {
  return commit(model, m => {
    const sys = m.systems.find(s => s.id === args.systemId);
    const a = sys?.access[args.index];
    if (!sys || !a) throw new ModelOpError('NOT_FOUND', 'No such interface.');
    a.access = args.access;
    a.status = 'user-confirmed';
  });
}

/** Routes an exception to the role that handles it. */
export function routeException(model: ProcessModel, args: { exceptionId: string; roleId: string }): OpResult {
  return commit(model, m => {
    const e = m.exceptions.find(x => x.id === args.exceptionId);
    if (!e) throw new ModelOpError('NOT_FOUND', `No exception with id ${args.exceptionId}.`);
    if (!m.roles.some(r => r.id === args.roleId)) throw new ModelOpError('NOT_FOUND', `No role with id ${args.roleId}.`);
    e.routedToRoleId = args.roleId;
    e.status = 'user-confirmed';
  });
}

// ---------------------------------------------------------------- the flow as drawn

/** The flow as a person drew it: nodes (existing by id, new without), the roles of the lanes, and the flows. */
export interface FlowStructure {
  roles: { ref: string; id?: string; name: string }[];
  nodes: { ref: string; id?: string; kind: 'task' | 'gateway' | 'start' | 'end'; name: string; roleRef?: string | null; gatewayType?: 'exclusive' | 'parallel' }[];
  flows: { id?: string; from: string; to: string; label?: string }[];
}

/**
 * Makes the model's flow match a drawing in one edit: new roles, steps, decisions and events are added;
 * renamed ones renamed; steps moved to another lane get that role first; elements no longer drawn are
 * removed with every reference to them; flows are replaced by the drawn ones (an existing flow keeps
 * its id and its exception mark). Everything else about a step (systems, facts, sources) is kept.
 */
export function setFlowStructure(model: ProcessModel, spec: FlowStructure): OpResult {
  return commit(model, m => {
    const taken = allIds(m);
    const ref = new Map<string, string>();
    for (const r of spec.roles) {
      if (r.id && m.roles.some(x => x.id === r.id)) {
        const role = m.roles.find(x => x.id === r.id)!;
        if (r.name.trim() && role.name !== r.name.trim()) { role.name = r.name.trim(); role.status = 'user-confirmed'; }
        ref.set(r.ref, r.id);
      } else {
        const same = m.roles.find(x => x.name.toLowerCase() === r.name.trim().toLowerCase());
        if (same) { ref.set(r.ref, same.id); continue; }
        const id = newId(m, 'r', taken); taken.add(id);
        m.roles.push({ id, name: r.name.trim(), kind: 'person_role', inScope: true, status: 'user-confirmed', sources: [] });
        ref.set(r.ref, id);
      }
    }
    const drawn = new Set(spec.nodes.filter(n => n.id).map(n => n.id!));
    // Removed: steps (with their references), decisions and events not in the drawing.
    for (const st of m.steps.filter(x => !drawn.has(x.id))) {
      const drop = (ids: string[]) => ids.filter(id => id !== st.id);
      m.exceptions.forEach(x => { x.stepIds = drop(x.stepIds); });
      m.painPoints.forEach(n => { n.stepIds = drop(n.stepIds); });
      m.risks.forEach(n => { n.stepIds = drop(n.stepIds); });
      m.controls.forEach(n => { n.stepIds = drop(n.stepIds); });
      m.openQuestions = m.openQuestions.filter(q => !(q.target.kind === 'step' && q.target.id === st.id));
      m.conflicts = m.conflicts.filter(c => !(c.target.kind === 'step' && c.target.id === st.id));
      m.meta.metrics.forEach(x => { if (x.appliesTo === st.id) delete x.appliesTo; });
    }
    m.steps = m.steps.filter(x => drawn.has(x.id));
    m.openQuestions = m.openQuestions.filter(q => !(q.target.kind === 'gateway' && !drawn.has(q.target.id!)));
    m.gateways = m.gateways.filter(x => drawn.has(x.id));
    m.events = m.events.filter(x => drawn.has(x.id));
    for (const n of spec.nodes) {
      const name = n.name.trim();
      const roleId = n.roleRef === undefined ? undefined : n.roleRef === null ? null : ref.get(n.roleRef) ?? null;
      if (n.id) {
        ref.set(n.ref, n.id);
        const st = m.steps.find(x => x.id === n.id);
        if (st) {
          if (name && st.name !== name) { st.name = name; st.status = 'user-confirmed'; }
          if (roleId !== undefined && (st.roleIds[0] ?? null) !== roleId) {
            st.roleIds = roleId ? [roleId, ...st.roleIds.filter(r => r !== roleId)] : st.roleIds.slice(1);
            st.status = 'user-confirmed';
          }
          continue;
        }
        const g = m.gateways.find(x => x.id === n.id);
        if (g) { if (name && g.question !== name) { g.question = name; g.status = 'user-confirmed'; } continue; }
        const e = m.events.find(x => x.id === n.id);
        if (e && name && e.name !== name) { e.name = name; e.status = 'user-confirmed'; }
        continue;
      }
      if (!name) throw new ModelOpError('EMPTY', 'Name every new step, decision and event before saving.');
      if (n.kind === 'task') {
        const id = newId(m, 's', taken); taken.add(id);
        m.steps.push({ id, name, description: '', roleIds: roleId ? [roleId] : [], systemIds: [], taskType: 'user', inputs: [], outputs: [], ruleIds: [], exceptionIds: [], status: 'user-confirmed', sources: [] });
        ref.set(n.ref, id);
      } else if (n.kind === 'gateway') {
        const id = newId(m, 'g', taken); taken.add(id);
        m.gateways.push({ id, type: n.gatewayType ?? 'exclusive', question: name, status: 'user-confirmed', sources: [] });
        ref.set(n.ref, id);
      } else {
        const id = newId(m, 'ev', taken); taken.add(id);
        m.events.push({ id, kind: n.kind, name, status: 'user-confirmed', sources: [] });
        ref.set(n.ref, id);
      }
    }
    const old = m.flows;
    m.flows = [];
    for (const f of spec.flows) {
      const from = ref.get(f.from) ?? f.from, to = ref.get(f.to) ?? f.to;
      const prev = (f.id && old.find(x => x.id === f.id)) || old.find(x => x.from === from && x.to === to);
      const id = prev && !m.flows.some(x => x.id === prev.id) ? prev.id : newId(m, 'f', taken);
      taken.add(id);
      const flow: Flow = { id, from, to };
      if (f.label?.trim()) flow.label = f.label.trim();
      if (prev?.isException) flow.isException = true;
      m.flows.push(flow);
    }
  });
}
