// The interview measure fits the sample, and its judge holds to the rule: never a value the person did not give.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessProcess } from '../../domain/assess/process.ts';
import { triage } from '../../domain/questions/triage.ts';
import { interviewQueue } from '../../domain/questions/interview.ts';
import { judgeInterview, loadInterviewCases } from './interview.ts';
import { loadSample } from './sample.ts';

const sample = await loadSample();
const items = interviewQueue(triage(sample.model, assessProcess(sample.model)));
const cases = loadInterviewCases();

test('twenty cases, each on an open question of the sample, every kind of answer covered, some with no value in them', () => {
  assert.equal(cases.length, 20);
  assert.equal(new Set(cases.map(c => c.id)).size, 20);
  for (const c of cases) assert.ok(items.some(i => i.key === c.key), `${c.id}: the sample has the question ${c.key}`);
  const kinds = new Set(cases.map(c => items.find(i => i.key === c.key)!.kind));
  for (const k of ['role', 'system', 'access', 'free']) assert.ok(kinds.has(k as never), k);
  assert.ok(cases.filter(c => c.expect.none).length >= 5);
  for (const c of cases.filter(c => c.expect.pick)) {
    const item = items.find(i => i.key === c.key)!;
    const names = (item.kind === 'role' ? sample.model.roles : sample.model.systems).map(x => x.name);
    assert.ok(names.includes(c.expect.pick!), `${c.id}: ${c.expect.pick} is one of the options`);
  }
});

test('the judge: a follow-up where nothing was said, the right value where it was, and never a value not given', () => {
  const c = (id: string) => cases.find(x => x.id === id)!;
  const prop = (display: string, quote: string, answer: object = {}) => ({ itemKey: 'k', question: 'q', display, quote, certainty: 'stated' as const, answer });
  assert.ok(judgeInterview(c('IV04'), { kind: 'followUp', question: '?' }).pass);
  const guessed = judgeInterview(c('IV12'), { kind: 'confirm', proposal: prop('AP Clerk', 'nobody touches it'), question: '?' });
  assert.ok(!guessed.pass && guessed.notStated);
  assert.ok(judgeInterview(c('IV11'), { kind: 'record', proposal: prop('AP Clerk', 'The AP Clerk does the three-way match') }).pass);
  const wrong = judgeInterview(c('IV11'), { kind: 'record', proposal: prop('AP Team Lead', 'The AP Clerk does the three-way match') });
  assert.ok(!wrong.pass && wrong.notStated);
  assert.ok(judgeInterview(c('IV06'), { kind: 'record', proposal: prop('Within 2 working days.', 'within two working days') }).pass, 'two read as 2');
  const invented = judgeInterview(c('IV06'), { kind: 'record', proposal: prop('Within 3 working days.', 'within two working days') });
  assert.ok(!invented.pass && invented.notStated);
  assert.ok(judgeInterview(c('IV01'), { kind: 'record', proposal: prop('API: can be used', "ServiceNow's API is live", { statuses: { 0: 'confirmed' } }) }).pass);
  assert.ok(!judgeInterview(c('IV01'), { kind: 'record', proposal: prop('API: exists', "ServiceNow's API is live", { statuses: { 0: 'reported' } }) }).pass);
  assert.ok(judgeInterview(c('IV17'), { kind: 'followUp', question: '?' }).pass, 'maybe: a follow-up is fine');
  assert.ok(!judgeInterview(c('IV08'), { kind: 'followUp', question: '?' }).pass, 'a value was given');
});

test('an application\'s own name is not a figure the person did not give', () => {
  const c = cases.find(x => x.id === 'IV08')!;
  const p = { itemKey: 'k', question: 'q', display: 'SAP S/4HANA', quote: 'That check happens in SAP', certainty: 'inferred' as const, answer: {} };
  assert.ok(judgeInterview(c, { kind: 'confirm', proposal: p, question: 'Did you mean: SAP S/4HANA?' }).pass);
});
