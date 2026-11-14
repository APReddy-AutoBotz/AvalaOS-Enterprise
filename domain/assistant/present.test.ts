// The answer's layout is decided by rule from what it cites: the chips, the one action, the questions next.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Answer, Fact } from './ask.ts';
import { answerAction, citedFacts, followUps, placeOf, STAGE_ORDER } from './present.ts';

const fact = (id: string, target: Fact['target']): Fact => ({ id, text: id, label: id, target });
const answer = (...facts: Fact[]): Answer => ({ missing: '', sentences: facts.map(f => ({ text: `About ${f.id}.`, quote: f.id, fact: f })) });
const verdict = fact('a:verdict', { kind: 'assessment' });
const rank = fact('a:rank:rpa', { kind: 'assessment' });
const step = fact('f:step:s1', { kind: 'step', stepId: 's1' });
const howTo = fact('h:to-be', { kind: 'platform', stage: 'documents' });
const item = fact('w:i1', { kind: 'item', itemId: 'i1', projectId: 'p1' });
const passage = fact('s:1', { kind: 'source', title: 'Call', ref: { sourceId: 'call', locator: {} as never, excerpt: 'x' } });

test('the sources are each fact cited, once, in the order first cited', () => {
  assert.deepEqual(citedFacts(answer(verdict, step, verdict, rank)).map(f => f.id), ['a:verdict', 'f:step:s1', 'a:rank:rpa']);
});

test('where a fact lives: a stage, the board, or nowhere to open', () => {
  assert.equal(placeOf(step.target), 'process');
  assert.equal(placeOf(howTo.target), 'documents');
  assert.equal(placeOf(item.target), 'board');
  assert.equal(placeOf(passage.target), null);
});

test('the one action opens where most of the facts live, and only a stage the workspace uses', () => {
  assert.deepEqual(answerAction(answer(step, verdict, rank), STAGE_ORDER), { label: 'Open the assessment', target: { kind: 'assessment' } });
  assert.deepEqual(answerAction(answer(howTo, step), STAGE_ORDER)?.label, 'Open the documents', 'a tie goes to the fact cited first');
  assert.equal(answerAction(answer(item), STAGE_ORDER)?.label, 'Open the board item');
  assert.equal(answerAction(answer(passage), STAGE_ORDER), null);
  // An organisation without documents: the action falls to the next place that is in use.
  assert.equal(answerAction(answer(howTo, step), ['sources', 'process', 'assessment'])?.label, 'Open the process steps');
});

test('two questions next, from where the facts live, never one already asked', () => {
  assert.deepEqual(followUps(answer(verdict), [], STAGE_ORDER), ['Which steps stay with people, and why?', 'What could rule-based RPA alone do across this process?']);
  assert.deepEqual(followUps(answer(verdict), ['which steps stay with people, and why?'], STAGE_ORDER), ['What could rule-based RPA alone do across this process?', 'What would change the recommendation?']);
  assert.deepEqual(followUps(answer(passage), [], STAGE_ORDER), ['What is still unknown about this process?', 'Why is this the recommended approach?']);
  assert.deepEqual(followUps({ sentences: [], missing: 'Not recorded.' }, ['What is still unknown about this process?'], STAGE_ORDER), ['Why is this the recommended approach?']);
});
