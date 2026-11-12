// Structural and referential validation of a Process Model.
//
// Errors make a model invalid: a bad enum, a broken reference, a duplicate id, a fact that claims to
// be stated without a source. Warnings describe an incomplete process (no start event, an
// unreachable step); a model in progress is allowed to be incomplete, and the gap pass turns those
// into open questions.
import { PROCESS_MODEL_SCHEMA_VERSION, type ElementTarget, type FactStatus, type ProcessModel, type Provenance } from './types.ts';

export interface ValidationIssue {
  severity: 'error' | 'warning';
  code: string;
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

const FACT_STATUSES: readonly FactStatus[] = ['stated', 'inferred', 'user-confirmed', 'assumed', 'unknown'];
const ROLE_KINDS = ['person_role', 'team', 'external', 'system_actor'];
const ACCESS_METHODS = ['api', 'ui', 'file', 'database', 'event', 'email'];
const ACCESS_STATUSES = ['confirmed', 'reported', 'unknown', 'confirmed_absent'];
const SYSTEM_KINDS = ['erp', 'email', 'document_store', 'spreadsheet', 'workflow', 'portal', 'scanner', 'other'];
const TASK_TYPES = ['user', 'manual', 'service', 'business_rule', 'send', 'receive'];
const METRIC_KINDS = ['volume', 'handling_time', 'cycle_time', 'fte', 'exception_rate', 'share', 'other'];
const TARGET_KINDS = ['meta', 'role', 'system', 'step', 'gateway', 'rule', 'exception', 'metric', 'data'];

/** The arrays every model has, in a fixed order. */
export const MODEL_ARRAYS = [
  'roles', 'systems', 'events', 'steps', 'gateways', 'flows', 'rules', 'exceptions',
  'dataObjects', 'painPoints', 'controls', 'risks', 'openQuestions', 'conflicts',
] as const;

/** Which model array holds the elements a target kind points at. */
export const TARGET_COLLECTION: Record<Exclude<ElementTarget['kind'], 'meta'>, string> = {
  role: 'roles', system: 'systems', step: 'steps', gateway: 'gateways', rule: 'rules',
  exception: 'exceptions', metric: 'meta.metrics', data: 'dataObjects',
};

const isStr = (v: unknown): v is string => typeof v === 'string';
const isNonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

export function validateModel(model: ProcessModel): ValidationResult {
  const issues: ValidationIssue[] = [];
  const err = (code: string, path: string, message: string) => issues.push({ severity: 'error', code, path, message });
  const warn = (code: string, path: string, message: string) => issues.push({ severity: 'warning', code, path, message });

  if (!model || typeof model !== 'object') {
    err('NOT_AN_OBJECT', '', 'The model must be an object.');
    return { valid: false, issues };
  }
  if (model.schemaVersion !== PROCESS_MODEL_SCHEMA_VERSION) err('SCHEMA_VERSION', '/schemaVersion', `Expected schema version ${PROCESS_MODEL_SCHEMA_VERSION}.`);
  if (!model.meta || typeof model.meta !== 'object') {
    err('MISSING', '/meta', 'meta is required.');
    return { valid: false, issues };
  }
  for (const key of MODEL_ARRAYS) {
    if (!Array.isArray((model as any)[key])) err('MISSING', `/${key}`, `${key} must be an array.`);
  }
  for (const key of ['scopeIn', 'scopeOut', 'metrics'] as const) {
    if (!Array.isArray(model.meta[key])) err('MISSING', `/meta/${key}`, `meta.${key} must be an array.`);
  }
  if (issues.length) return { valid: false, issues };

  // ---- ids: present and unique across the whole model ----
  const seen = new Map<string, string>();
  const claim = (id: unknown, path: string) => {
    if (!isNonEmpty(id)) return err('ID_MISSING', path, 'Every element needs a non-empty id.');
    const prior = seen.get(id);
    if (prior) err('ID_DUPLICATE', path, `Id ${id} is already used at ${prior}.`);
    else seen.set(id, path);
  };
  model.meta.scopeIn.forEach((x, i) => claim(x.id, `/meta/scopeIn/${i}/id`));
  model.meta.scopeOut.forEach((x, i) => claim(x.id, `/meta/scopeOut/${i}/id`));
  model.meta.metrics.forEach((x, i) => claim(x.id, `/meta/metrics/${i}/id`));
  for (const key of MODEL_ARRAYS) (model as any)[key].forEach((x: any, i: number) => claim(x?.id, `/${key}/${i}/id`));

  const idsOf = (list: { id: string }[]) => new Set(list.map(x => x.id));
  const roleIds = idsOf(model.roles);
  const systemIds = idsOf(model.systems);
  const stepIds = idsOf(model.steps);
  const ruleIds = idsOf(model.rules);
  const exceptionIds = idsOf(model.exceptions);
  const eventIds = idsOf(model.events);
  const gatewayIds = idsOf(model.gateways);
  const nodeIds = new Set([...eventIds, ...stepIds, ...gatewayIds]);
  const byKind: Record<string, Set<string>> = {
    role: roleIds, system: systemIds, step: stepIds, gateway: gatewayIds, rule: ruleIds,
    exception: exceptionIds, metric: idsOf(model.meta.metrics), data: idsOf(model.dataObjects),
  };

  // ---- provenance ----
  const provenance = (p: Provenance, path: string) => {
    if (!FACT_STATUSES.includes(p.status)) return err('STATUS', `${path}/status`, `Unknown status ${String(p.status)}.`);
    if (!Array.isArray(p.sources)) return err('SOURCES', `${path}/sources`, 'sources must be an array.');
    p.sources.forEach((s, i) => {
      const sp = `${path}/sources/${i}`;
      if (!isNonEmpty(s?.sourceId)) err('SOURCE_ID', `${sp}/sourceId`, 'A source reference needs a sourceId.');
      if (!isNonEmpty(s?.excerpt)) err('SOURCE_EXCERPT', `${sp}/excerpt`, 'A source reference needs a verbatim excerpt.');
      if (!s?.locator || typeof s.locator !== 'object') err('SOURCE_LOCATOR', `${sp}/locator`, 'A source reference needs a locator object.');
    });
    if ((p.status === 'stated' || p.status === 'inferred') && p.sources.length === 0) {
      err('UNSOURCED', `${path}/sources`, `A ${p.status} item must cite at least one source.`);
    }
  };
  const fact = (f: any, path: string) => {
    if (!f || typeof f !== 'object') return err('MISSING', path, 'Fact is required.');
    provenance(f, path);
    if (f.status === 'unknown' && f.value !== null) err('UNKNOWN_HAS_VALUE', `${path}/value`, 'An unknown fact must have value null.');
    if (f.status !== 'unknown' && (f.value === null || f.value === undefined)) err('KNOWN_WITHOUT_VALUE', `${path}/value`, 'A fact without a value must have status unknown.');
  };
  /** An optional fact whose value, when known, must pass the check. */
  const typedFact = (f: any, path: string, ok: (v: unknown) => boolean) => {
    fact(f, path);
    if (f && f.value !== null && f.value !== undefined && !ok(f.value)) err('FACT_VALUE', `${path}/value`, 'The value has the wrong type.');
  };
  const isBool = (v: unknown) => typeof v === 'boolean';
  const traits = (t: any, path: string) => {
    if (!t || typeof t !== 'object' || Array.isArray(t)) return err('TRAITS', path, 'traits must be an object.');
    const checks: Record<string, (v: unknown) => boolean> = {
      rework: isBool, physical: isBool, judgment: isBool, rulesComplete: isBool, language: isBool,
      input: v => ['structured', 'semi_structured', 'unstructured', 'paper'].includes(v as string),
      write: v => ['none', 'record', 'financial', 'irreversible'].includes(v as string),
      effortMinutes: v => typeof v === 'number' && v >= 0,
      sharePercent: v => typeof v === 'number' && v >= 0 && v <= 100,
    };
    for (const k of Object.keys(t)) {
      if (k === 'agent') {
        if (!t.agent || typeof t.agent !== 'object') { err('TRAITS', `${path}/agent`, 'agent must be an object.'); continue; }
        for (const a of Object.keys(t.agent)) {
          if (!['ambiguity', 'adaptive', 'toolChoice', 'value', 'controllable'].includes(a)) err('TRAITS', `${path}/agent/${a}`, `Unknown agent condition ${a}.`);
          else typedFact(t.agent[a], `${path}/agent/${a}`, isBool);
        }
      } else if (!checks[k]) err('TRAITS', `${path}/${k}`, `Unknown trait ${k}.`);
      else typedFact(t[k], `${path}/${k}`, checks[k]);
    }
  };
  const refs = (list: unknown, valid: Set<string>, path: string, what: string) => {
    if (!Array.isArray(list)) return err('NOT_ARRAY', path, `${path} must be an array.`);
    list.forEach((id, i) => { if (!valid.has(id as string)) err('BROKEN_REF', `${path}/${i}`, `No ${what} with id ${String(id)}.`); });
    if (new Set(list).size !== list.length) err('DUPLICATE_REF', path, `${path} lists the same ${what} twice.`);
  };
  const strings = (list: unknown, path: string) => {
    if (!Array.isArray(list) || !list.every(isStr)) err('NOT_STRINGS', path, `${path} must be an array of strings.`);
  };

  // ---- meta ----
  if (!isNonEmpty(model.meta.name)) err('NAME', '/meta/name', 'The process needs a name.');
  fact(model.meta.objective, '/meta/objective');
  fact(model.meta.owner, '/meta/owner');
  [...model.meta.scopeIn.map((x, i) => [x, `/meta/scopeIn/${i}`] as const), ...model.meta.scopeOut.map((x, i) => [x, `/meta/scopeOut/${i}`] as const)].forEach(([x, p]) => {
    provenance(x, p);
    if (!isNonEmpty(x.text)) err('TEXT', `${p}/text`, 'A scope item needs text.');
  });
  model.meta.metrics.forEach((m, i) => {
    const p = `/meta/metrics/${i}`;
    provenance(m, p);
    if (!METRIC_KINDS.includes(m.kind)) err('ENUM', `${p}/kind`, `Unknown metric kind ${String(m.kind)}.`);
    if (!isNonEmpty(m.label)) err('LABEL', `${p}/label`, 'A metric needs a label.');
    if (m.value !== null && typeof m.value !== 'number') err('METRIC_VALUE', `${p}/value`, 'A metric value is a number or null.');
    if (m.status === 'unknown' && m.value !== null) err('UNKNOWN_HAS_VALUE', `${p}/value`, 'An unknown metric must have value null.');
    if (m.range && !(Array.isArray(m.range) && m.range.length === 2 && m.range.every(n => typeof n === 'number') && m.range[0] <= m.range[1])) {
      err('METRIC_RANGE', `${p}/range`, 'A range is two numbers, low then high.');
    }
  });

  // ---- elements ----
  model.roles.forEach((r, i) => {
    const p = `/roles/${i}`;
    provenance(r, p);
    if (!isNonEmpty(r.name)) err('NAME', `${p}/name`, 'A role needs a name.');
    if (!ROLE_KINDS.includes(r.kind)) err('ENUM', `${p}/kind`, `Unknown role kind ${String(r.kind)}.`);
  });
  if (model.meta.profile !== undefined) {
    const pr: any = model.meta.profile;
    if (!pr || typeof pr !== 'object' || Array.isArray(pr)) err('PROFILE', '/meta/profile', 'profile must be an object.');
    else for (const k of Object.keys(pr)) {
      if (!['processChange', 'systemChange'].includes(k)) err('PROFILE', `/meta/profile/${k}`, `Unknown profile fact ${k}.`);
      else typedFact(pr[k], `/meta/profile/${k}`, v => ['none', 'minor', 'major'].includes(v as string));
    }
  }
  model.systems.forEach((s, i) => {
    const p = `/systems/${i}`;
    provenance(s, p);
    if (!isNonEmpty(s.name)) err('NAME', `${p}/name`, 'A system needs a name.');
    if (!SYSTEM_KINDS.includes(s.kind)) err('ENUM', `${p}/kind`, `Unknown system kind ${String(s.kind)}.`);
    if (!Array.isArray(s.access)) return err('NOT_ARRAY', `${p}/access`, 'access must be an array.');
    s.access.forEach((a, j) => {
      const ap = `${p}/access/${j}`;
      provenance(a, ap);
      if (!ACCESS_METHODS.includes(a.method)) err('ENUM', `${ap}/method`, `Unknown access method ${String(a.method)}.`);
      if (!ACCESS_STATUSES.includes(a.access)) err('ENUM', `${ap}/access`, `Unknown access status ${String(a.access)}.`);
      strings(a.operations, `${ap}/operations`);
      if (a.access === 'confirmed' && a.status !== 'user-confirmed' && a.sources.length === 0) {
        err('UNSOURCED_CONFIRMATION', ap, 'An access method marked confirmed needs a source or a user confirmation.');
      }
    });
    if (s.uiStable !== undefined) typedFact(s.uiStable, `${p}/uiStable`, v => typeof v === 'boolean');
    if (s.remote !== undefined) typedFact(s.remote, `${p}/remote`, v => typeof v === 'boolean');
  });
  model.events.forEach((e, i) => {
    const p = `/events/${i}`;
    provenance(e, p);
    if (e.kind !== 'start' && e.kind !== 'end') err('ENUM', `${p}/kind`, 'An event is start or end.');
  });
  model.steps.forEach((s, i) => {
    const p = `/steps/${i}`;
    provenance(s, p);
    if (!isNonEmpty(s.name)) err('NAME', `${p}/name`, 'A step needs a name.');
    if (!isStr(s.description)) err('DESCRIPTION', `${p}/description`, 'description must be a string.');
    if (!TASK_TYPES.includes(s.taskType)) err('ENUM', `${p}/taskType`, `Unknown task type ${String(s.taskType)}.`);
    refs(s.roleIds, roleIds, `${p}/roleIds`, 'role');
    refs(s.systemIds, systemIds, `${p}/systemIds`, 'system');
    refs(s.ruleIds, ruleIds, `${p}/ruleIds`, 'rule');
    refs(s.exceptionIds, exceptionIds, `${p}/exceptionIds`, 'exception');
    strings(s.inputs, `${p}/inputs`);
    strings(s.outputs, `${p}/outputs`);
    if (s.traits !== undefined) traits(s.traits, `${p}/traits`);
  });
  model.gateways.forEach((g, i) => {
    const p = `/gateways/${i}`;
    provenance(g, p);
    if (g.type !== 'exclusive' && g.type !== 'parallel') err('ENUM', `${p}/type`, 'A gateway is exclusive or parallel.');
    if (!isStr(g.question)) err('QUESTION', `${p}/question`, 'question must be a string.');
  });
  model.rules.forEach((r, i) => {
    const p = `/rules/${i}`;
    provenance(r, p);
    if (!isNonEmpty(r.name)) err('NAME', `${p}/name`, 'A rule needs a name.');
    if (!isStr(r.condition) || !isStr(r.action)) err('RULE_TEXT', p, 'condition and action must be strings.');
  });
  model.exceptions.forEach((x, i) => {
    const p = `/exceptions/${i}`;
    provenance(x, p);
    if (x.kind !== 'business' && x.kind !== 'application') err('ENUM', `${p}/kind`, 'An exception is business or application.');
    if (!isNonEmpty(x.name)) err('NAME', `${p}/name`, 'An exception needs a name.');
    refs(x.stepIds, stepIds, `${p}/stepIds`, 'step');
    if (x.routedToRoleId !== undefined && !roleIds.has(x.routedToRoleId)) err('BROKEN_REF', `${p}/routedToRoleId`, `No role with id ${x.routedToRoleId}.`);
  });
  model.dataObjects.forEach((d, i) => {
    const p = `/dataObjects/${i}`;
    provenance(d, p);
    if (!isNonEmpty(d.name)) err('NAME', `${p}/name`, 'A data object needs a name.');
  });
  for (const key of ['painPoints', 'risks', 'controls'] as const) {
    model[key].forEach((n: any, i: number) => {
      const p = `/${key}/${i}`;
      provenance(n, p);
      if (!isNonEmpty(n.text)) err('TEXT', `${p}/text`, 'A note needs text.');
      refs(n.stepIds, stepIds, `${p}/stepIds`, 'step');
      if (key === 'controls') refs(n.ruleIds, ruleIds, `${p}/ruleIds`, 'rule');
    });
  }

  // ---- flows ----
  const pairs = new Set<string>();
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, number>();
  model.flows.forEach((f, i) => {
    const p = `/flows/${i}`;
    if (!nodeIds.has(f.from)) err('BROKEN_REF', `${p}/from`, `No event, step or gateway with id ${f.from}.`);
    if (!nodeIds.has(f.to)) err('BROKEN_REF', `${p}/to`, `No event, step or gateway with id ${f.to}.`);
    if (f.from === f.to) err('SELF_LOOP', p, 'A flow cannot connect an element to itself.');
    const key = `${f.from}->${f.to}`;
    if (pairs.has(key)) err('DUPLICATE_FLOW', p, `There is already a flow from ${f.from} to ${f.to}.`);
    pairs.add(key);
    incoming.set(f.to, (incoming.get(f.to) ?? 0) + 1);
    outgoing.set(f.from, (outgoing.get(f.from) ?? 0) + 1);
  });
  model.events.forEach((e, i) => {
    if (e.kind === 'start' && incoming.get(e.id)) err('START_HAS_INCOMING', `/events/${i}`, 'A start event cannot have incoming flows.');
    if (e.kind === 'end' && outgoing.get(e.id)) err('END_HAS_OUTGOING', `/events/${i}`, 'An end event cannot have outgoing flows.');
  });

  // ---- questions and conflicts ----
  const target = (t: ElementTarget, path: string) => {
    if (!t || !TARGET_KINDS.includes(t.kind)) return err('ENUM', `${path}/kind`, 'Unknown target kind.');
    if (t.kind !== 'meta' && t.id !== undefined && !byKind[t.kind].has(t.id)) err('BROKEN_REF', `${path}/id`, `No ${t.kind} with id ${t.id}.`);
  };
  model.openQuestions.forEach((q, i) => {
    const p = `/openQuestions/${i}`;
    target(q.target, `${p}/target`);
    if (!isNonEmpty(q.question)) err('TEXT', `${p}/question`, 'A question needs text.');
    if (!['open', 'answered', 'deferred'].includes(q.status)) err('ENUM', `${p}/status`, 'Status is open, answered or deferred.');
    if (q.status === 'answered' && !isNonEmpty(q.answer)) err('ANSWER_MISSING', `${p}/answer`, 'An answered question needs its answer.');
  });
  model.conflicts.forEach((c, i) => {
    const p = `/conflicts/${i}`;
    target(c.target, `${p}/target`);
    if (!Array.isArray(c.values) || c.values.length < 2) err('CONFLICT_VALUES', `${p}/values`, 'A conflict needs at least two values.');
    else c.values.forEach((v, j) => {
      if (!isNonEmpty(v.value)) err('TEXT', `${p}/values/${j}/value`, 'Each conflicting value needs text.');
      provenance({ status: 'stated', sources: v.sources }, `${p}/values/${j}`);
    });
    if (c.resolution) {
      if (!isNonEmpty(c.resolution.by) || !isNonEmpty(c.resolution.reason)) err('RESOLUTION', `${p}/resolution`, 'A resolution records who chose and why.');
      if (!isNonEmpty(c.resolution.chosen)) err('RESOLUTION', `${p}/resolution/chosen`, 'A resolution records the chosen value.');
    }
  });

  // ---- completeness (warnings) ----
  if (!model.events.some(e => e.kind === 'start')) warn('NO_START', '/events', 'The process has no start event.');
  if (!model.events.some(e => e.kind === 'end')) warn('NO_END', '/events', 'The process has no end event.');
  const reachable = reachableFromStarts(model);
  if (model.events.some(e => e.kind === 'start')) {
    model.steps.forEach((s, i) => { if (!reachable.has(s.id)) warn('UNREACHABLE', `/steps/${i}`, `Step "${s.name}" cannot be reached from a start event.`); });
  }
  model.steps.forEach((s, i) => {
    if (!outgoing.get(s.id) && model.events.some(e => e.kind === 'end')) warn('DEAD_END', `/steps/${i}`, `Step "${s.name}" has no outgoing flow.`);
  });
  model.gateways.forEach((g, i) => {
    if ((outgoing.get(g.id) ?? 0) < 2) warn('GATEWAY_ONE_PATH', `/gateways/${i}`, `Decision "${g.question}" has fewer than two outgoing paths.`);
  });

  return { valid: !issues.some(x => x.severity === 'error'), issues };
}

export function reachableFromStarts(model: ProcessModel): Set<string> {
  const next = new Map<string, string[]>();
  for (const f of model.flows) next.set(f.from, [...(next.get(f.from) ?? []), f.to]);
  const seen = new Set<string>();
  const queue = model.events.filter(e => e.kind === 'start').map(e => e.id);
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    queue.push(...(next.get(id) ?? []));
  }
  return seen;
}

export const errorsOf = (r: ValidationResult) => r.issues.filter(x => x.severity === 'error');
