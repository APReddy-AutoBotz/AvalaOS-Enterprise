import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { ProcessModel } from './types.ts';
import { validateModel } from './validate.ts';
import { applyPatch, deepEqual, diff, JsonPatchError } from './jsonPatch.ts';
import { addFlow, addQuestion, addRole, addRule, addStep, addSystem, answerQuestion, ModelOpError, removeElement, moveStep, removeFlow, removeStep, resolveConflict, updateFact, type OpResult } from './patch.ts';
import { changedSelections, hashModel, hashSelections, canonicalJson } from './hash.ts';
import { gaps, incoming, openItemCount, orderedSteps, outgoing, untrackedGaps } from './selectors.ts';
import { fromAssessV2 } from './fromAssessV2.ts';
import { AP_INVOICE_EXCEPTION_V2_FIXTURE } from '../../services/assessV2/fixture.ts';

const gold = (): ProcessModel => JSON.parse(readFileSync(new URL('../../eval/corpus/ap-invoice/expected.model.json', import.meta.url), 'utf8'));
const codes = (m: ProcessModel) => validateModel(m).issues.filter(i => i.severity === 'error').map(i => i.code);
const rejects = (fn: () => unknown, code: string) => assert.throws(fn, (e: unknown) => e instanceof ModelOpError && e.code === code);
/** A step on the main path with exactly one incoming and one outgoing flow. */
const middleStep = (m: ProcessModel) => m.steps.find(s => incoming(m, s.id).length === 1 && outgoing(m, s.id).length === 1)!;

// ---------------------------------------------------------------- validation

test('the AP gold model is valid with no warnings', () => {
  assert.deepEqual(validateModel(gold()).issues, []);
});

test('validation catches duplicates, broken references, unsourced claims and bad facts', () => {
  const m = gold();
  m.steps[1].id = m.steps[0].id;
  assert.ok(codes(m).includes('ID_DUPLICATE'));

  const b = gold();
  b.steps[0].roleIds = ['r-nobody'];
  b.flows[0].to = 'nowhere';
  assert.deepEqual(new Set(codes(b)), new Set(['BROKEN_REF']));

  const c = gold();
  c.steps[0].status = 'stated';
  c.steps[0].sources = [];
  c.meta.owner = { value: 'Someone', status: 'unknown', sources: [] };
  c.meta.objective = { value: null, status: 'user-confirmed', sources: [] };
  assert.deepEqual(new Set(codes(c)), new Set(['UNSOURCED', 'UNKNOWN_HAS_VALUE', 'KNOWN_WITHOUT_VALUE']));

  const d = gold();
  d.flows.push({ ...d.flows[0], id: 'f-dup' });
  d.flows.push({ id: 'f-self', from: d.steps[0].id, to: d.steps[0].id });
  const end = d.events.find(e => e.kind === 'end')!;
  d.flows.push({ id: 'f-end', from: end.id, to: d.steps[0].id });
  assert.deepEqual(new Set(codes(d)), new Set(['DUPLICATE_FLOW', 'SELF_LOOP', 'END_HAS_OUTGOING']));
});

// ---------------------------------------------------------------- JSON Patch

test('applyPatch handles add, remove, replace, test and pointer escaping, and leaves the input alone', () => {
  const doc = { a: [1, 2], 'x/y': { '~k': 1 } };
  const out = applyPatch(doc, [
    { op: 'add', path: '/a/-', value: 3 },
    { op: 'add', path: '/a/0', value: 0 },
    { op: 'remove', path: '/a/1' },
    { op: 'replace', path: '/x~1y/~0k', value: 2 },
    { op: 'test', path: '/a', value: [0, 2, 3] },
  ]);
  assert.deepEqual(out, { a: [0, 2, 3], 'x/y': { '~k': 2 } });
  assert.deepEqual(doc, { a: [1, 2], 'x/y': { '~k': 1 } });
  assert.throws(() => applyPatch(doc, [{ op: 'test', path: '/a/0', value: 9 }]), JsonPatchError);
  assert.throws(() => applyPatch(doc, [{ op: 'remove', path: '/missing' }]), JsonPatchError);
});

test('diff produces a patch that reproduces the target', () => {
  const pairs: [unknown, unknown][] = [
    [{ a: 1, b: [1, 2, 3] }, { a: 2, b: [1, 3], c: { d: null } }],
    [{ list: [{ id: 1 }, { id: 2 }] }, { list: [{ id: 0 }, { id: 1 }, { id: 2 }] }],
    [{ list: [1, 2, 3, 4] }, { list: [4, 3] }],
    [{ k: 'x', gone: true }, { k: 'x' }],
  ];
  for (const [a, b] of pairs) assert.deepEqual(applyPatch(a, diff(a, b)), b);
});

// ---------------------------------------------------------------- operations

test('addStep inserts into a flow and removeStep joins the neighbours back', () => {
  const m = gold();
  const s = middleStep(m);
  const next = outgoing(m, s.id)[0].to;
  const added = addStep(m, { step: { name: 'Check duplicate in tracker', taskType: 'user' }, after: s.id });
  assert.equal(added.stepId, 's-1');
  assert.deepEqual(outgoing(added.model, s.id).map(f => f.to), [added.stepId]);
  assert.deepEqual(outgoing(added.model, added.stepId).map(f => f.to), [next]);
  assert.equal(added.model.steps.find(x => x.id === added.stepId)!.status, 'user-confirmed');

  const removed = removeStep(added.model, { stepId: added.stepId });
  assert.deepEqual(outgoing(removed.model, s.id).map(f => f.to), [next]);
  assert.equal(validateModel(removed.model).valid, true);
});

test('removeStep keeps branch labels and drops every reference to the step', () => {
  const m = gold();
  const branchTarget = m.flows.find(f => f.label && m.steps.some(s => s.id === f.to) && outgoing(m, f.to).length === 1)!;
  const stepId = branchTarget.to;
  const after = outgoing(m, stepId)[0].to;
  const { model } = removeStep(m, { stepId });
  const rejoined = model.flows.find(f => f.from === branchTarget.from && f.to === after);
  if (rejoined) assert.equal(rejoined.label, branchTarget.label);
  const text = JSON.stringify({ ...model, flows: model.flows, steps: model.steps });
  assert.equal(text.includes(`"${stepId}"`), false);
});

test('moveStep and position errors', () => {
  const m = gold();
  const order = orderedSteps(m).map(s => s.id);
  const s = middleStep(m);
  const first = order[0];
  const moved = moveStep(m, { stepId: s.id, before: first });
  assert.ok(outgoing(moved.model, s.id).some(f => f.to === first));
  const gateway = m.gateways.find(g => outgoing(m, g.id).length > 1)!;
  rejects(() => addStep(m, { step: { name: 'X', taskType: 'user' }, after: gateway.id }), 'AMBIGUOUS_POSITION');
  rejects(() => moveStep(m, { stepId: s.id, after: s.id }), 'BAD_POSITION');
  const end = m.events.find(e => e.kind === 'end')!;
  rejects(() => addStep(m, { step: { name: 'X', taskType: 'user' }, after: end.id }), 'BAD_POSITION');
});

test('updateFact confirms edits and refuses invalid ones', () => {
  const m = gold();
  const step = m.steps[0];
  const role = m.roles.find(r => !step.roleIds.includes(r.id))!;
  const r = updateFact(m, { target: { kind: 'step', id: step.id, field: 'roleIds' }, value: [role.id] });
  const edited = r.model.steps[0];
  assert.deepEqual(edited.roleIds, [role.id]);
  assert.equal(edited.status, 'user-confirmed');
  assert.deepEqual(edited.sources, step.sources, 'sources are kept');
  assert.deepEqual(r.patch.map(p => p.path).sort(), ['/steps/0/roleIds/0', '/steps/0/status'].sort());

  rejects(() => updateFact(m, { target: { kind: 'step', id: step.id, field: 'roleIds' }, value: ['r-nobody'] }), 'INVALID_RESULT');
  rejects(() => updateFact(m, { target: { kind: 'step', id: step.id, field: 'id' }, value: 'x' }), 'NOT_EDITABLE');
  rejects(() => updateFact(m, { target: { kind: 'step', id: step.id, field: 'status' }, value: 'stated' }), 'NOT_EDITABLE');

  const cleared = updateFact(m, { target: { kind: 'meta', field: 'owner' }, value: null }).model;
  assert.deepEqual([cleared.meta.owner.value, cleared.meta.owner.status], [null, 'unknown']);
});

test('answering a question writes the answer and the value; resolving a conflict records who and why', () => {
  const m = gold();
  const metric = m.meta.metrics[0];
  m.openQuestions.push({ id: 'q-test', target: { kind: 'metric', id: metric.id, field: 'value' }, question: 'How many?', whyItMatters: 'Sizing.', owner: null, status: 'open' });
  const answered = answerQuestion(m, { questionId: 'q-test', answer: 'About 9,000 a month', value: 9000 }).model;
  const q = answered.openQuestions.find(x => x.id === 'q-test')!;
  assert.deepEqual([q.status, q.answer], ['answered', 'About 9,000 a month']);
  const mm = answered.meta.metrics.find(x => x.id === metric.id)!;
  assert.deepEqual([mm.value, mm.status], [9000, 'user-confirmed']);
  rejects(() => answerQuestion(m, { questionId: 'q-test', answer: '' }), 'INVALID_RESULT');

  const conflict = m.conflicts[0];
  const resolved = resolveConflict(m, { conflictId: conflict.id, chosen: conflict.values[1].value, by: 'Meera Iyer', reason: 'SAP configuration will be aligned to policy.' }).model;
  assert.equal(resolved.conflicts[0].resolution?.by, 'Meera Iyer');
  rejects(() => resolveConflict(m, { conflictId: conflict.id, chosen: 'x', by: '', reason: '' }), 'INVALID_RESULT');
});

test('operations refuse an invalid starting model', () => {
  const m = gold();
  m.steps[0].roleIds = ['r-nobody'];
  rejects(() => addFlow(m, { from: m.steps[0].id, to: m.steps[2].id }), 'INVALID_INPUT');
});

// ---------------------------------------------------------------- property test

/** Small seeded PRNG (mulberry32) so a failure can be replayed. */
function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, pick: <T>(xs: T[]): T | undefined => (xs.length ? xs[Math.floor(next() * xs.length)] : undefined) };
}

/** The only reasons each operation may refuse a randomly chosen edit. Anything else is a bug. */
const ALLOWED_REJECTIONS: Record<string, string[]> = {
  add: ['AMBIGUOUS_POSITION', 'BAD_POSITION'],
  move: ['AMBIGUOUS_POSITION', 'BAD_POSITION'],
  flow: ['INVALID_RESULT'], // duplicate flow, self loop, into a start or out of an end
  remove: [], unflow: [], fact: [], answer: [], resolve: [],
};

function randomOp(m: ProcessModel, r: ReturnType<typeof rng>): { kind: string; run: () => OpResult } | null {
  const nodes = [...m.events.map(e => e.id), ...m.steps.map(s => s.id), ...m.gateways.map(g => g.id)];
  const step = r.pick(m.steps);
  const kind = r.pick(['add', 'add', 'remove', 'move', 'move', 'flow', 'unflow', 'fact', 'answer', 'resolve'])!;
  switch (kind) {
    case 'add': return { kind, run: () => addStep(m, { step: { name: 'Generated step', taskType: 'user', roleIds: r.pick(m.roles) ? [r.pick(m.roles)!.id] : [] }, after: r.next() < 0.7 ? r.pick(nodes) : undefined }) };
    case 'remove': return step ? { kind, run: () => removeStep(m, { stepId: step.id }) } : null;
    case 'move': return step ? { kind, run: () => moveStep(m, { stepId: step.id, after: r.pick(nodes), before: r.next() < 0.3 ? r.pick(nodes) : undefined }) } : null;
    case 'flow': return { kind, run: () => addFlow(m, { from: r.pick(nodes)!, to: r.pick(nodes)!, label: r.next() < 0.5 ? 'Yes' : undefined }) };
    case 'unflow': { const f = r.pick(m.flows); return f ? { kind, run: () => removeFlow(m, { flowId: f.id }) } : null; }
    case 'fact': {
      if (!step) return null;
      const field = r.pick(['name', 'roleIds', 'systemIds', 'taskType', 'description'])!;
      const value = field === 'roleIds' ? m.roles.filter(() => r.next() < 0.3).map(x => x.id)
        : field === 'systemIds' ? m.systems.filter(() => r.next() < 0.3).map(x => x.id)
        : field === 'taskType' ? r.pick(['user', 'manual', 'service', 'business_rule', 'send', 'receive'])
        : `Edited ${Math.floor(r.next() * 1000)}`;
      return { kind, run: () => updateFact(m, { target: { kind: 'step', id: step.id, field }, value }) };
    }
    case 'answer': { const q = r.pick(m.openQuestions.filter(x => x.status === 'open')); return q ? { kind, run: () => answerQuestion(m, { questionId: q.id, answer: 'Confirmed in review.' }) } : null; }
    case 'resolve': { const c = r.pick(m.conflicts); return c ? { kind, run: () => resolveConflict(m, { conflictId: c.id, chosen: c.values[0].value, by: 'Reviewer', reason: 'Checked with the owner.' }) } : null; }
  }
  return null;
}

test('property: any sequence of operations keeps the model valid, and each patch reproduces the result', () => {
  const starts: [string, ProcessModel][] = [
    ['gold', gold()],
    ['v2', fromAssessV2(AP_INVOICE_EXCEPTION_V2_FIXTURE, { name: 'AP invoice exceptions' })],
  ];
  for (const [label, start] of starts) {
    for (let seed = 1; seed <= 12; seed++) {
      const r = rng(seed);
      let m = start;
      let applied = 0;
      const kinds = new Set<string>();
      for (let i = 0; i < 120; i++) {
        const op = randomOp(m, r);
        if (!op) continue;
        const before = canonicalJson(m);
        let result: OpResult;
        try {
          result = op.run();
        } catch (e) {
          assert.ok(e instanceof ModelOpError && ALLOWED_REJECTIONS[op.kind].includes(e.code), `${label} seed ${seed} step ${i}: ${op.kind} refused unexpectedly: ${String(e)}`);
          assert.equal(canonicalJson(m), before, 'a rejected operation must not change the model');
          continue;
        }
        const v = validateModel(result.model);
        assert.ok(v.valid, `${label} seed ${seed} step ${i}: ${JSON.stringify(v.issues.filter(x => x.severity === 'error'))}`);
        assert.ok(deepEqual(applyPatch(m, JSON.parse(JSON.stringify(result.patch))), result.model), `${label} seed ${seed} step ${i}: patch does not reproduce the result`);
        assert.equal(canonicalJson(m), before, 'operations must not mutate their input');
        m = result.model;
        applied++;
        kinds.add(op.kind);
      }
      assert.ok(applied > 30, `${label} seed ${seed}: only ${applied} operations applied`);
      for (const k of ['add', 'remove', 'move', 'flow', 'fact']) assert.ok(kinds.has(k), `${label} seed ${seed}: no successful ${k}`);
    }
  }
});

// ---------------------------------------------------------------- hashing and selectors

test('hashes ignore key order and detect only relevant change', () => {
  assert.equal(canonicalJson({ b: 1, a: [{ d: 1, c: 2 }] }), canonicalJson({ a: [{ c: 2, d: 1 }], b: 1 }));
  const m = gold();
  assert.equal(hashModel(m), hashModel(JSON.parse(JSON.stringify(m))));
  assert.match(hashModel(m), /^[0-9a-f]{16}$/);

  const sels = [{ section: 'steps' as const }, { element: { kind: 'system' as const, id: m.systems[0].id } }, { element: { kind: 'meta' as const, field: 'owner' } }];
  const recorded = hashSelections(m, sels);
  const edited = updateFact(m, { target: { kind: 'meta', field: 'owner' }, value: 'Karthik' }).model;
  assert.deepEqual(changedSelections(edited, sels, recorded), [sels[2]]);
  const renamed = updateFact(edited, { target: { kind: 'step', id: m.steps[0].id, field: 'name' }, value: 'Receive invoice' }).model;
  assert.deepEqual(changedSelections(renamed, sels, recorded), [sels[0], sels[2]]);
});

test('orderedSteps follows the flow from the start event', () => {
  const m = gold();
  const order = orderedSteps(m).map(s => s.id);
  assert.equal(order.length, m.steps.length);
  assert.equal(new Set(order).size, order.length);
  const startNext = outgoing(m, m.events.find(e => e.kind === 'start')!.id)[0].to;
  const firstStep = m.steps.some(s => s.id === startNext) ? startNext : outgoing(m, startNext).map(f => f.to).find(id => m.steps.some(s => s.id === id));
  assert.ok(order.indexOf(firstStep!) < 2);
});

// ---------------------------------------------------------------- V2 import

test('the AP V2 fixture converts to a valid model without invented content', () => {
  const m = fromAssessV2(AP_INVOICE_EXCEPTION_V2_FIXTURE, { name: 'AP invoice exceptions' });
  const v = validateModel(m);
  assert.equal(v.valid, true);
  assert.equal(m.steps.length, 9);
  assert.deepEqual(m.events, [], 'no start or end events are invented');
  assert.deepEqual(new Set(v.issues.map(i => i.code)), new Set(['NO_START', 'NO_END', 'GATEWAY_ONE_PATH']));
  const statuses = new Set([...m.steps, ...m.systems, ...m.rules, ...m.exceptions, ...m.gateways, ...m.systems.flatMap(s => s.access)].map(x => x.status));
  assert.deepEqual(statuses, new Set(['assumed']));
  assert.equal(m.systems.flatMap(s => s.access).some(a => a.access === 'confirmed'), false, 'unvalidated evidence never becomes confirmed access');
  assert.equal(m.meta.owner.status, 'unknown');
  assert.ok(gaps(m).some(g => g.kind === 'decision_one_path'));
  assert.ok(gaps(m).some(g => g.kind === 'step_without_role'));
});

test('roles, systems and rules can be added and removed with their references', () => {
  const m0 = gold();
  const r = addRole(m0, { name: 'AP Supervisor', kind: 'person_role' });
  assert.equal(r.model.roles.at(-1)?.status, 'user-confirmed');
  rejects(() => addRole(r.model, { name: 'ap supervisor', kind: 'team' }), 'DUPLICATE');
  rejects(() => addRole(r.model, { name: '  ', kind: 'team' }), 'EMPTY');
  const s = addSystem(r.model, { name: 'Coupa', kind: 'portal' });
  assert.deepEqual(s.model.systems.at(-1)?.access, []);
  assert.ok(gaps(s.model).some(g => g.kind === 'system_access_unknown' && g.target.id === s.systemId));
  const b = addRule(s.model, { name: 'Small invoices', condition: 'Amount below INR 1,000', action: 'Skip approval' });
  assert.equal(b.model.rules.at(-1)?.id, b.ruleId);

  const role = m0.roles.find(x => m0.steps.some(st => st.roleIds.includes(x.id)))!;
  const gone = removeElement(m0, { kind: 'role', id: role.id }).model;
  assert.ok(!gone.roles.some(x => x.id === role.id));
  assert.ok(gone.steps.every(st => !st.roleIds.includes(role.id)));
  assert.deepEqual(validateModel(gone).issues.filter(i => i.severity === 'error'), []);
  const sys = m0.systems[0];
  assert.ok(removeElement(m0, { kind: 'system', id: sys.id }).model.steps.every(st => !st.systemIds.includes(sys.id)));
  rejects(() => removeElement(m0, { kind: 'rule', id: 'nope' }), 'NOT_FOUND');
});

test('a tracked gap becomes a question, and answering it confirms the field', () => {
  let m = addStep(gold(), { step: { name: 'Check something new', taskType: 'manual' } }).model;
  const step = m.steps.at(-1)!;
  const gap = gaps(m).find(g => g.kind === 'step_without_role' && g.target.id === step.id)!;
  const q = addQuestion(m, { target: gap.target, question: gap.label });
  rejects(() => addQuestion(q.model, { target: gap.target, question: gap.label }), 'DUPLICATE');
  assert.equal(openItemCount(q.model), openItemCount(m) , 'a tracked gap is counted once');
  assert.ok(!untrackedGaps(q.model).some(g => g.target.id === step.id && g.kind === 'step_without_role'));
  const role = m.roles[0];
  m = answerQuestion(q.model, { questionId: q.questionId, answer: role.name, value: [role.id] }).model;
  const after = m.steps.find(s => s.id === step.id)!;
  assert.deepEqual(after.roleIds, [role.id]);
  assert.equal(after.status, 'user-confirmed');
  assert.equal(m.openQuestions.find(x => x.id === q.questionId)?.status, 'answered');
  assert.ok(!gaps(m).some(g => g.kind === 'step_without_role' && g.target.id === step.id));
});
