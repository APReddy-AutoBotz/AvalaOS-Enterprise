// The Ask Avala interview: questions in triage's order with why each matters; an answer read into the
// value the question takes, with the person's words; a stated value is recorded on Save, an inferred one
// asked back, and no value gets one follow-up and then nothing. Never a value the person did not give.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { ProcessModel } from '../processModel/types.ts';
import { assessProcess } from '../assess/process.ts';
import { triage, type TriageItem } from './triage.ts';
import type { NoteFinding } from './notes.ts';
import { followUpFor, interviewAnswer, interviewEdit, interviewQueue, interviewSegments, readInterview, UNANSWERED, whoCanAnswer, whyItMatters, willRecord } from './interview.ts';

const gold = (): ProcessModel => JSON.parse(readFileSync(new URL('../../eval/corpus/ap-invoice/expected.model.json', import.meta.url), 'utf8'));
const setup = () => { const m = gold(); return { m, items: interviewQueue(triage(m, assessProcess(m))) }; };
const ofKind = (items: TriageItem[], kind: TriageItem['kind']) => items.find(i => i.kind === kind)!;
const finding = (o: Partial<NoteFinding>): NoteFinding => ({ questionId: '1', value: '', interface: '', certainty: 'stated', segmentId: 'n:1', excerpt: '', ...o });

test('the questions come in triage order, open ones only, each saying why it matters', () => {
  const { m, items } = setup();
  const order = { decides: 0, signoff: 1, detail: 2 } as const;
  assert.ok(items.length > 0);
  assert.ok(items.every(i => !i.deferred));
  assert.deepEqual(items.map(i => order[i.group]), [...items.map(i => order[i.group])].sort((a, b) => a - b));
  const first = items[0];
  assert.match(whyItMatters(first), /^(The answer can change the recommended approach|It is needed before the documents can be signed off|It completes the detail)/);
  assert.match(whoCanAnswer(first, 'Rahul Deshpande'), /^Rahul Deshpande \(the analyst on this process\) can record the answer/);
  assert.match(whoCanAnswer(first, null), /^Someone who can edit this process/);
  assert.ok(m);
});

test('an answer is sent with its one question; a follow-up answer is added to the first', () => {
  const { m, items } = setup();
  const role = ofKind(items, 'role');
  const { segments, ids } = interviewSegments(m, role, interviewAnswer('  The AP   Clerk does it. ', 'Yes, the clerk.'));
  assert.deepEqual(segments.map(s => s.id), ['q:1', 'n:1', 'n:2']);
  assert.match(segments[0].text, /^Question 1 \(role\): /);
  assert.match(segments[0].text, /Roles: /);
  assert.equal(segments[1].text, 'The AP Clerk does it.');
  assert.equal(ids.get('1'), role.key);
  assert.equal(interviewAnswer('x'.repeat(3000)).length, 2000);
});

test('a stated value is offered to record, with the person\'s words, and the edit keeps those words', () => {
  const { m, items } = setup();
  const role = ofKind(items, 'role');
  const clerk = m.roles.find(r => /Clerk/.test(r.name))!;
  const { ids } = interviewSegments(m, role, 'The AP clerk does it.');
  const r = readInterview(m, role, ids, [finding({ value: clerk.name, excerpt: 'The AP clerk does it' })], 1, 'The AP clerk does it.');
  assert.equal(r.kind, 'record');
  if (r.kind !== 'record') return;
  assert.equal(willRecord(r.proposal), `This will record: ${clerk.name}`);
  const edit = interviewEdit(m, role, r.proposal)!;
  const after = edit.op(m).model;
  const closed = after.openQuestions.find(q => /The AP clerk does it/.test(q.answer ?? ''));
  assert.ok(closed, 'the recorded answer carries the person\'s words');
  assert.match(closed!.answer!, /in their words: "The AP clerk does it"/);
});

test('an inferred value is asked back; nothing is recorded without a yes', () => {
  const { m, items } = setup();
  const role = ofKind(items, 'role');
  const lead = m.roles.find(r => /Lead/.test(r.name))!;
  const { ids } = interviewSegments(m, role, 'Probably whoever leads the team.');
  const r = readInterview(m, role, ids, [finding({ value: lead.name, certainty: 'inferred', excerpt: 'whoever leads the team' })], 1, 'Probably whoever leads the team.');
  assert.equal(r.kind, 'confirm');
  if (r.kind === 'confirm') assert.equal(r.question, `Did you mean: ${lead.name}?`);
});

test('no value: one follow-up by kind, then nothing is recorded; a value that fits no option is no value', () => {
  const { m, items } = setup();
  const role = ofKind(items, 'role');
  const { ids } = interviewSegments(m, role, 'Not sure.');
  const first = readInterview(m, role, ids, [], 1, 'Not sure.');
  assert.equal(first.kind, 'followUp');
  if (first.kind === 'followUp') assert.match(first.question, /^I could not tell which role from that\. Which of these does it: .*AP Clerk/);
  assert.deepEqual(readInterview(m, role, ids, [], 2, 'Not sure.'), { kind: 'unanswered', message: UNANSWERED });
  // A role the process does not have is not recorded, however it was said.
  assert.equal(readInterview(m, role, ids, [finding({ value: 'Chief Robot Officer', excerpt: 'Not sure' })], 1, 'Chief Robot Officer.').kind, 'followUp');
  // "I don't know" is no value, even when a free-text reading would record the words.
  const free = { ...role, kind: 'free' as const };
  for (const said of ['No idea, honestly.', "I'm not sure, you would have to ask procurement.", "I'll have to check with the ServiceNow admin."]) {
    assert.equal(readInterview(m, free, ids, [finding({ value: said, excerpt: said })], 1, said).kind, 'followUp', said);
  }
  // A real answer that also mentions not being sure of something else is still read.
  const long = 'Buyers should come back within two working days, though I am not sure every buyer knows that yet, so we will remind them in the next team meeting.';
  assert.equal(readInterview(m, free, ids, [finding({ value: 'Within two working days.', excerpt: 'Buyers should come back within two working days' })], 1, long).kind, 'record');
  for (const kind of ['system', 'number', 'access', 'free'] as const) {
    const item = { ...role, kind, interfaces: kind === 'access' ? [{ index: 0, label: 'API', access: 'unknown' as const }] : undefined };
    assert.ok(followUpFor(item, m).length > 20, kind);
  }
});
