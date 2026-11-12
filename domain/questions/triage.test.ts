import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { ProcessModel } from '../processModel/types.ts';
import { addQuestion, closeQuestions, deferQuestion, routeException, setAccessStatus } from '../processModel/patch.ts';
import { assessProcess } from '../assess/process.ts';
import { triage } from './triage.ts';

const gold = (): ProcessModel => JSON.parse(readFileSync(new URL('../../eval/corpus/ap-invoice/expected.model.json', import.meta.url), 'utf8'));
const src = [{ sourceId: 'call-1', locator: {}, excerpt: 'q' }];

function messy(): ProcessModel {
  let m = gold();
  const sap = m.systems.find(s => /SAP/.test(s.name))!;
  // The shape a live extraction gives: one question per SAP transaction, a question about a figure that is known, broad questions.
  m.systems = m.systems.map(s => s.id !== sap.id ? s : { ...s, access: [...s.access, { method: 'ui', name: 'MIRO', operations: ['enter invoice'], access: 'unknown', status: 'stated', sources: src }, { method: 'ui', name: 'FB60', operations: ['post non-PO invoice'], access: 'unknown', status: 'stated', sources: src }] });
  m = addQuestion(m, { target: { kind: 'system', id: sap.id, field: 'access' }, question: 'Is MIRO available for use from SAP?' }).model;
  m = addQuestion(m, { target: { kind: 'system', id: sap.id, field: 'access' }, question: 'Is FB60 available for use from SAP?' }).model;
  const vol = m.meta.metrics.find(x => x.kind === 'volume')!;
  m = addQuestion(m, { target: { kind: 'metric', id: vol.id, field: 'value' }, question: 'Monthly invoice volume is unknown.' }).model;
  m = addQuestion(m, { target: { kind: 'meta' }, question: 'Is SAP configured with the same price tolerance as the AP policy?' }).model;
  m = addQuestion(m, { target: { kind: 'meta' }, question: 'Is the S/4 attachment API active in this landscape?' }).model;
  return m;
}

test('triage merges per-system questions, sets aside what the model already answers, and groups by what an answer changes', () => {
  const m = messy();
  const t = triage(m, assessProcess(m));
  const sap = m.systems.find(s => /SAP/.test(s.name))!;
  const sapItems = t.items.filter(i => i.target.kind === 'system' && i.target.id === sap.id);
  assert.equal(sapItems.length, 1, 'one question for all SAP interfaces');
  assert.equal(sapItems[0].kind, 'access');
  assert.ok(sapItems[0].interfaces!.some(x => /MIRO/.test(x.label)) && sapItems[0].interfaces!.some(x => /FB60/.test(x.label)));
  assert.ok(sapItems[0].questionIds.length >= 2, 'every stored SAP access question is covered');
  assert.equal(sapItems[0].owner, 'it');
  assert.ok(t.alreadyKnown.some(k => /Monthly invoice volume/.test(k.question)));
  assert.equal(t.items.find(i => /price tolerance/.test(i.question))!.owner, 'finance');
  const api = t.items.find(i => /attachment API/.test(i.question))!;
  assert.deepEqual([api.owner, api.group], ['it', 'decides']);
  assert.ok(t.items.length < t.raw, `${t.items.length} to answer of ${t.raw} raised`);
  const order = t.items.map(i => i.group);
  assert.deepEqual(order, [...order].sort((a, b) => ['decides', 'signoff', 'detail'].indexOf(a) - ['decides', 'signoff', 'detail'].indexOf(b)));
});

test('answering removes items: interfaces settled, questions closed, exceptions routed, deferred items go last with their owner', () => {
  let m = messy();
  const sap = m.systems.find(s => /SAP/.test(s.name))!;
  let t = triage(m, assessProcess(m));
  const item = t.items.find(i => i.key === `system:${sap.id}`)!;
  for (const x of item.interfaces!) m = setAccessStatus(m, { systemId: sap.id, index: x.index, access: 'confirmed' }).model;
  m = closeQuestions(m, { questionIds: item.questionIds, answer: 'All confirmed by the SAP team.' }).model;
  m = closeQuestions(m, { questionIds: t.alreadyKnown.map(k => k.questionId), answer: 'Already recorded in the model.' }).model;
  t = triage(m, assessProcess(m));
  assert.equal(t.items.some(i => i.key === `system:${sap.id}`), false);
  assert.equal(t.alreadyKnown.length, 0);

  const route = t.items.find(i => i.target.kind === 'exception');
  if (route) {
    m = routeException(m, { exceptionId: route.target.id!, roleId: m.roles[0].id }).model;
    assert.equal(triage(m, assessProcess(m)).items.some(i => i.key === route.key), false);
  }
  const tol = t.items.find(i => /price tolerance/.test(i.question))!;
  m = deferQuestion(m, { questionIds: tol.questionIds, owner: 'Finance Controller' }).model;
  const after = triage(m, assessProcess(m));
  const deferred = after.items.find(i => /price tolerance/.test(i.question))!;
  assert.deepEqual([deferred.deferred, deferred.assignedTo], [true, 'Finance Controller']);
  assert.equal(after.items.at(-1)!.deferred, true);
});

test('a gap without a stored question can be deferred: it is recorded as a question with its owner', () => {
  const m = gold();
  const t = triage(m, assessProcess(m));
  const gap = t.items.find(i => i.questionIds.length === 0)!;
  const next = deferQuestion(m, { questionIds: [], owner: 'AP Team Lead', gap: { target: gap.target, question: gap.question } }).model;
  const q = next.openQuestions.at(-1)!;
  assert.deepEqual([q.status, q.owner, q.question], ['deferred', 'AP Team Lead', gap.question]);
});

test('notes: questions and notes become segments; findings become proposals that fit each question, or are dropped', async () => {
  const { notesSegments, proposalsFrom } = await import('./notes.ts');
  const m = messy();
  const t = triage(m, assessProcess(m));
  const sap = t.items.find(i => i.kind === 'access')!;
  const free = t.items.find(i => /price tolerance/.test(i.question))!;
  const items = [sap, free];
  const { segments, ids } = notesSegments(m, items, 'MIRO can be used by the bot user.\n\nFB60 is not available to us.\n\nWe will align SAP to the 2% policy next month.');
  assert.deepEqual(segments.map(s => s.id), ['q:1', 'q:2', 'n:1', 'n:2', 'n:3']);
  assert.match(segments[0].text, /Interface \d+: UI: MIRO/);
  const miro = sap.interfaces!.find(x => /MIRO/.test(x.label))!.index, fb60 = sap.interfaces!.find(x => /FB60/.test(x.label))!.index;
  const f = (questionId: string, value: string, iface: string, segmentId: string) => ({ questionId, value, interface: iface, certainty: 'stated' as const, segmentId, excerpt: 'quoted' });
  const props = proposalsFrom(m, items, ids, [
    f('1', 'confirmed', String(miro), 'n:1'), f('1', 'confirmed_absent', String(fb60), 'n:2'), f('1', 'maybe', String(miro), 'n:1'),
    f('2', 'SAP will be aligned to the 2% policy next month.', '', 'n:3'), f('2', 'from the question', '', 'q:2'), f('9', 'x', '', 'n:1'),
  ]);
  assert.equal(props.length, 2);
  const p1 = props.find(p => p.itemKey === sap.key)!;
  assert.deepEqual([p1.answer.statuses![miro], p1.answer.statuses![fb60]], ['confirmed', 'confirmed_absent']);
  assert.match(p1.display, /MIRO: can be used; .*FB60: not available/);
  assert.equal(props.find(p => p.itemKey === free.key)!.answer.text, 'SAP will be aligned to the 2% policy next month.');
});

test('notes: a role answer must name a role of the process', async () => {
  const { notesSegments, proposalsFrom } = await import('./notes.ts');
  const m = gold();
  const t = triage(m, assessProcess(m));
  const route = t.items.find(i => i.kind === 'role');
  if (!route) return;
  const { ids } = notesSegments(m, [route], 'The AP Team Lead handles those.');
  const ok = proposalsFrom(m, [route], ids, [{ questionId: '1', value: 'AP Team Lead', interface: '', certainty: 'stated', segmentId: 'n:1', excerpt: 'The AP Team Lead handles those.' }]);
  assert.equal(ok[0].display, 'AP Team Lead');
  assert.equal(proposalsFrom(m, [route], ids, [{ questionId: '1', value: 'The night shift', interface: '', certainty: 'stated', segmentId: 'n:1', excerpt: 'x' }]).length, 0);
});
