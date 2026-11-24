// Package B, pull request 1: the "Discovery answers" source, and an answer against a value a person confirmed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { ProcessModel, SourceRef } from '../processModel/types.ts';
import { addStep, addRole, updateFact } from '../processModel/patch.ts';
import { validateModel } from '../processModel/validate.ts';
import { answeredQuestion, answersKey, answersSource, answerAgainstConfirmed, ANSWERS_KIND, confirmedValue, type WaitingAnswer } from './answers.ts';

const gold: ProcessModel = JSON.parse(readFileSync(new URL('../../eval/corpus/ap-invoice/expected.model.json', import.meta.url), 'utf8'));
const at = '2026-11-23T10:00:00.000Z';

const waiting: WaitingAnswer[] = [
  { words: 'By email, on Mondays.', question: 'How do invoices arrive, and when?', at },
  { words: '   ', question: 'What starts the work?', at },
  { words: 'The clerk checks the totals, then posts it in SAP. Then the controller approves anything over 10,000.', question: 'What are the steps of the work, in order?', at },
  { words: 'When it is paid', question: 'When is a case finished: what is the last thing that happens?', at },
];

test('one passage per waiting answer with words: the person\'s words alone, the question as its place', () => {
  const src = answersSource(waiting, ['own-1', 'ans-1'], '23 Nov 2026')!;
  assert.equal(src.key, 'ans-2', 'the key Closing the gaps gives a person\'s notes, the first unused');
  assert.equal(src.title, 'Discovery answers, 23 Nov 2026');
  assert.equal(src.kind, ANSWERS_KIND);
  assert.equal(src.segments.length, 3, 'an answer with no words has no passage');
  const given = waiting.filter(a => a.words.trim());
  src.segments.forEach((s, i) => {
    assert.equal(s.id, `ans-2:${i + 1}`);
    assert.equal(s.sourceId, 'ans-2');
    assert.equal(s.text, given[i]!.words.trim());
    assert.equal(s.locator.heading, `Answer to: ${given[i]!.question}`);
    assert.equal(s.locator.lineStart, i + 1);
    assert.equal(answeredQuestion(s), given[i]!.question);
    // No passage's text contains its question, so a quote is always the person's words.
    assert.ok(!s.text.includes(given[i]!.question));
    assert.ok(!s.text.includes('Answer to:'));
  });
  assert.equal(answersSource([{ words: '', question: 'q', at }], [], 'x'), null);
  assert.equal(answersKey([]), 'ans-1');
  assert.equal(answeredQuestion({ locator: { heading: 'Section 6' } }), null);
});

const said = (excerpt: string): SourceRef => ({ sourceId: 'ans-3', locator: { heading: 'Answer to: What is the process for?', lineStart: 1 }, excerpt });

test('an answer that contradicts a value a person confirmed raises a conflict; the confirmed value stays', () => {
  const objective = { kind: 'meta' as const, field: 'objective' };
  const m = updateFact(gold, { target: objective, value: 'Pay suppliers on time.' }).model;
  assert.equal(m.meta.objective.status, 'user-confirmed');
  assert.ok(m.meta.objective.sources.length > 0, 'it keeps the sources it had');
  assert.equal(confirmedValue(m, objective)!.value, 'Pay suppliers on time.');
  const write = (x: ProcessModel) => updateFact(x, { target: objective, value: 'Post every invoice within five days.' });
  const out = answerAgainstConfirmed(m, { target: objective, label: 'Process objective', said: { value: 'Post every invoice within five days.', quote: said('post every invoice within five days') }, write });
  assert.equal(out.kind, 'conflict');
  assert.match(out.line!, /^You confirmed earlier: Pay suppliers on time\. Your answer says: Post every invoice within five days\. Saving keeps Pay suppliers on time and records the difference as a conflict to resolve on the Process stage\.$/);
  const r = out.op(m);
  assert.equal(r.model.meta.objective.value, 'Pay suppliers on time.');
  const c = r.model.conflicts.at(-1)!;
  assert.equal(c.resolution, null);
  assert.deepEqual(c.values.map(v => v.value), ['Pay suppliers on time.', 'Post every invoice within five days.']);
  assert.equal(c.values[1]!.sources[0]!.excerpt, 'post every invoice within five days');
  assert.ok(validateModel(r.model).valid);
  // The same answer, or no confirmed value: written as answers are today.
  assert.equal(answerAgainstConfirmed(m, { target: objective, label: 'x', said: { value: 'pay suppliers on time', quote: said('pay suppliers on time') }, write }).kind, 'write');
  assert.equal(gold.meta.objective.status, 'inferred');
  assert.equal(answerAgainstConfirmed(gold, { target: objective, label: 'x', said: { value: 'Something else', quote: said('something else') }, write }).kind, 'write');
});

test('a confirmation with no quote of its own cannot stand in a conflict: the difference is asked, raised by the answer\'s words', () => {
  const role = addRole(gold, { name: 'Night clerk', kind: 'person_role' });
  const added = addStep(role.model, { step: { name: 'Sort the post', taskType: 'manual', roleIds: [role.roleId] } });
  const target = { kind: 'step' as const, id: added.stepId, field: 'roleIds' };
  const cur = confirmedValue(added.model, target)!;
  assert.deepEqual(cur, { value: 'Night clerk', sources: [] });
  const out = answerAgainstConfirmed(added.model, { target, label: 'Who does "Sort the post"', said: { value: 'AP clerk', quote: said('the AP clerk sorts it') }, write: x => updateFact(x, { target, value: ['r-clerk'] }) });
  assert.equal(out.kind, 'question');
  const r = out.op(added.model);
  assert.deepEqual(r.model.steps.find(s => s.id === added.stepId)!.roleIds, [role.roleId], 'the confirmed value stays');
  const q = r.model.openQuestions.at(-1)!;
  assert.equal(q.status, 'open');
  assert.match(q.question, /you confirmed "Night clerk"; an answer says "AP clerk"\. Which is right\?$/);
  assert.deepEqual(q.raisedBy, { excerpt: 'the AP clerk sorts it', sourceId: 'ans-3', locator: { heading: 'Answer to: What is the process for?', lineStart: 1 } });
  assert.ok(validateModel(r.model).valid);
});
