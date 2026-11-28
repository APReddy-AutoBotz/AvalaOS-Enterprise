// Package B, pull request 1: the cards a discovery session asks by rule, and their order.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { ProcessModel } from '../processModel/types.ts';
import { emptyModel } from '../processModel/empty.ts';
import { assessProcess } from '../assess/process.ts';
import { addQuestion, deferQuestion, setBriefFact, setPurpose } from '../processModel/patch.ts';
import { hasOrigin, makeCard, originLine, type Card } from './card.ts';
import { conflictCards, shapeCards, startCards } from './checklist.ts';
import { discoveryQueue, triageCard } from './queue.ts';
import { triage } from '../questions/triage.ts';

const gold: ProcessModel = JSON.parse(readFileSync(new URL('../../eval/corpus/ap-invoice/expected.model.json', import.meta.url), 'utf8'));
const at = '2026-11-23T10:00:00.000Z';
const queue = (m: ProcessModel, extra: Partial<Parameters<typeof discoveryQueue>[0]> = {}) => discoveryQueue({ model: m, assessment: assessProcess(m), asksPurpose: true, ...extra });

/** Every card shown has where it came from (a quote, a named gap or a conflict) and a target. */
const sound = (cards: Card[]) => {
  assert.ok(cards.length > 0);
  for (const c of cards) {
    assert.ok(hasOrigin(c.origin), `${c.key} says where it came from`);
    // A target, or (a plain question, with no card of its own) the stored question it stands for, by key.
    assert.ok((c.target.kind === 'meta' ? c.target.field : c.target.id) || (c.answer === 'words' && c.itemKey), `${c.key} has a target`);
    assert.ok(c.question.length > 0 && c.question.length <= 200, `${c.key} has a question`);
    assert.ok(originLine(c.origin).length > 0);
  }
};

test('a card needs a quote, a gap or a conflict, and a target: otherwise none is built', () => {
  const base = { key: 'k', group: 'said' as const, question: 'Which application do you post in?', why: 'w', updates: [], answer: 'words' as const };
  const target = { kind: 'step' as const, id: 's-1', field: 'systemIds' };
  assert.ok(makeCard({ ...base, origin: { kind: 'quote', quote: { excerpt: 'I post it', sourceId: 'own-1' } }, target }));
  assert.ok(makeCard({ ...base, origin: { kind: 'quote', quote: { excerpt: 'By email', answerTo: 'How do invoices arrive?' } }, target }));
  assert.equal(makeCard({ ...base, origin: { kind: 'quote', quote: { excerpt: '  ', sourceId: 'own-1' } }, target }), null);
  assert.equal(makeCard({ ...base, origin: { kind: 'quote', quote: { excerpt: 'I post it' } }, target }), null, 'a quote names its source or its question');
  assert.equal(makeCard({ ...base, origin: { kind: 'gap', gap: '' }, target }), null);
  assert.equal(makeCard({ ...base, origin: { kind: 'conflict', conflictId: 'c', values: [{ value: 'A', quote: { sourceId: 's', locator: {}, excerpt: 'A' } }] }, target }), null);
  assert.equal(makeCard({ ...base, origin: { kind: 'gap', gap: 'Missing.' }, target: { kind: 'step' } }), null, 'no target');
  assert.equal(makeCard({ ...base, origin: { kind: 'gap', gap: 'Missing.' }, target: { kind: 'meta' } }), null, 'no target');
  assert.equal(makeCard({ ...base, question: 'x'.repeat(201), origin: { kind: 'gap', gap: 'Missing.' }, target }), null);
});

test('a new process with nothing in it: what is wanted, whether it is done today, then its shape', () => {
  const m = emptyModel('Supplier onboarding');
  const cards = queue(m);
  sound(cards);
  assert.deepEqual(cards.slice(0, 5).map(c => c.key), ['start:purpose', 'start:doneToday', 'shape:steps', 'shape:start', 'shape:end']);
  // Then what sign-off needs (the objective, the owner); no input card before there is a step to assess.
  assert.deepEqual(cards.slice(5).map(c => c.group), ['signoff', 'signoff']);
  assert.equal(cards[0]!.answer, 'choose');
  assert.deepEqual(cards[0]!.choices!.map(c => c[0]), ['assess', 'as_is', 'decided']);
  assert.equal(cards[2]!.answer, 'waits', 'no edit adds a step from an answer: it waits for the update of the draft');
  assert.equal(originLine(cards[3]!.origin), 'Missing: No step says what starts the work.');
  // Answered, they are not asked; where the set-up does not ask what is wanted, it is not asked.
  let a = setPurpose(m, { value: 'assess', by: 'u1', at }).model;
  a = setBriefFact(a, { fact: 'doneToday', value: 'yes' }).model;
  assert.deepEqual(startCards(a, { asksPurpose: true }), []);
  assert.deepEqual(startCards(m, { asksPurpose: false }).map(c => c.key), ['start:doneToday']);
});

test('the sample: who does a step and in which application, in step order; each open conflict with both quotes', () => {
  const shape = shapeCards(gold);
  sound(shape);
  assert.ok(shape.every(c => c.group === 'shape' && c.itemKey === c.key && c.answer === 'words'), 'the sample has roles and applications to choose from');
  assert.ok(shape.some(c => c.key === 'gap:step_without_role:step:s-match:roleIds'));
  const conflicts = conflictCards(gold);
  assert.equal(conflicts.length, gold.conflicts.filter(c => !c.resolution).length);
  sound(conflicts);
  for (const c of conflicts) assert.equal(c.origin.kind === 'conflict' && c.origin.values.length, gold.conflicts.find(x => `conflict:${x.id}` === c.key)!.values.length);
});

test('the order: shape, conflicts, what could change the recommendation, said, inputs, sign-off; the same inputs give the same order', () => {
  const cards = queue(gold);
  sound(cards);
  const rank = { start: 0, shape: 1, conflict: 2, decides: 3, settles: 3, said: 4, input: 5, signoff: 6 } as const;
  const groups = cards.map(c => rank[c.group]);
  assert.deepEqual(groups, [...groups].sort((a, b) => a - b));
  assert.ok(cards.some(c => c.group === 'decides') && cards.some(c => c.group === 'input') && cards.some(c => c.group === 'signoff'));
  // A shape question the triage also lists is asked once.
  assert.equal(cards.filter(c => c.itemKey === 'gap:step_without_role:step:s-match:roleIds').length, 1);
  assert.deepEqual(queue(gold).map(c => c.key), cards.map(c => c.key));
  assert.deepEqual(queue(JSON.parse(JSON.stringify(gold))).map(c => c.key), cards.map(c => c.key));
  // Skipped cards go to the end, in the order skipped.
  const [a, b] = [cards[0]!.key, cards[3]!.key];
  const later = queue(gold, { skipped: [b, a] }).map(c => c.key);
  assert.deepEqual(later.slice(-2), [b, a]);
  assert.equal(later.length, cards.length);
});

test('questions left with someone are not asked; a question a session raised shows its words', () => {
  const m = deferQuestion(gold, { questionIds: ['q-servicenow'], owner: 'ServiceNow platform owner' }).model;
  assert.ok(!queue(m).some(c => c.itemKey === 'system:sys-servicenow'));
  const raised = addQuestion(gold, { target: { kind: 'step', id: 's-fb60', field: 'rule' }, question: 'Who approves a non-PO invoice above the limit?', raisedBy: { excerpt: 'anything big goes to the controller', sourceId: 'own-1', locator: { lineStart: 3 } } });
  const item = triage(raised.model, assessProcess(raised.model)).items.find(i => i.questionIds.includes(raised.questionId))!;
  const card = triageCard(item, raised.model)!;
  assert.equal(card.origin.kind, 'quote');
  assert.equal(originLine(card.origin), 'You said: “anything big goes to the controller”');
  assert.equal(card.group, 'said');
});

test('a process documented as it is gets no input card and no question about an application\'s access', () => {
  const m = setPurpose(gold, { value: 'as_is', by: 'u1', at }).model;
  const cards = queue(m);
  sound(cards);
  assert.ok(!cards.some(c => c.group === 'input'));
  assert.ok(!cards.some(c => c.target.kind === 'system' && c.target.field === 'access'));
});

test('an application with no way in recorded is a card to choose from, never plain words', () => {
  const card = queue(gold).find(c => c.itemKey === 'system:sys-scanner')!;
  assert.equal(card.answer, 'choose');
  assert.deepEqual(card.choices, [['0', 'API'], ['1', 'Screens'], ['2', 'File'], ['3', 'Database'], ['4', 'Event'], ['5', 'Email'], ['none', 'No way in: a person does this']]);
  assert.equal(originLine(card.origin), 'Missing: Not confirmed yet: how the automation can use Office scanner (Pune).');
  // An application whose ways in are listed but unknown is still read from words.
  assert.equal(queue(gold).find(c => c.itemKey === 'system:sys-servicenow')!.answer, 'words');
});

// Owner's walk, 28 November 2026: "About how many cases …?" left with a named person was asked again after a reload.
test('an input card left with someone, or not applicable, is not asked again; the others still are', async () => {
  const { leaveWith, notApplicable } = await import('./flow.ts');
  const cards = queue(gold).filter(c => c.group === 'input');
  const time = cards.find(c => c.key === 'input:time')!, change = cards.find(c => c.key === 'input:change')!;
  assert.ok(time && change);
  const left = leaveWith(time, undefined, 'Priya in finance')!.op(gold).model;
  assert.equal(left.openQuestions.at(-1)!.status, 'deferred');
  const after = queue(left).map(c => c.key);
  assert.ok(!after.includes('input:time'));
  assert.ok(after.includes('input:change'));
  const closed = notApplicable(change, undefined).op(left).model;
  assert.ok(!queue(closed).map(c => c.key).includes('input:change'));
});

test('an open question with no card of its own joins the queue as a plain question, in its group\'s place', async () => {
  const { plainCard, askedParts } = await import('./queue.ts');
  // A reading's questions about the process as a whole (target meta, no field; preview walk, 28 November 2026): one
  // that could change the recommendation, one needed for sign-off.
  let m = addQuestion(gold, { target: { kind: 'meta' }, question: 'Which system holds the vendor master today?', whyItMatters: 'w' }).model;
  m = addQuestion(m, { target: { kind: 'meta' }, question: 'How are duplicate invoices noticed today?', whyItMatters: 'w' }).model;
  const a = assessProcess(m);
  const t = triage(m, a);
  const said = makeCard({ key: 'said:x', group: 'said', origin: { kind: 'quote', quote: { sourceId: 's', excerpt: 'We also chase late approvals.' } }, question: 'Who chases late approvals?', why: 'w', target: { kind: 'meta', field: 'flow' }, updates: [], answer: 'words' })!;
  const queue = discoveryQueue({ model: m, assessment: a, asksPurpose: true, raised: [said] });
  const keyOf = (q: string) => `item:${t.items.find(i => i.question === q)!.key}`;
  const decides = queue.findIndex(c => c.key === keyOf('Which system holds the vendor master today?'));
  const signoff = queue.findIndex(c => c.key === keyOf('How are duplicate invoices noticed today?'));
  assert.ok(decides >= 0 && signoff >= 0, 'both are asked');
  const card = queue[decides]!;
  assert.equal(card.group, 'decides');
  assert.equal(card.answer, 'words');
  assert.deepEqual(card.target, { kind: 'meta' }, 'the question\'s own target');
  assert.equal(card.itemKey, t.items.find(i => i.question === 'Which system holds the vendor master today?')!.key);
  assert.equal(queue[signoff]!.group, 'signoff');
  // In its group's place: after the conflicts and the other questions that could change the recommendation, before
  // what was said; the one for sign-off with sign-off.
  const idx = (k: string) => queue.findIndex(c => c.key === k);
  assert.ok(queue.slice(0, decides).every(c => ['start', 'shape', 'conflict', 'decides', 'settles'].includes(c.group)));
  assert.ok(decides < idx('said:x') && idx('said:x') < signoff);
  assert.ok(queue.slice(signoff + 1).every(c => c.group === 'signoff'));
  // Every question the session asks is now on a card: the queue asks what askedParts counts.
  const onCards = new Set(queue.map(c => c.itemKey).filter(Boolean));
  assert.ok(askedParts(m, t).items.every(i => onCards.has(i.key)), 'nothing asked without a card');
  // Closed or left with someone: not asked.
  const id = (q: string) => m.openQuestions.find(x => x.question === q)!.id;
  const left = deferQuestion(m, { questionIds: [id('Which system holds the vendor master today?')], owner: 'IT' }).model;
  assert.ok(!discoveryQueue({ model: left, assessment: assessProcess(left), asksPurpose: true }).some(c => c.question === 'Which system holds the vendor master today?'));
  // A choice, or an application's ways in, is never a plain question: it has its own card.
  for (const i of t.items.filter(x => x.kind === 'choice' || x.kind === 'ways')) assert.equal(plainCard(i, m), null);
  // Skipped, a plain question goes last like any card.
  const skipped = discoveryQueue({ model: m, assessment: a, asksPurpose: true, skipped: [card.key] });
  assert.equal(skipped.at(-1)!.key, card.key);
});

// Owner's walk, 28 November 2026: once every card had been skipped once, Skip did nothing.
test('Skip on a card skipped before moves it to the end again: skip every card, then the first again, and the second leads', async () => {
  const { skip, emptyState } = await import('./session.ts');
  const keys = queue(gold).map(c => c.key);
  assert.ok(keys.length > 3);
  let s = emptyState();
  for (const k of keys) s = skip(k)(s);
  const after = (st: typeof s) => discoveryQueue({ model: gold, assessment: assessProcess(gold), asksPurpose: true, skipped: st.skipped }).map(c => c.key);
  assert.deepEqual(after(s), keys, 'all skipped once: the same order');
  s = skip(keys[0]!)(s);
  assert.deepEqual(after(s), [...keys.slice(1), keys[0]]);
  // Pressing Skip again and again walks through every card, never holding one.
  const seen = new Set<string>();
  for (let i = 0; i < keys.length; i++) { const first = after(s)[0]!; seen.add(first); s = skip(first)(s); }
  assert.equal(seen.size, keys.length);
  assert.equal(s.skipped.length, keys.length, 'each key once');
});
