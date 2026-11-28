// Package B, pull request 1: where a session stands, and its closing summary.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { ProcessModel } from '../processModel/types.ts';
import { emptyModel } from '../processModel/empty.ts';
import { assessProcess } from '../assess/process.ts';
import { deferQuestion, keepWanted, setPurpose } from '../processModel/patch.ts';
import { deciding, sessionDone, sessionSummary } from './summary.ts';
import { shapeCards } from './checklist.ts';
import { triage } from '../questions/triage.ts';

const gold: ProcessModel = JSON.parse(readFileSync(new URL('../../eval/corpus/ap-invoice/expected.model.json', import.meta.url), 'utf8'));
const at = '2026-11-23T10:00:00.000Z';

test('a session ends when the shape is settled and nothing that decides is open, answered or left with someone', () => {
  const a = assessProcess(gold);
  assert.ok(deciding(gold, a) > 0);
  assert.equal(sessionDone(gold, a), false);
  // Every decisive question left with someone, and the shape settled: done.
  const decisive = ['q-gr-api', 'q-invoice-api', 'q-attach-api', 'q-servicenow'];
  let m = deferQuestion(gold, { questionIds: decisive, owner: 'IT' }).model;
  // The office scanner's question is still open, but it is a device's: Detail, so it does not keep the session going (owner, 24 November 2026).
  assert.equal(deciding(m, assessProcess(m)), 0);
  assert.ok(triage(m, assessProcess(m)).items.some(i => i.key === 'system:sys-scanner' && i.group === 'detail'));
  assert.equal(sessionDone(m, assessProcess(m)), shapeCards(m).length === 0);
  assert.equal(sessionDone(emptyModel('x'), assessProcess(emptyModel('x'))), false, 'nothing known about its shape');
  // Documented as it is: nothing decides; it ends when the shape is settled.
  const asIs = setPurpose(gold, { value: 'as_is', by: 'u1', at }).model;
  assert.equal(deciding(asIs, assessProcess(asIs)), 0);
  assert.equal(sessionDone(asIs, assessProcess(asIs)), shapeCards(asIs).length === 0);
  m = keepWanted(m, { statement: 'Invoices should be read automatically.' }).model;
  const s = sessionSummary(m, assessProcess(m), 4);
  assert.equal(s.line, `Recorded: 4 answers. What you want to change: 1. Conflicts to resolve: ${gold.conflicts.filter(c => !c.resolution).length}. Still open: ${s.open}.`);
  assert.match(s.closing, /^You stopped with \d+ questions? still to ask\. Carry on whenever you like\.$/);
  assert.equal(sessionSummary(m, assessProcess(m), 1).line.startsWith('Recorded: 1 answer.'), true);
  // Words kept to read later are counted (review, 24 November 2026).
  const later = sessionSummary(m, assessProcess(m), 4, 2);
  assert.equal(later.later, 2);
  assert.ok(later.line.endsWith(' Kept to read later: 2.'));
  assert.equal(s.line.includes('Kept to read later'), false, 'said only when there are some');
});

// ---- The summary counts what the queue asks (review, 25 November 2026) ---------------------------------------------

import { askedParts, discoveryQueue } from './queue.ts';
import { cardItem, leaveWith, notApplicable } from './flow.ts';
import { validateModel } from '../processModel/validate.ts';

test('every card answered, left with someone or not applicable: done, and the closing sentence for done', () => {
  // The sample without its end, with the gap's own question stored for one step, as a first reading leaves it.
  let m: ProcessModel = structuredClone(gold);
  const ends = new Set(m.events.filter(e => e.kind === 'end').map(e => e.id));
  m.events = m.events.filter(e => !ends.has(e.id));
  m.flows = m.flows.filter(f => !ends.has(f.from) && !ends.has(f.to));
  m.openQuestions.push({ id: 'q-14', target: { kind: 'step', id: 's-match', field: 'roleIds' }, question: 'Who does "Three-way match"?', whyItMatters: '', owner: null, status: 'open' });
  const a0 = assessProcess(m);
  assert.ok(askedParts(m, triage(m, a0)).shape.length >= 3, 'shape cards to start with');
  assert.equal(sessionDone(m, a0), false);
  assert.match(sessionSummary(m, a0, 0).closing, /^You stopped with \d+ questions still to ask\./);

  // One card at a time, as the queue asks them: those of the shape and those that decide, in turn not applicable and left.
  for (let n = 0; n < 60; n++) {
    const a = assessProcess(m);
    const t = triage(m, a);
    const parts = askedParts(m, t);
    if (!parts.shape.length && deciding(m, a) === 0) break;
    const card = parts.shape[0] ?? discoveryQueue({ model: m, assessment: a, asksPurpose: false, triage: t }).find(c => c.group !== 'start' && c.group !== 'conflict' && c.group !== 'shape')!;
    const item = cardItem(card, t);
    const e = n % 2 ? leaveWith(card, item, 'Rahul in AP')! : notApplicable(card, item);
    m = e.op(m).model;
    assert.ok(validateModel(m).valid, `still a valid model after ${card.key}`);
  }
  const a = assessProcess(m);
  assert.equal(askedParts(m, triage(m, a)).shape.length, 0, 'no shape card asked');
  assert.equal(deciding(m, a), 0);
  assert.equal(sessionDone(m, a), true);
  const s = sessionSummary(m, a, 0);
  assert.equal(s.done, true);
  assert.equal(s.closing, 'Every question that could change the recommendation is answered, left with someone, or not applicable.');
  // A closed gap is still in the model, so counting every shape card would have said there was more to ask.
  assert.ok(shapeCards(m).length > 0);
});

// Owner's walk, 28 November 2026: the summary's count and the card's "Question 1 of N" must not read as a contradiction.
test('"still to ask" counts the cards the screen asks, and says how many of them must be settled', async () => {
  const { stillToAskLine } = await import('./summary.ts');
  const gold: ProcessModel = JSON.parse(readFileSync(new URL('../../eval/corpus/ap-invoice/expected.model.json', import.meta.url), 'utf8'));
  const a = assessProcess(gold);
  const queue = discoveryQueue({ model: gold, assessment: a, asksPurpose: true });
  const must = queue.filter(c => ['shape', 'decides', 'settles'].includes(c.group)).length;
  assert.ok(queue.length > must && must > 0);
  const s = sessionSummary(gold, a, 0, 0, queue);
  assert.equal(s.closing, `You stopped with ${queue.length} questions still to ask; ${must} of them are about the shape of the process or could change the recommendation. Carry on whenever you like.`);
  // Every card one the session must settle: one count.
  const onlyMust = queue.filter(c => ['shape', 'decides'].includes(c.group));
  assert.equal(stillToAskLine(gold, onlyMust), `You stopped with ${onlyMust.length} questions still to ask. Carry on whenever you like.`);
  assert.equal(stillToAskLine(gold, queue.filter(c => c.group === 'input').slice(0, 1)), 'You stopped with 1 question still to ask; it is not needed to end the session. Carry on whenever you like.');
  assert.equal(stillToAskLine(gold, queue.filter(c => c.group === 'input').slice(0, 2)), 'You stopped with 2 questions still to ask; none of them is needed to end the session. Carry on whenever you like.');
  // Without the queue, as the released screen calls it, the line is unchanged.
  assert.match(sessionSummary(gold, a, 0).closing, /^You stopped with \d+ questions? still to ask\. Carry on/);
});
