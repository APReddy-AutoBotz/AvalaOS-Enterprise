// Package 16 (section 3g of docs/next-plan.md): the Assessment stage's line, the focused list, what a
// meeting closed and who to ask about what is left, on the sample case.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { ProcessModel } from '../processModel/types.ts';
import { assessProcess } from '../assess/process.ts';
import { decideApproach, deferQuestion, setPurpose } from '../processModel/patch.ts';
import { buildAnswer } from './answer.ts';
import { approvalCounts } from './approvalCounts.ts';
import { triage, type TriageItem } from './triage.ts';
import { assessmentLine, couldChange, focusedLine, meetingResult, whoToAsk } from './result.ts';

const gold: ProcessModel = JSON.parse(readFileSync(new URL('../../eval/corpus/ap-invoice/expected.model.json', import.meta.url), 'utf8'));
const at = '2026-11-23T10:00:00.000Z';
const items = (m: ProcessModel) => triage(m, assessProcess(m)).items;
const answer = (m: ProcessModel, key: string, a: Parameters<typeof buildAnswer>[2]) => {
  const item = items(m).find(i => i.key === key)!;
  return buildAnswer(item, m, a)!.op(m).model;
};

test('the line counts approvalCounts\' open questions less those left with someone: 2 on the bare sample', () => {
  const a = assessProcess(gold);
  const c = approvalCounts(gold, a)!;
  const line = assessmentLine(gold, a)!;
  assert.equal(line.n, c.open - c.leftWithSomeone);
  assert.equal(line.n, 2);
  assert.equal(line.text, '2 open questions could change the recommendation');
  // The focused list holds the same questions the line counts.
  assert.equal(items(gold).filter(couldChange).length, line.n);
  assert.equal(focusedLine(3), 'Showing the 3 that could change the recommendation');
  assert.equal(focusedLine(1), 'Showing the 1 that could change the recommendation');
});

test('a question left with someone is not counted; one set aside with no name still is', () => {
  const named = deferQuestion(gold, { questionIds: ['q-servicenow'], owner: 'ServiceNow platform owner' }).model;
  assert.equal(assessmentLine(named, assessProcess(named))!.n, 1);
  assert.equal(assessmentLine(named, assessProcess(named))!.text, '1 open question could change the recommendation');
  assert.equal(items(named).filter(couldChange).length, 1);
  const nobody = deferQuestion(gold, { questionIds: ['q-servicenow'], owner: null }).model;
  assert.equal(nobody.openQuestions.find(q => q.id === 'q-servicenow')!.status, 'deferred');
  assert.equal(assessmentLine(nobody, assessProcess(nobody))!.n, 2);
  assert.equal(items(nobody).filter(couldChange).length, 2);
});

test('one question, none, documented as it is and decided: the words, or no line', () => {
  let m = deferQuestion(gold, { questionIds: ['q-servicenow'], owner: 'ServiceNow platform owner' }).model;
  assert.equal(assessmentLine(m, assessProcess(m))!.text, '1 open question could change the recommendation');
  m = deferQuestion(m, { questionIds: ['q-gr-api', 'q-invoice-api', 'q-attach-api'], owner: 'SAP basis team' }).model;
  // The office scanner's question, still open, is a device's: it is Detail and is not counted.
  assert.equal(items(m).find(i => i.key === 'system:sys-scanner')!.group, 'detail');
  assert.equal(assessmentLine(m, assessProcess(m)), null);
  const asIs = setPurpose(gold, { value: 'as_is', by: 'u1', at }).model;
  assert.equal(assessmentLine(asIs, assessProcess(asIs)), null);
  const decided = decideApproach(gold, { approach: 'rpa', reason: 'RPA is the bank\'s chosen platform.', by: 'u1', at }).model;
  assert.equal(assessmentLine(decided, assessProcess(decided)), null);
});

test('meetingResult reads two models: answered questions are closed, one set aside for someone is not', () => {
  let after = answer(gold, 'q-gl-coding', { text: 'The AP lead picks the GL account from the vendor\'s category list.' });
  after = answer(after, 'q-buyer-sla', { text: 'Buyers answer within two working days.' });
  // Set aside for a named person: a question found by rule becomes a stored one, and is still open.
  const gap = items(after).find(i => i.key.startsWith('gap:step_without_role'))!;
  after = deferQuestion(after, { questionIds: [], owner: 'AP Team Lead', gap: { target: gap.target, question: gap.question } }).model;
  const r = meetingResult(gold, after);
  const open = items(gold).filter(i => !i.deferred).length;
  assert.equal(r.open, open);
  assert.equal(r.closed, 2);
  assert.equal(r.text, `2 of ${open} open questions closed`);
  // What is left is everything still open after, the question set aside with its name.
  const left = r.left.flatMap(g => g.items);
  assert.equal(left.length, items(after).length);
  assert.equal(left.find(i => i.question === gap.question)!.leftWith, 'AP Team Lead');
  assert.ok(!left.some(i => i.key === 'q-gl-coding' || i.key === 'q-buyer-sla'));
  // Nothing changed, nothing closed.
  assert.equal(meetingResult(gold, gold).text, `0 of ${open} open questions closed`);
});

test('whoToAsk: the three kinds of person in the question files\' order, decisive first in each, a typed name on its question', () => {
  const groups = whoToAsk(items(gold));
  assert.deepEqual(groups.map(g => g.label), ['Process owner or SME', 'IT or application owner', 'Finance or controls']);
  const base = { target: { kind: 'meta' as const }, questionIds: [], kind: 'free' as const, affects: [], deferred: false, assignedTo: null };
  const made: TriageItem[] = [
    { ...base, key: 'f1', question: 'Finance detail', group: 'detail', owner: 'finance' },
    { ...base, key: 'b1', question: 'Business detail', group: 'detail', owner: 'business' },
    { ...base, key: 'b2', question: 'Business sign-off', group: 'signoff', owner: 'business' },
    { ...base, key: 'b3', question: 'Business decides', group: 'decides', owner: 'business', deferred: true, assignedTo: 'Meera Iyer' },
    { ...base, key: 'i1', question: 'IT decides', group: 'decides', owner: 'it' },
  ];
  const w = whoToAsk(made);
  assert.deepEqual(w.map(g => g.owner), ['business', 'it', 'finance']);
  assert.deepEqual(w[0]!.items.map(i => i.key), ['b3', 'b2', 'b1']);
  assert.equal(w[0]!.items[0]!.leftWith, 'Meera Iyer');
  assert.equal(w[0]!.items[0]!.decisive, true);
  assert.equal(w[0]!.items[0]!.group, 'Changes the recommendation');
  assert.equal(w[0]!.items[1]!.leftWith, null);
  // A kind of person with nothing to ask is left out.
  assert.deepEqual(whoToAsk(made.filter(i => i.owner !== 'it')).map(g => g.owner), ['business', 'finance']);
});

test('a process documented as it is lists no question about an application\'s access', () => {
  const asIs = setPurpose(gold, { value: 'as_is', by: 'u1', at }).model;
  const listed = whoToAsk(items(asIs)).flatMap(g => g.items);
  assert.ok(listed.length > 0);
  assert.ok(!listed.some(i => i.key.startsWith('system:')));
  assert.ok(!items(asIs).some(i => i.kind === 'access' || (i.target.kind === 'system' && i.target.field === 'access')));
});
