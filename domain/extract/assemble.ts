// Builds a Process Model from the candidates and the two merge results, by rule:
// - anything without a candidate behind it is dropped (the merge passes cannot add facts);
// - every element cites the quotes of its candidates;
// - an interface is only "confirmed" when every candidate behind it says so;
// - missing information becomes open questions (merge questions plus the deterministic gap pass);
// - the result must pass validateModel.
import type { AccessMethod, AccessStatus, BusinessRule, Conflict, ElementTarget, ExceptionPath, Flow, Gateway, Metric, OpenQuestion, ProcessEvent, ProcessModel, Role, SourceRef, Step, SystemRef } from '../processModel/types.ts';
import { PROCESS_MODEL_SCHEMA_VERSION } from '../processModel/types.ts';
import { validateModel, errorsOf } from '../processModel/validate.ts';
import { gaps } from '../processModel/selectors.ts';
import { formatMetric, type Candidate, type CandidateSet } from './candidates.ts';

export interface MergeFlowOutput {
  roles: { key: string; name: string; kind: Role['kind']; members: string[] }[];
  systems: { key: string; name: string; kind: SystemRef['kind']; members: string[] }[];
  steps: { key: string; name: string; description: string; taskType: Step['taskType']; roles: string[]; systems: string[]; members: string[] }[];
  gateways: { key: string; question: string; members: string[] }[];
  events: { key: string; kind: 'start' | 'end'; name: string; members: string[] }[];
  flows: { from: string; to: string; label: string }[];
}

export interface MergeFactsOutput {
  rules: { name: string; condition: string; action: string; members: string[] }[];
  exceptions: { name: string; kind: ExceptionPath['kind']; trigger: string; handling: string; routedTo: string; members: string[] }[];
  interfaces: { system: string; method: AccessMethod['method']; name: string; operations: string[]; access: AccessStatus; members: string[] }[];
  metrics: { label: string; chosen: string; members: string[] }[];
  conflicts: { summary: string; about: 'rule' | 'metric' | 'interface' | 'other'; members: string[] }[];
  questions: { question: string; whyItMatters: string; members: string[] }[];
}

export interface AssembleReport {
  dropped: string[];
  questionsFromGaps: number;
}

// ---- small helpers --------------------------------------------------------------------------

const words = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter(w => w.length > 1));
export function nameSimilarity(a: string, b: string): number {
  const x = words(a), y = words(b);
  if (!x.size || !y.size) return 0;
  let common = 0;
  for (const w of x) if (y.has(w)) common++;
  return (2 * common) / (x.size + y.size);
}

const dedupeRefs = (refs: SourceRef[]) => {
  const seen = new Set<string>();
  return refs.filter(r => { const k = `${r.sourceId}|${r.excerpt}`; if (seen.has(k)) return false; seen.add(k); return true; });
};

const CAUTION: AccessStatus[] = ['unknown', 'reported', 'confirmed'];
/** The least claimed status: confirmed only if every candidate says confirmed. */
export function cautiousAccess(statuses: AccessStatus[], proposed: AccessStatus): AccessStatus {
  if (statuses.length === 0) return 'unknown';
  if (statuses.every(s => s === 'confirmed_absent')) return 'confirmed_absent';
  if (statuses.includes('confirmed_absent')) return 'unknown';
  const least = statuses.reduce((a, b) => (CAUTION.indexOf(a) <= CAUTION.indexOf(b) ? a : b));
  return CAUTION.indexOf(proposed) < CAUTION.indexOf(least) ? proposed : least;
}

// ---- assemble -------------------------------------------------------------------------------

export function assembleModel(processName: string, set: CandidateSet, flow: MergeFlowOutput, facts: MergeFactsOutput): { model: ProcessModel; report: AssembleReport } {
  const byId = new Map(set.items.map(c => [c.id, c]));
  const dropped: string[] = [];
  /** Members that exist and are of an allowed kind. */
  const membersOf = (ids: string[], kinds: Candidate['kind'][]) => [...new Set(ids)].map(id => byId.get(id)).filter((c): c is Candidate => !!c && kinds.includes(c.kind));
  const refs = (cs: Candidate[]) => dedupeRefs(cs.map(c => c.ref));
  const used = new Set<string>();
  const nextId = (prefix: string) => { let n = 1; while (used.has(`${prefix}-${n}`)) n++; used.add(`${prefix}-${n}`); return `${prefix}-${n}`; };

  // Roles and systems.
  const roleKey = new Map<string, string>();
  const roles: Role[] = [];
  const roleMembers = new Map<string, Candidate[]>();
  for (const r of flow.roles) {
    const ms = membersOf(r.members, ['role']);
    if (!ms.length) { dropped.push(`role "${r.name}": no candidates`); continue; }
    const id = nextId('r');
    roleKey.set(r.key, id);
    roleMembers.set(id, ms);
    roles.push({ id, name: r.name, kind: r.kind, inScope: r.kind !== 'external', status: 'stated', sources: refs(ms) });
  }
  const systemKey = new Map<string, string>();
  const systems: SystemRef[] = [];
  const systemMembers = new Map<string, Candidate[]>();
  for (const s of flow.systems) {
    const ms = membersOf(s.members, ['system']);
    if (!ms.length) { dropped.push(`system "${s.name}": no candidates`); continue; }
    const id = nextId('sys');
    systemKey.set(s.key, id);
    systemMembers.set(id, ms);
    systems.push({ id, name: s.name, kind: s.kind, inScope: true, access: [], status: 'stated', sources: refs(ms) });
  }
  const findSystem = (name: string): SystemRef | undefined => {
    let best: SystemRef | undefined, score = 0;
    for (const s of systems) {
      const names = [s.name, ...(systemMembers.get(s.id) ?? []).map(c => String(c.data.name))];
      const v = Math.max(...names.map(n => nameSimilarity(name, n)));
      if (v > score) { score = v; best = s; }
    }
    return score >= 0.5 ? best : undefined;
  };
  const findRole = (name: string): Role | undefined => {
    let best: Role | undefined, score = 0;
    for (const r of roles) {
      const names = [r.name, ...(roleMembers.get(r.id) ?? []).map(c => String(c.data.name))];
      const v = Math.max(...names.map(n => nameSimilarity(name, n)));
      if (v > score) { score = v; best = r; }
    }
    return score >= 0.5 ? best : undefined;
  };

  // Interfaces become access methods on their system.
  for (const itf of facts.interfaces) {
    const ms = membersOf(itf.members, ['interface']);
    if (!ms.length) { dropped.push(`interface "${itf.name || itf.method}": no candidates`); continue; }
    let sys = findSystem(itf.system) ?? ms.map(c => findSystem(String(c.data.system))).find(Boolean);
    if (!sys) {
      const id = nextId('sys');
      sys = { id, name: itf.system, kind: 'other', inScope: true, access: [], status: 'stated', sources: refs(ms) };
      systems.push(sys);
    }
    const access = cautiousAccess(ms.map(c => c.data.access as AccessStatus), itf.access);
    const m: AccessMethod = { method: itf.method, operations: itf.operations.filter(Boolean), access, status: 'stated', sources: refs(ms) };
    if (itf.name.trim()) m.name = itf.name.trim();
    sys.access.push(m);
  }

  // Steps, gateways and events.
  const nodeKey = new Map<string, string>();
  const steps: Step[] = [];
  for (const s of flow.steps) {
    const ms = membersOf(s.members, ['step']);
    if (!ms.length) { dropped.push(`step "${s.name}": no candidates`); continue; }
    const id = nextId('s');
    nodeKey.set(s.key, id);
    steps.push({
      id, name: s.name, description: s.description, taskType: s.taskType,
      roleIds: [...new Set(s.roles.map(k => roleKey.get(k)).filter((x): x is string => !!x))],
      systemIds: [...new Set(s.systems.map(k => systemKey.get(k)).filter((x): x is string => !!x))],
      inputs: [], outputs: [], ruleIds: [], exceptionIds: [], status: 'stated', sources: refs(ms),
    });
  }
  const gateways: Gateway[] = [];
  for (const g of flow.gateways) {
    const ms = membersOf(g.members, ['decision']);
    if (!ms.length) { dropped.push(`decision "${g.question}": no candidates`); continue; }
    const id = nextId('g');
    nodeKey.set(g.key, id);
    gateways.push({ id, type: 'exclusive', question: g.question, status: 'stated', sources: refs(ms) });
  }
  const pendingEvents: { key: string; event: ProcessEvent }[] = [];
  for (const e of flow.events) {
    const ms = membersOf(e.members, ['step', 'decision', 'rule', 'exception']);
    const id = nextId('e');
    nodeKey.set(e.key, id);
    pendingEvents.push({ key: e.key, event: { id, kind: e.kind, name: e.name, status: ms.length ? 'stated' : 'inferred', sources: refs(ms) } });
  }
  const kindOf = new Map<string, 'start' | 'end'>(pendingEvents.map(p => [p.event.id, p.event.kind]));
  const flows: Flow[] = [];
  const pairs = new Set<string>();
  for (const f of flow.flows) {
    const from = nodeKey.get(f.from), to = nodeKey.get(f.to);
    if (!from || !to || from === to) continue;
    if (kindOf.get(to) === 'start' || kindOf.get(from) === 'end') continue;
    if (pairs.has(`${from}>${to}`)) continue;
    pairs.add(`${from}>${to}`);
    const flowRow: Flow = { id: nextId('f'), from, to };
    if (f.label.trim()) flowRow.label = f.label.trim();
    flows.push(flowRow);
  }
  // An event with no candidates of its own cites the element it connects to; one with nothing at all is dropped.
  const nodeSources = new Map<string, SourceRef[]>([...steps, ...gateways].map(n => [n.id, n.sources]));
  const events: ProcessEvent[] = [];
  for (const { event } of pendingEvents) {
    if (!event.sources.length) {
      const neighbour = flows.find(f => f.from === event.id || f.to === event.id);
      const other = neighbour && (neighbour.from === event.id ? neighbour.to : neighbour.from);
      event.sources = (other && nodeSources.get(other)?.slice(0, 1)) || [];
    }
    if (!event.sources.length) { dropped.push(`event "${event.name}": not connected`); continue; }
    events.push(event);
  }
  const live = new Set([...events, ...steps, ...gateways].map(n => n.id));
  const keptFlows = flows.filter(f => live.has(f.from) && live.has(f.to));

  // Rules, exceptions, metrics.
  const rules: BusinessRule[] = [];
  const ruleOfCandidate = new Map<string, string>();
  for (const r of facts.rules) {
    const ms = membersOf(r.members, ['rule']);
    if (!ms.length) { dropped.push(`rule "${r.name}": no candidates`); continue; }
    const id = nextId('br');
    ms.forEach(c => ruleOfCandidate.set(c.id, id));
    rules.push({ id, name: r.name, condition: r.condition, action: r.action, status: 'stated', sources: refs(ms) });
  }
  const exceptions: ExceptionPath[] = [];
  for (const x of facts.exceptions) {
    const ms = membersOf(x.members, ['exception']);
    if (!ms.length) { dropped.push(`exception "${x.name}": no candidates`); continue; }
    const e: ExceptionPath = { id: nextId('x'), kind: x.kind, name: x.name, trigger: x.trigger, stepIds: [], handling: x.handling, status: 'stated', sources: refs(ms) };
    const role = x.routedTo.trim() ? findRole(x.routedTo) : undefined;
    if (role) e.routedToRoleId = role.id;
    exceptions.push(e);
  }
  const metrics: Metric[] = [];
  const metricOfCandidate = new Map<string, string>();
  for (const g of facts.metrics) {
    const ms = membersOf(g.members, ['metric']);
    const chosen = ms.find(c => c.id === g.chosen) ?? ms[0];
    if (!chosen) { dropped.push(`metric "${g.label}": no candidates`); continue; }
    const d = chosen.data;
    const id = nextId('m');
    ms.forEach(c => metricOfCandidate.set(c.id, id));
    const m: Metric = { id, kind: d.kind, label: g.label || d.label, value: d.value, unit: d.unit || '', status: 'stated', sources: refs(ms) };
    if (d.low !== null && d.high !== null && d.low <= d.high) m.range = [d.low, d.high];
    if (m.value === null && !m.range) { dropped.push(`metric "${g.label}": no number`); continue; }
    if (d.period) m.period = d.period;
    if (d.appliesTo) m.appliesTo = d.appliesTo;
    metrics.push(m);
  }

  // Conflicts: two or more distinct stated values, never resolved here.
  const conflicts: Conflict[] = [];
  for (const k of facts.conflicts) {
    const ms = membersOf(k.members, ['rule', 'metric', 'interface', 'step', 'exception']);
    const values = new Map<string, SourceRef[]>();
    for (const c of ms) {
      const v = c.kind === 'metric' ? `${formatMetric(c.data)}${c.data.period ? ` (${c.data.period})` : ''}`
        : c.kind === 'rule' ? String(c.data.condition)
          : c.kind === 'interface' ? `${c.data.name || c.data.method}: ${c.data.access}`
            : c.ref.excerpt;
      values.set(v, [...(values.get(v) ?? []), c.ref]);
    }
    if (values.size < 2) { dropped.push(`conflict "${k.summary}": fewer than two distinct values`); continue; }
    let target: ElementTarget = { kind: 'meta' };
    const ruleId = ms.map(c => ruleOfCandidate.get(c.id)).find(Boolean);
    const metricId = ms.map(c => metricOfCandidate.get(c.id)).find(Boolean);
    if (k.about === 'rule' && ruleId) target = { kind: 'rule', id: ruleId, field: 'condition' };
    else if (k.about === 'metric' && metricId) target = { kind: 'metric', id: metricId, field: 'value' };
    conflicts.push({ id: nextId('k'), target, summary: k.summary, values: [...values].map(([value, sources]) => ({ value, sources: dedupeRefs(sources) })), resolution: null });
  }

  const model: ProcessModel = {
    schemaVersion: PROCESS_MODEL_SCHEMA_VERSION,
    meta: {
      name: processName,
      objective: { value: null, status: 'unknown', sources: [] },
      owner: { value: null, status: 'unknown', sources: [] },
      scopeIn: [], scopeOut: [], metrics,
    },
    roles, systems, events, steps, gateways, flows: keptFlows, rules, exceptions,
    dataObjects: [], painPoints: [], controls: [], risks: [], openQuestions: [], conflicts,
  };

  // Questions: from the merge pass, then interfaces nobody has confirmed, then the gap pass.
  const questions: OpenQuestion[] = [];
  const addQuestion = (target: ElementTarget, question: string, whyItMatters: string) => {
    if (!question.trim() || questions.some(q => nameSimilarity(q.question, question) >= 0.8)) return;
    questions.push({ id: nextId('q'), target, question: question.trim(), whyItMatters: whyItMatters.trim(), owner: null, status: 'open' });
  };
  for (const q of facts.questions) addQuestion({ kind: 'meta' }, q.question, q.whyItMatters);
  for (const s of systems) {
    for (const a of s.access) {
      if (a.access !== 'unknown' && a.access !== 'reported') continue;
      if (a.name && questions.some(q => q.question.toLowerCase().includes(a.name!.toLowerCase()))) continue;
      const what = a.name ? `${a.name} (${a.operations.join(', ') || a.method})` : `${a.method} access to ${s.name}${a.operations.length ? ` to ${a.operations.join(', ')}` : ''}`;
      addQuestion({ kind: 'system', id: s.id, field: 'access' }, `Is ${what} available for use from ${s.name}, and when?`, a.access === 'reported' ? 'It is said to exist but is not confirmed for use; an API-first design depends on it.' : 'Nobody has confirmed it; the integration design depends on it.');
    }
  }
  const before = questions.length;
  for (const g of gaps(model)) {
    if (g.kind === 'unknown_value' && g.target.kind === 'meta') continue; // objective and owner are asked once the process page is reviewed
    addQuestion(g.target, g.label, g.kind === 'step_without_role' ? 'Assessment and documents need an owner for each step.' : g.kind === 'step_without_system' ? 'The automation design depends on the systems used.' : 'The assessment depends on it.');
  }
  model.openQuestions = questions;

  const v = validateModel(model);
  if (!v.valid) throw new Error(`Assembled model is invalid: ${errorsOf(v).slice(0, 5).map(e => `${e.path} ${e.message}`).join('; ')}`);
  return { model, report: { dropped, questionsFromGaps: questions.length - before } };
}
