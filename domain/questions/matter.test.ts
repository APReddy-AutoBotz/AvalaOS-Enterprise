import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { ProcessModel } from '../processModel/types.ts';
import { asksOnlyFor } from './matter.ts';
import { triage } from './triage.ts';
import { planQuestions } from './firstList.ts';
import { buildAnswer } from './answer.ts';
import { assessProcess } from '../assess/process.ts';
import { emptyDecisions } from '../assess/decisions.ts';
import { buildPdd } from '../docs/pdd.ts';
import { buildBrd } from '../docs/brd.ts';
import { openItemCount } from '../processModel/selectors.ts';

const gold = (): ProcessModel => JSON.parse(readFileSync(new URL('../../eval/corpus/ap-invoice/expected.model.json', import.meta.url), 'utf8'));
/** The sample with its objective not known, and a question read from the sources asking for it in its own words. */
function noObjective(question = 'Process objective is unknown') {
  const m = gold();
  m.meta.objective = { value: null, status: 'unknown', sources: [] } as unknown as ProcessModel['meta']['objective'];
  m.openQuestions.push({ id: 'q-objective-free', target: { kind: 'meta' }, question, whyItMatters: '', owner: null, status: 'open', matchKeywords: [] } as ProcessModel['openQuestions'][number]);
  return m;
}
const doc = (m: ProcessModel, build = buildPdd) => build({ model: m, assessment: assessProcess(m, {}), decisions: emptyDecisions(), sources: [], revision: { label: 'Working draft', state: 'working', date: '2026-11-17' } });

test('a question that asks only for the objective, or only for the owner, is the same matter; anything more stays apart', () => {
  for (const q of ['Process objective is unknown.', 'What is the objective of the process?', 'The objective of the process is not stated.', 'The business objective of the process is not stated.', "What is the process's purpose?", 'Goal of this process unclear'])
    assert.equal(asksOnlyFor(q), 'objective', q);
  for (const q of ['Process owner is unknown.', 'Who owns the process?', 'Who is the process owner?', 'The owner of this process is not named.'])
    assert.equal(asksOnlyFor(q), 'owner', q);
  // When unsure, both stay: two things at once, another objective, another owner, other words.
  for (const q of ['What is the objective and who owns the process?', 'What is the objective of the matching step?', 'Who owns the vendor master data?', 'Is the objective measured by cycle time?', 'Objectives for the automation programme'])
    assert.equal(asksOnlyFor(q), null, q);
});

test('the PDD and the BRD list the missing objective once, though the document, the gaps and a question all raise it', () => {
  const m = noObjective();
  for (const build of [buildPdd, buildBrd]) {
    const items = doc(m, build).openItems.filter(o => /objective/i.test(o.text));
    assert.equal(items.length, 1, items.map(o => o.text).join(' | '));
  }
  // A question about something more is listed on its own.
  const both = noObjective('What is the objective of the matching step?');
  assert.equal(doc(both).openItems.filter(o => /objective/i.test(o.text)).length, 2);
});

test('the question lists count it once, and answering it closes both', () => {
  const m = noObjective();
  const t = triage(m, assessProcess(m, {}));
  const about = t.items.filter(i => i.target.kind === 'meta' && (i.target.field === 'objective' || /objective/i.test(i.question)));
  assert.equal(about.length, 1);
  assert.deepEqual(about[0]!.questionIds, ['q-objective-free']);
  assert.ok(about[0]!.also?.includes('Process objective is unknown'));
  const plan = planQuestions(t, m);
  assert.equal([...plan.now, ...plan.wait].filter(i => i.key === about[0]!.key).length, 1);
  // One open item for the objective, not two.
  assert.equal(openItemCount(m), openItemCount(gold()) + 1);
  const answered = buildAnswer(about[0]!, m, { text: 'Pay suppliers on time' })!.op(m).model;
  assert.equal(answered.meta.objective.value, 'Pay suppliers on time');
  assert.equal(answered.openQuestions.find(q => q.id === 'q-objective-free')!.status, 'answered');
});
