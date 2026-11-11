// Edit operations on a Process Model. Each takes a valid model and returns the next model and the
// JSON Patch that produces it. An operation that would leave the model invalid throws instead,
// so a stored model can only move from valid to valid.
//
// Edits made through these operations are a person's decisions: the element they touch becomes
// 'user-confirmed' and keeps the sources it already had.
import { applyPatch, diff, type JsonPatchOp } from './jsonPatch.ts';
import type { ElementTarget, Flow, ProcessModel, Step } from './types.ts';
import { errorsOf, validateModel, type ValidationIssue } from './validate.ts';

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
  return commit(model, m => {
    detach(m, args.stepId);
    m.steps = m.steps.filter(s => s.id !== args.stepId);
    const drop = (ids: string[]) => ids.filter(id => id !== args.stepId);
    m.exceptions.forEach(x => { x.stepIds = drop(x.stepIds); });
    m.painPoints.forEach(n => { n.stepIds = drop(n.stepIds); });
    m.risks.forEach(n => { n.stepIds = drop(n.stepIds); });
    m.controls.forEach(n => { n.stepIds = drop(n.stepIds); });
    const targetsStep = (t: ElementTarget) => t.kind === 'step' && t.id === args.stepId;
    m.openQuestions = m.openQuestions.filter(q => !targetsStep(q.target));
    m.conflicts = m.conflicts.filter(c => !targetsStep(c.target));
    m.meta.metrics.forEach(x => { if (x.appliesTo === args.stepId) delete x.appliesTo; });
  });
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
