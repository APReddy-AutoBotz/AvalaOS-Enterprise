// Read-only views of a Process Model used by the assessment, documents, flows and the review UI.
import type { ElementTarget, Flow, ProcessModel, Step } from './types.ts';

export const outgoing = (m: ProcessModel, id: string): Flow[] => m.flows.filter(f => f.from === id);
export const incoming = (m: ProcessModel, id: string): Flow[] => m.flows.filter(f => f.to === id);

/** Finds the element a target points at; for meta, the meta object itself. */
export function getElement(m: ProcessModel, t: ElementTarget): unknown {
  switch (t.kind) {
    case 'meta': return m.meta;
    case 'role': return m.roles.find(x => x.id === t.id);
    case 'system': return m.systems.find(x => x.id === t.id);
    case 'step': return m.steps.find(x => x.id === t.id);
    case 'gateway': return m.gateways.find(x => x.id === t.id);
    case 'rule': return m.rules.find(x => x.id === t.id);
    case 'exception': return m.exceptions.find(x => x.id === t.id);
    case 'metric': return m.meta.metrics.find(x => x.id === t.id);
    case 'data': return m.dataObjects.find(x => x.id === t.id);
  }
}

/**
 * Steps in reading order: breadth-first from the start events, taking the main path before
 * exception paths, then any steps that the flow does not reach, in their stored order.
 */
export function orderedSteps(m: ProcessModel): Step[] {
  const stepById = new Map(m.steps.map(s => [s.id, s]));
  const order: Step[] = [];
  const seen = new Set<string>();
  const queue = m.events.filter(e => e.kind === 'start').map(e => e.id);
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const step = stepById.get(id);
    if (step) order.push(step);
    const next = outgoing(m, id).sort((a, b) => Number(!!a.isException) - Number(!!b.isException));
    queue.push(...next.map(f => f.to));
  }
  for (const s of m.steps) if (!seen.has(s.id)) order.push(s);
  return order;
}

export const stepsForRole = (m: ProcessModel, roleId: string) => m.steps.filter(s => s.roleIds.includes(roleId));
export const stepsForSystem = (m: ProcessModel, systemId: string) => m.steps.filter(s => s.systemIds.includes(systemId));

export interface Gap {
  target: ElementTarget;
  kind: 'unknown_value' | 'step_without_role' | 'step_without_system' | 'system_access_unknown' | 'decision_one_path' | 'unsourced_assumption';
  label: string;
}

/**
 * What is missing, found by rule rather than by a model. The extraction pipeline turns these into
 * open questions; the review UI lists them.
 */
export function gaps(m: ProcessModel): Gap[] {
  const out: Gap[] = [];
  if (m.meta.objective.status === 'unknown') out.push({ target: { kind: 'meta', field: 'objective' }, kind: 'unknown_value', label: 'Process objective is unknown.' });
  if (m.meta.owner.status === 'unknown') out.push({ target: { kind: 'meta', field: 'owner' }, kind: 'unknown_value', label: 'Process owner is unknown.' });
  for (const x of m.meta.metrics) {
    if (x.value === null) out.push({ target: { kind: 'metric', id: x.id, field: 'value' }, kind: 'unknown_value', label: `${x.label} is unknown.` });
  }
  for (const s of m.steps) {
    if (s.roleIds.length === 0) out.push({ target: { kind: 'step', id: s.id, field: 'roleIds' }, kind: 'step_without_role', label: `Who does "${s.name}"?` });
    if (s.systemIds.length === 0 && s.taskType !== 'manual') out.push({ target: { kind: 'step', id: s.id, field: 'systemIds' }, kind: 'step_without_system', label: `Which system is used for "${s.name}"?` });
    if (s.status === 'assumed') out.push({ target: { kind: 'step', id: s.id }, kind: 'unsourced_assumption', label: `"${s.name}" is an assumption to confirm.` });
  }
  for (const sys of m.systems.filter(x => x.inScope)) {
    if (sys.access.length === 0 || sys.access.every(a => a.access === 'unknown')) {
      out.push({ target: { kind: 'system', id: sys.id, field: 'access' }, kind: 'system_access_unknown', label: `How can ${sys.name} be accessed (API, UI, file)?` });
    }
  }
  for (const g of m.gateways) {
    if (g.type === 'exclusive' && outgoing(m, g.id).length < 2) out.push({ target: { kind: 'gateway', id: g.id }, kind: 'decision_one_path', label: `Decision "${g.question}" has only one outcome.` });
  }
  return out;
}

// ---------------------------------------------------------------- selections for dependency hashing

/**
 * A part of the model an output depends on. A document section or a recommendation records the
 * selectors it read and their hash; when the hash changes, the output needs review.
 */
export type Selector =
  | { section: 'meta' | 'roles' | 'systems' | 'events' | 'steps' | 'gateways' | 'flows' | 'rules' | 'exceptions' | 'dataObjects' | 'painPoints' | 'controls' | 'risks' | 'openQuestions' | 'conflicts' }
  | { element: ElementTarget };

export function select(m: ProcessModel, selector: Selector): unknown {
  if ('section' in selector) return selector.section === 'meta' ? m.meta : (m as any)[selector.section];
  const el = getElement(m, selector.element) as Record<string, unknown> | undefined;
  if (el === undefined) return null;
  return selector.element.field ? (el[selector.element.field] ?? null) : el;
}

export const selectorKey = (s: Selector): string =>
  'section' in s ? s.section : [s.element.kind, s.element.id ?? '', s.element.field ?? ''].join(':');

const sameTarget = (a: ElementTarget, b: ElementTarget) => a.kind === b.kind && (a.id ?? '') === (b.id ?? '') && (a.field ?? '') === (b.field ?? '');

/** Gaps that no open question already covers. */
export function untrackedGaps(m: ProcessModel): Gap[] {
  const open = m.openQuestions.filter(q => q.status === 'open');
  return gaps(m).filter(g => !open.some(q => sameTarget(q.target, g.target)));
}

/** Open questions plus untracked gaps: what is still unknown. */
export const openItemCount = (m: ProcessModel): number => m.openQuestions.filter(q => q.status === 'open').length + untrackedGaps(m).length;
