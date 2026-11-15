import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { ProcessModel } from '../processModel/types.ts';
import { addQuestion } from '../processModel/patch.ts';
import { assessProcess } from '../assess/process.ts';
import { triage } from '../questions/triage.ts';
import { decisive, planQuestions } from '../questions/firstList.ts';
import type { Suggestion } from './suggest.ts';
import { addLook, AUTO_LOOK, foundFor, foundKeys, lookSummary, sourcesKey, toLookUp } from './sourceLook.ts';

const gold = (): ProcessModel => JSON.parse(readFileSync(new URL('../../eval/corpus/ap-invoice/expected.model.json', import.meta.url), 'utf8'));
function many(): ProcessModel {
  let m = gold();
  for (let n = 1; n <= 40; n++) m = addQuestion(m, { target: { kind: 'meta' }, question: `Question number ${n} about topic ${'abcdefghijklmnopqrstuvwxyz'[n % 26]}${n} of the process?` }).model;
  return m;
}
const answer = (itemKey: string, display = 'x'): Suggestion => ({
  key: `answer:${itemKey}:${display}`, kind: 'answer', title: 't', why: 'w', quote: { text: 'q', source: 's' }, willDo: 'd', needs: 'edit_process',
  target: { kind: 'answer', itemKey, proposal: { itemKey, question: 'q', display, quote: 'q', certainty: 'stated', answer: { text: display } }, source: 's' },
});

test('a look stays within its limit and asks about the decisive questions first', () => {
  const m = many();
  const t = triage(m, assessProcess(m));
  const key = sourcesKey([{ id: 'b' }, { id: 'a' }, { id: 'c', archived: true }]);
  assert.equal(key, 'a,b');
  const batches = toLookUp(t, null, key);
  assert.ok(batches.length <= AUTO_LOOK.batches && batches.every(b => b.length <= AUTO_LOOK.perBatch));
  assert.equal(batches.flat().length, Math.min(t.items.filter(i => !i.deferred).length, AUTO_LOOK.perBatch * AUTO_LOOK.batches));
  const flat = batches.flat();
  const firstOther = flat.findIndex(i => !decisive(i));
  if (firstOther >= 0) assert.ok(flat.slice(firstOther).every(i => !decisive(i)), 'decisive questions come before the rest');
});

test('a question is looked up once per set of sources; a new source looks again', () => {
  const m = many();
  const t = triage(m, assessProcess(m));
  const key = 'a,b';
  let look = null;
  for (const items of toLookUp(t, null, key)) look = addLook(look, key, { items, found: [], passages: 40, tokens: 15000 });
  assert.equal(look!.calls, Math.min(AUTO_LOOK.batches, Math.ceil(t.items.length / AUTO_LOOK.perBatch)));
  const left = t.items.length - look!.looked.length;
  // The next look takes the questions not yet looked up; answering one question starts none.
  assert.equal(toLookUp(t, look, key).flat().length, Math.min(left, AUTO_LOOK.perBatch * AUTO_LOOK.batches));
  const all = { ...look!, looked: t.items.map(i => i.key) };
  assert.equal(toLookUp(t, all, key).length, 0);
  assert.ok(toLookUp(t, all, 'a,b,c').length > 0, 'a new source: look again');
  assert.match(lookSummary(look, 0)!, /looked for \d+ answers in your sources \(\d+ passages read with AI, about \d+ thousand tokens\) and found 0/);
  assert.equal(lookSummary(null, 0), null);
});

test('answers found are offered while their question is open and not dismissed, and take it out of the first list', () => {
  const m = many();
  const t = triage(m, assessProcess(m));
  const [a, b] = t.items;
  let look = addLook(null, 'k', { items: [a, b], found: [answer(a.key), answer(b.key)], passages: 10, tokens: 0 });
  assert.deepEqual(foundFor(look, t).map(s => s.target.kind === 'answer' && s.target.itemKey), [a.key, b.key]);
  assert.deepEqual(foundFor(look, t, [answer(b.key).key]).length, 1, 'dismissed');
  const gone = triage({ ...m, openQuestions: m.openQuestions.filter(q => !a.questionIds.includes(q.id)) }, assessProcess(m));
  assert.ok(!foundFor(look, gone).some(s => s.target.kind === 'answer' && s.target.itemKey === a.key), 'answered: no longer offered');
  const plan = planQuestions(t, m, { found: foundKeys(foundFor(look, t)) });
  assert.deepEqual(plan.found.map(i => i.key).sort(), [a.key, b.key].sort());
  // Looking at the same question again replaces its earlier answer; other sources start afresh.
  look = addLook(look, 'k', { items: [a], found: [answer(a.key, 'y')], passages: 5, tokens: 0 });
  assert.deepEqual(look.found.map(s => s.key).sort(), [answer(a.key, 'y').key, answer(b.key).key].sort());
  assert.equal(addLook(look, 'other', { items: [], found: [], passages: 0, tokens: 0 }).found.length, 0);
});
