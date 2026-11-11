// One-way import of an Assess V2 case into a Process Model.
//
// V2 evidence is author-submitted and never validated, and it carries no excerpts. So everything
// imported is marked 'assumed' (a recorded working assumption to confirm), with no sources.
// Nothing is added that the case does not hold: no start or end events, no roles beyond the
// owners it names, no "valid" path for a decision that only records its exception path.
// The validator and the gap pass then show what is missing.
import type { AccessMethod, AccessMethodKind, AccessStatus, BusinessRule, ExceptionPath, Flow, Gateway, Metric, ProcessModel, Role, Step, SystemRef, TaskType } from './types.ts';
import { PROCESS_MODEL_SCHEMA_VERSION } from './types.ts';
import type { AssessmentCaseV2, ApplicationInteraction, PrimitiveType } from '../../services/assessV2/types.ts';

const assumed = { status: 'assumed' as const, sources: [] };

/** The V2 primitive type is the author's own classification of the step, so it maps directly. */
const TASK_TYPE: Partial<Record<PrimitiveType, TaskType>> = {
  Capture: 'receive',
  Communicate: 'send',
  Validate: 'business_rule',
  Calculate: 'business_rule',
  Classify: 'business_rule',
};

const METHOD: Record<ApplicationInteraction['mode'], AccessMethodKind | null> = {
  read: 'api', write: 'api', event: 'event', ui: 'ui', operational: null,
};

/**
 * What the author said about an interface. "Available" without validation is reported, not
 * confirmed. "Not available" is also only reported, and AccessStatus has no reported-absent
 * value, so it stays unknown with a note.
 */
function accessOf(i: ApplicationInteraction): { access: AccessStatus; note?: string } {
  // A UI interaction means the author used or saw the screen.
  if (i.mode === 'ui') return { access: 'reported' };
  if (i.facts.interfaceAvailable === true) return { access: 'reported' };
  if (i.facts.interfaceAvailable === false) return { access: 'unknown', note: 'Reported as not available in the earlier assessment; not confirmed.' };
  return { access: 'unknown' };
}

export function fromAssessV2(c: AssessmentCaseV2, opts: { name: string }): ProcessModel {
  const roles: Role[] = [];
  const roleIdByName = new Map<string, string>();
  const roleFor = (owner: string | undefined): string[] => {
    const name = owner?.trim();
    if (!name) return [];
    let id = roleIdByName.get(name);
    if (!id) {
      id = `r-${roles.length + 1}`;
      roleIdByName.set(name, id);
      roles.push({ id, name, kind: 'person_role', inScope: true, ...assumed });
    }
    return [id];
  };

  const rules: BusinessRule[] = [];
  const ruleFor = (text: string): string => {
    const id = `br-${rules.length + 1}`;
    rules.push({ id, name: text, condition: text, action: '', ...assumed });
    return id;
  };

  const systems: SystemRef[] = c.assets.map(a => {
    const methods = new Map<string, AccessMethod>();
    for (const i of c.interactions.filter(x => x.assetId === a.id)) {
      const method = METHOD[i.mode];
      if (!method) continue;
      const { access, note } = accessOf(i);
      const key = `${method}|${access}`;
      const existing = methods.get(key);
      if (existing) {
        if (!existing.operations.includes(i.operationName)) existing.operations.push(i.operationName);
        continue;
      }
      const m: AccessMethod = { method, operations: [i.operationName], access, ...assumed };
      if (note) m.note = note;
      methods.set(key, m);
    }
    return { id: a.id, name: a.name, kind: 'other', inScope: true, access: [...methods.values()], ...assumed };
  });

  const exceptions: ExceptionPath[] = c.exceptionPaths.map(x => ({
    id: x.id,
    kind: 'business',
    name: x.name,
    trigger: x.trigger,
    stepIds: [...new Set([x.fromPrimitiveId, ...x.resolutionPrimitiveIds])],
    handling: '',
    ...assumed,
  }));

  const steps: Step[] = c.primitives.map(p => ({
    id: p.id,
    name: p.name,
    description: p.description,
    roleIds: roleFor(p.owner),
    systemIds: [...new Set(c.interactions.filter(i => i.primitiveId === p.id).map(i => i.assetId))],
    taskType: TASK_TYPE[p.type] ?? 'user',
    inputs: [...p.inputs],
    outputs: [...p.outputs],
    ruleIds: p.rules.map(ruleFor),
    exceptionIds: exceptions.filter(x => x.stepIds[0] === p.id).map(x => x.id),
    ...assumed,
  }));

  // A decision point becomes a gateway after its step; the step's outgoing edges leave from the gateway.
  const gateways: Gateway[] = [];
  const gatewayAfter = new Map<string, string>();
  for (const d of c.decisionPoints) {
    gateways.push({ id: d.id, type: 'exclusive', question: d.name, ...assumed });
    gatewayAfter.set(d.primitiveId, d.id);
    const step = steps.find(s => s.id === d.primitiveId);
    if (step && d.ruleDescription.trim()) step.ruleIds.push(ruleFor(d.ruleDescription));
  }

  const flows: Flow[] = c.edges.map(e => {
    const flow: Flow = { id: e.id, from: gatewayAfter.get(e.fromPrimitiveId) ?? e.fromPrimitiveId, to: e.toPrimitiveId };
    if (e.condition) flow.label = e.condition;
    return flow;
  });
  for (const [stepId, gatewayId] of gatewayAfter) flows.push({ id: `f-${gatewayId}`, from: stepId, to: gatewayId });

  const metrics: Metric[] = [];
  for (const p of c.primitives) {
    if (typeof p.volumeShare === 'number') {
      metrics.push({ id: `m-${metrics.length + 1}`, kind: 'share', label: `Share of volume through "${p.name}"`, value: p.volumeShare, unit: 'share', appliesTo: p.id, ...assumed });
    }
    if (typeof p.manualEffort === 'number') {
      metrics.push({ id: `m-${metrics.length + 1}`, kind: 'handling_time', label: `Manual effort for "${p.name}"`, value: p.manualEffort, unit: 'as recorded in the earlier assessment', appliesTo: p.id, ...assumed });
    }
  }

  return {
    schemaVersion: PROCESS_MODEL_SCHEMA_VERSION,
    meta: {
      name: opts.name,
      objective: { value: null, status: 'unknown', sources: [] },
      owner: { value: null, status: 'unknown', sources: [] },
      scopeIn: [],
      scopeOut: [],
      metrics,
    },
    roles,
    systems,
    events: [],
    steps,
    gateways,
    flows,
    rules,
    exceptions,
    dataObjects: [],
    painPoints: [],
    controls: [],
    risks: [],
    openQuestions: [],
    conflicts: [],
  };
}
