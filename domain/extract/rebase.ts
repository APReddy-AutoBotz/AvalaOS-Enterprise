// Bringing an extraction into a model that people may already have edited.
//
// proposeChanges compares the current model with a freshly extracted one and lists what would
// change; applyChanges builds the next model from the changes a person selected. The rules:
// - a person's decisions are never overwritten: where the sources now say something different
//   about a confirmed element, the change records a conflict for the person to resolve;
// - new elements are added, and updated elements take the extraction's values and sources;
// - an element the extraction no longer finds is offered for removal, unselected, and only if no
//   person confirmed it;
// - into a model with nothing in it yet, the extraction is taken as it is.
import type { Conflict, ElementTarget, Flow, ProcessModel, SourceRef } from '../processModel/types.ts';
import { newId, removeElement, removeStep } from '../processModel/patch.ts';
import { errorsOf, validateModel } from '../processModel/validate.ts';
import { nameSimilarity } from './assemble.ts';

export type ChangeKind = 'add' | 'update' | 'remove' | 'conflict';
export type ElementKind = 'role' | 'system' | 'step' | 'gateway' | 'event' | 'rule' | 'exception' | 'metric' | 'data' | 'question' | 'conflict' | 'meta';

export interface ProposedChange {
  id: string;
  kind: ChangeKind;
  element: ElementKind;
  /** The element in the current model (update, remove, conflict). */
  currentId?: string;
  /** The element in the extracted model (add, update, conflict). */
  extractedId?: string;
  label: string;
  detail: string;
  defaultSelected: boolean;
}

export interface ChangeSet {
  /** The current model had no content: the extraction is taken whole. */
  first: boolean;
  changes: ProposedChange[];
  /** Elements that matched and agree; their new sources are added without asking. */
  unchanged: number;
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const isEmpty = (m: ProcessModel) =>
  !m.steps.length && !m.roles.length && !m.systems.length && !m.rules.length && !m.exceptions.length && !m.meta.metrics.length &&
  !m.dataObjects.length && !m.gateways.length && !m.openQuestions.length && m.meta.objective.status === 'unknown' && m.meta.owner.status === 'unknown';
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
const mergeRefs = (a: SourceRef[], b: SourceRef[]) => {
  const seen = new Set(a.map(r => `${r.sourceId}|${r.excerpt}`));
  return [...a, ...b.filter(r => !seen.has(`${r.sourceId}|${r.excerpt}`))];
};

interface Kind<T> {
  element: ElementKind;
  list(m: ProcessModel): T[];
  name(x: T): string;
  /** Similarity of two elements, 0 to 1. */
  same(a: T, b: T): number;
  /** The fields compared and copied, after mapping references. */
  fields: string[];
}

type Any = Record<string, any> & { id: string; status: string; sources: SourceRef[] };
const byName = (a: string, b: string) => (norm(a) === norm(b) ? 1 : nameSimilarity(a, b));

const KINDS: Kind<Any>[] = [
  { element: 'role', list: m => m.roles as Any[], name: x => x.name, same: (a, b) => byName(a.name, b.name), fields: ['name', 'kind', 'inScope'] },
  { element: 'system', list: m => m.systems as Any[], name: x => x.name, same: (a, b) => byName(a.name, b.name), fields: ['name', 'kind', 'access'] },
  { element: 'rule', list: m => m.rules as Any[], name: x => x.name, same: (a, b) => Math.max(byName(a.name, b.name), byName(a.condition, b.condition)), fields: ['name', 'condition', 'action'] },
  { element: 'exception', list: m => m.exceptions as Any[], name: x => x.name, same: (a, b) => byName(a.name, b.name), fields: ['name', 'kind', 'trigger', 'handling', 'routedToRoleId'] },
  { element: 'metric', list: m => m.meta.metrics as Any[], name: x => x.label, same: (a, b) => (norm(a.unit) === norm(b.unit) || !a.unit || !b.unit ? byName(a.label, b.label) : 0), fields: ['label', 'value', 'range', 'unit', 'period'] },
  { element: 'data', list: m => m.dataObjects as Any[], name: x => x.name, same: (a, b) => byName(a.name, b.name), fields: ['name', 'format', 'structured', 'classification'] },
  { element: 'event', list: m => m.events as Any[], name: x => x.name, same: (a, b) => (a.kind === b.kind ? (a.kind === 'start' ? 1 : byName(a.name, b.name)) : 0), fields: ['name'] },
  { element: 'gateway', list: m => m.gateways as Any[], name: x => x.question, same: (a, b) => byName(a.question, b.question), fields: ['question', 'type'] },
  { element: 'step', list: m => m.steps as Any[], name: x => x.name, same: (a, b) => byName(a.name, b.name), fields: ['name', 'description', 'roleIds', 'systemIds', 'taskType', 'ruleIds', 'exceptionIds'] },
];
const THRESHOLD = 0.75;
const PREFIX: Record<string, string> = { role: 'r', system: 'sys', rule: 'br', exception: 'x', metric: 'm', data: 'd', event: 'e', gateway: 'g', step: 's' };

/** Pairs extracted elements with current ones, best match first, each used once. */
function match<T extends Any>(kind: Kind<T>, current: T[], extracted: T[]): Map<string, string> {
  const pairs: [number, string, string][] = [];
  // Two elements that quote the same source text are the same element, whatever they are called now.
  const quotes = (x: T) => new Set(x.sources.map(r => `${r.sourceId}|${r.excerpt}`));
  for (const e of extracted) {
    const eq = quotes(e);
    for (const c of current) {
      const shared = c.sources.some(r => eq.has(`${r.sourceId}|${r.excerpt}`));
      const s = Math.max(kind.same(c, e), shared ? 0.9 : 0);
      if (s >= THRESHOLD) pairs.push([s, e.id, c.id]);
    }
  }
  pairs.sort((a, b) => b[0] - a[0]);
  const out = new Map<string, string>();
  const taken = new Set<string>();
  for (const [, e, c] of pairs) if (!out.has(e) && !taken.has(c)) { out.set(e, c); taken.add(c); }
  return out;
}

interface Plan {
  first: boolean;
  /** extracted id -> current id, for every matched element of every kind. */
  map: Map<string, string>;
  changes: ProposedChange[];
  unchanged: number;
}

/** Maps reference fields of an extracted element into current ids (unmapped references are dropped). */
function mapRefs(x: Any, map: Map<string, string>): Any {
  const y = clone(x);
  for (const f of ['roleIds', 'systemIds', 'ruleIds', 'exceptionIds', 'stepIds']) if (Array.isArray(y[f])) y[f] = y[f].map((id: string) => map.get(id)).filter(Boolean);
  if (y.routedToRoleId) { const r = map.get(y.routedToRoleId); if (r) y.routedToRoleId = r; else delete y.routedToRoleId; }
  return y;
}

const show = (v: unknown) => (Array.isArray(v) ? v.join(', ') : v === null || v === undefined ? 'unknown' : typeof v === 'object' ? JSON.stringify(v) : String(v));

function plan(current: ProcessModel, extracted: ProcessModel): Plan {
  if (isEmpty(current)) {
    const changes: ProposedChange[] = KINDS.flatMap(k => k.list(extracted).map(x => ({ id: `add:${k.element}:${x.id}`, kind: 'add' as const, element: k.element, extractedId: x.id, label: k.name(x), detail: '', defaultSelected: true })));
    return { first: true, map: new Map(), changes, unchanged: 0 };
  }
  const map = new Map<string, string>();
  for (const k of KINDS) for (const [e, c] of match(k, k.list(current), k.list(extracted))) map.set(e, c);
  // Roles that a matched step uses are worth keeping even when renamed slightly; ids map once.
  const changes: ProposedChange[] = [];
  let unchanged = 0;
  const nameOfCurrent = (id: string) => {
    for (const k of KINDS) { const x = k.list(current).find(y => y.id === id); if (x) return k.name(x); }
    return id;
  };
  const showField = (f: string, v: unknown) => (Array.isArray(v) && /Ids$/.test(f) ? (v as string[]).map(nameOfCurrent).join(', ') || 'none' : show(v));

  for (const k of KINDS) {
    const cur = new Map(k.list(current).map(x => [x.id, x]));
    const matched = new Set<string>();
    for (const e of k.list(extracted)) {
      const cid = map.get(e.id);
      if (!cid) { changes.push({ id: `add:${k.element}:${e.id}`, kind: 'add', element: k.element, extractedId: e.id, label: k.name(e), detail: 'New in the sources', defaultSelected: true }); continue; }
      matched.add(cid);
      const c = cur.get(cid)!;
      const mapped = mapRefs(e, map);
      const diffs = k.fields.filter(f => JSON.stringify(c[f] ?? null) !== JSON.stringify(mapped[f] ?? null) && !(f === 'description' && !mapped[f]));
      if (!diffs.length) { unchanged++; continue; }
      const detail = diffs.map(f => `${f.replace(/Ids$/, 's')}: ${showField(f, c[f])} → ${showField(f, mapped[f])}`).join('; ');
      if (c.status === 'user-confirmed') {
        changes.push({ id: `conflict:${k.element}:${cid}`, kind: 'conflict', element: k.element, currentId: cid, extractedId: e.id, label: k.name(c), detail: `You confirmed this; the sources now say otherwise. ${detail}`, defaultSelected: true });
      } else {
        changes.push({ id: `update:${k.element}:${cid}`, kind: 'update', element: k.element, currentId: cid, extractedId: e.id, label: k.name(c), detail, defaultSelected: true });
      }
    }
    for (const c of k.list(current)) {
      if (matched.has(c.id) || c.status === 'user-confirmed' || c.status === 'assumed' || k.element === 'event') continue;
      changes.push({ id: `remove:${k.element}:${c.id}`, kind: 'remove', element: k.element, currentId: c.id, label: k.name(c), detail: 'No longer found in the sources', defaultSelected: false });
    }
  }
  // Meta facts: fill unknowns; a confirmed value that differs becomes a conflict.
  for (const f of ['objective', 'owner'] as const) {
    const c = current.meta[f], e = extracted.meta[f];
    if (e.value === null || norm(String(c.value ?? '')) === norm(String(e.value))) continue;
    if (c.status === 'user-confirmed') changes.push({ id: `conflict:meta:${f}`, kind: 'conflict', element: 'meta', currentId: f, label: `Process ${f}`, detail: `You confirmed "${show(c.value)}"; the sources say "${show(e.value)}".`, defaultSelected: true });
    else changes.push({ id: `update:meta:${f}`, kind: 'update', element: 'meta', currentId: f, label: `Process ${f}`, detail: `${show(c.value)} → ${show(e.value)}`, defaultSelected: true });
  }
  // Questions and conflicts from the extraction that are new.
  for (const q of extracted.openQuestions) {
    if (current.openQuestions.some(x => nameSimilarity(x.question, q.question) >= 0.8)) continue;
    changes.push({ id: `add:question:${q.id}`, kind: 'add', element: 'question', extractedId: q.id, label: q.question, detail: 'New open question', defaultSelected: true });
  }
  for (const x of extracted.conflicts) {
    if (current.conflicts.some(y => nameSimilarity(y.summary, x.summary) >= 0.8)) continue;
    changes.push({ id: `add:conflict:${x.id}`, kind: 'add', element: 'conflict', extractedId: x.id, label: x.summary, detail: 'Sources disagree', defaultSelected: true });
  }
  return { first: false, map, changes, unchanged };
}

export function proposeChanges(current: ProcessModel, extracted: ProcessModel): ChangeSet {
  const p = plan(current, extracted);
  return { first: p.first, changes: p.changes, unchanged: p.unchanged };
}

/** The next model: the current one with the selected changes applied. It is validated before it is returned. */
export function applyChanges(current: ProcessModel, extracted: ProcessModel, selected: Set<string>): ProcessModel {
  const p = plan(current, extracted);
  if (p.first) {
    const next = clone(extracted);
    next.meta.name = current.meta.name;
    return checked(next);
  }
  let next = clone(current);
  const map = new Map(p.map);
  const on = (c: ProposedChange) => selected.has(c.id);
  const ex = (k: Kind<Any>, id: string) => k.list(extracted).find(x => x.id === id)!;
  const kindOf = (e: ElementKind) => KINDS.find(k => k.element === e)!;

  // 1. Additions get new ids first, so references between new elements resolve.
  const added: { change: ProposedChange; id: string }[] = [];
  for (const k of KINDS) {
    for (const c of p.changes.filter(x => x.kind === 'add' && x.element === k.element && on(x))) {
      const id = newId(next, PREFIX[k.element]);
      map.set(c.extractedId!, id);
      // Reserve the id so the next call to newId moves on.
      (k.list(next) as Any[]).push({ id, status: 'stated', sources: [] } as Any);
      added.push({ change: c, id });
    }
  }
  for (const { change, id } of added) {
    const k = kindOf(change.element);
    const list = k.list(next) as Any[];
    list[list.findIndex(x => x.id === id)] = { ...mapRefs(ex(k, change.extractedId!), map), id };
  }

  // 2. Updates take the extraction's values and sources; conflicts are recorded, values kept.
  const conflicts: Conflict[] = [];
  for (const c of p.changes.filter(x => (x.kind === 'update' || x.kind === 'conflict') && x.element !== 'meta' && on(x))) {
    const k = kindOf(c.element);
    const list = k.list(next) as Any[];
    const i = list.findIndex(x => x.id === c.currentId);
    const e = mapRefs(ex(k, c.extractedId!), map);
    if (c.kind === 'update') {
      const merged: Any = { ...list[i] };
      for (const f of k.fields) { if (e[f] === undefined) delete merged[f]; else merged[f] = e[f]; }
      merged.status = e.status;
      merged.sources = e.sources;
      list[i] = merged;
    } else {
      const cur = list[i];
      const field = k.fields.find(f => JSON.stringify(cur[f] ?? null) !== JSON.stringify(e[f] ?? null))!;
      const target = { kind: targetKind(c.element), id: cur.id, field } as ElementTarget;
      conflicts.push({ id: '', target, summary: `${k.name(cur)}: confirmed value differs from the sources`, values: [{ value: show(cur[field]), sources: cur.sources }, { value: show(e[field]), sources: e.sources }], resolution: null });
    }
  }
  for (const c of p.changes.filter(x => x.element === 'meta' && on(x))) {
    const f = c.currentId as 'objective' | 'owner';
    const e = extracted.meta[f];
    if (c.kind === 'update') next.meta[f] = clone(e);
    else conflicts.push({ id: '', target: { kind: 'meta', field: f }, summary: `Process ${f}: confirmed value differs from the sources`, values: [{ value: show(next.meta[f].value), sources: next.meta[f].sources }, { value: show(e.value), sources: e.sources }], resolution: null });
  }

  // 3. Flows that touch an added node, where both ends are known; a direct flow the new node now
  //    sits inside is removed so the step is inserted, not put in parallel.
  const addedIds = new Set(added.map(a => a.id));
  for (const f of extracted.flows) {
    const from = map.get(f.from), to = map.get(f.to);
    if (!from || !to || (!addedIds.has(from) && !addedIds.has(to))) continue;
    if (next.flows.some(x => x.from === from && x.to === to)) continue;
    const flow: Flow = { id: newId(next, 'f'), from, to };
    if (f.label !== undefined) flow.label = f.label;
    if (f.isException) flow.isException = true;
    next.flows.push(flow);
  }
  for (const a of added.filter(x => x.change.element === 'step' || x.change.element === 'gateway')) {
    const ins = next.flows.filter(f => f.to === a.id).map(f => f.from);
    const outs = next.flows.filter(f => f.from === a.id).map(f => f.to);
    next.flows = next.flows.filter(f => !(ins.includes(f.from) && outs.includes(f.to) && !extracted.flows.some(x => map.get(x.from) === f.from && map.get(x.to) === f.to)));
  }

  // 4. Questions and conflicts.
  for (const c of p.changes.filter(x => x.element === 'question' && on(x))) {
    const q = clone(extracted.openQuestions.find(x => x.id === c.extractedId)!);
    const t = q.target;
    if (t.id) { const id = map.get(t.id); if (!id) continue; t.id = id; }
    next.openQuestions.push({ ...q, id: newId(next, 'q') });
  }
  for (const c of p.changes.filter(x => x.element === 'conflict' && x.kind === 'add' && on(x))) {
    const k = clone(extracted.conflicts.find(x => x.id === c.extractedId)!);
    if (k.target.id) { const id = map.get(k.target.id); if (!id) continue; k.target.id = id; }
    next.conflicts.push({ ...k, id: newId(next, 'k') });
  }
  for (const k of conflicts) next.conflicts.push({ ...k, id: newId(next, 'k') });

  // 5. Agreeing matches gain the new sources without asking.
  for (const k of KINDS) {
    for (const e of k.list(extracted)) {
      const cid = p.map.get(e.id);
      if (!cid || p.changes.some(c => c.currentId === cid && c.element === k.element && c.kind !== 'add')) continue;
      const el = (k.list(next) as Any[]).find(x => x.id === cid);
      if (el && el.status !== 'user-confirmed') el.sources = mergeRefs(el.sources, e.sources);
    }
  }

  // 6. Removals, through the edit operations so references and flows are repaired.
  next = checked(next);
  for (const c of p.changes.filter(x => x.kind === 'remove' && on(x))) {
    if (c.element === 'step') next = removeStep(next, { stepId: c.currentId! }).model;
    else if (['role', 'system', 'rule', 'exception', 'data'].includes(c.element)) next = removeElement(next, { kind: c.element as 'role', id: c.currentId! }).model;
    else if (c.element === 'metric') next.meta.metrics = next.meta.metrics.filter(x => x.id !== c.currentId);
    else if (c.element === 'gateway') {
      next.gateways = next.gateways.filter(x => x.id !== c.currentId);
      next.flows = next.flows.filter(f => f.from !== c.currentId && f.to !== c.currentId);
    }
  }
  return checked(next);
}

function targetKind(e: ElementKind): ElementTarget['kind'] {
  return e === 'event' || e === 'question' || e === 'conflict' ? 'meta' : e as ElementTarget['kind'];
}

function checked(m: ProcessModel): ProcessModel {
  const v = validateModel(m);
  if (!v.valid) throw new Error(`The merged model is invalid: ${errorsOf(v).slice(0, 3).map(e => `${e.path} ${e.message}`).join('; ')}`);
  return m;
}
