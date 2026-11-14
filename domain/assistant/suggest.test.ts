// Ask Avala's suggestions: by rule where a rule says it (work no proposal plans, application facts to
// bring in), from the sources only where a passage states the answer outright; only what the person's
// role may do; nothing applied from the panel, so each leads to the screen where it is made.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { ProcessModel } from '../processModel/types.ts';
import { assessProcess } from '../assess/process.ts';
import { triage } from '../questions/triage.ts';
import { interviewEdit, interviewQueue } from '../questions/interview.ts';
import type { NoteFinding } from '../questions/notes.ts';
import type { Application } from '../workspace/applications.ts';
import type { Passage } from './ask.ts';
import { answerSuggestions, applicationSuggestions, passagesFor, sourceSegments, suggestionsFor, workItemSuggestions } from './suggest.ts';

const gold = (): ProcessModel => JSON.parse(readFileSync(new URL('../../eval/corpus/ap-invoice/expected.model.json', import.meta.url), 'utf8'));
const setup = () => { const m = gold(); return { m, items: interviewQueue(triage(m, assessProcess(m))) }; };
const passage = (text: string, i = 0): Passage => ({ sourceKey: 'sop', sourceTitle: 'SOP vendor invoices', locator: { section: `5.${i}` } as never, text });
const admin = { access: 'admin' as const, canApprove: true, job: null }, viewer = { access: 'viewer' as const, canApprove: false, job: null };

test('the passages sent are the few that share most words with each open question, in their order, capped', () => {
  const { items } = setup();
  const q = items.find(i => i.kind === 'role')!;
  const words = q.question.replace(/[^A-Za-z ]/g, ' ');
  const ps = [passage('Nothing to do with it.', 0), passage(`About ${words} here.`, 1), passage('Unrelated text about lunch.', 2)];
  assert.deepEqual(passagesFor([q], ps).map(p => p.text), [`About ${words} here.`]);
  const many = Array.from({ length: 200 }, (_, i) => passage(`${words} ${i}`, i));
  assert.equal(passagesFor(items, many).length <= 40, true);
});

test('an answer a passage states is suggested with the passage and its place; inferred ones never are', () => {
  const { m, items } = setup();
  const role = items.find(i => i.kind === 'role')!;
  const clerk = m.roles.find(r => /Clerk/.test(r.name))!;
  const words = role.question.replace(/[^A-Za-z ]/g, ' ');
  const { segments, ids, passageOf } = sourceSegments(m, [role], [passage(`${words}: the AP Clerk does this.`, 3)]);
  assert.deepEqual(segments.map(s => s.id), ['q:1', 'n:1']);
  assert.equal(segments[1].locator, 'SOP vendor invoices, 5.3');
  const f = (o: Partial<NoteFinding>): NoteFinding => ({ questionId: '1', value: clerk.name, interface: '', certainty: 'stated', segmentId: 'n:1', excerpt: 'the AP Clerk does this', ...o });
  const [s] = answerSuggestions(m, [role], ids, [f({})], passageOf);
  assert.equal(s.kind, 'answer');
  assert.equal(s.willDo, `Record: ${clerk.name}`);
  assert.deepEqual(s.quote, { text: 'the AP Clerk does this', source: 'SOP vendor invoices, 5.3' });
  assert.deepEqual(s.target.kind, 'answer');
  assert.deepEqual(answerSuggestions(m, [role], ids, [f({ certainty: 'inferred' })], passageOf), [], 'inferred is not suggested');
  assert.deepEqual(answerSuggestions(m, [role], ids, [f({ segmentId: 'q:1' })], passageOf), [], 'quoting the question is not a source');
  // Confirmed, the record keeps the source and its words, and History says Ask Avala suggested it.
  const edit = interviewEdit(m, role, (s.target as Extract<typeof s.target, { kind: 'answer' }>).proposal, 'SOP vendor invoices, 5.3')!;
  assert.match(edit.summary, /^Suggested by Ask Avala from SOP vendor invoices, 5\.3; confirmed: /);
  assert.ok(edit.op(m).model.openQuestions.some(q => /from SOP vendor invoices, 5\.3: "the AP Clerk does this"/.test(q.answer ?? '')));
});

test('work no proposal plans, and application facts to bring in, are suggested by rule and lead to their stage', () => {
  const { m } = setup();
  const [w] = workItemSuggestions([{ code: 'FR-012', title: 'Park invoice', reason: 'Only 1 acceptance criterion.' }]);
  assert.deepEqual([w.title, w.why, w.target, w.needs], ['FR-012 Park invoice has no work item yet', 'Only 1 acceptance criterion.', { kind: 'stage', stage: 'work-items' }, 'work_items']);
  const sys = m.systems[0];
  const app: Application = { id: 'a1', name: sys.name, aliases: [], kind: sys.kind, access: [], uiAllowed: !(sys.uiAllowed as { value?: boolean } | undefined)?.value, remote: null, notes: '' } as Application;
  const [a] = applicationSuggestions(m, [app]);
  assert.ok(a && a.title.endsWith(`about ${sys.name} to bring in from the applications list`));
  assert.deepEqual(a.target, { kind: 'stage', stage: 'process' });
  assert.deepEqual(applicationSuggestions(m, []), [], 'an application the list does not know has nothing to bring in');
});

test('only what the person\'s role may do, nothing dismissed, answers first', () => {
  const ws = [...workItemSuggestions([{ code: 'FR-1', title: 'A', reason: 'r' }])];
  assert.equal(suggestionsFor(ws, admin).length, 1);
  assert.equal(suggestionsFor(ws, viewer).length, 0, 'a viewer is offered no change');
  assert.equal(suggestionsFor(ws, admin, ['work-item:FR-1']).length, 0, 'dismissed');
});
