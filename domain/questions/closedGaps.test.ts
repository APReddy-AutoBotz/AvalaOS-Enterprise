import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { ElementTarget, ProcessModel } from '../processModel/types.ts';
import { addQuestion, closeQuestions, deferQuestion, removeStep, reopenQuestions } from '../processModel/patch.ts';
import { gaps } from '../processModel/selectors.ts';
import { assessProcess } from '../assess/process.ts';
import { emptyDecisions } from '../assess/decisions.ts';
import { triage } from './triage.ts';
import { planQuestions, questionsTabCount } from './firstList.ts';
import { assessmentLine } from './result.ts';
import { firstListCounts } from './counts.ts';
import { closedGaps, openItemsNow } from './closedGaps.ts';
import { buildPdd } from '../docs/pdd.ts';
import { buildBrd } from '../docs/brd.ts';
import { setPurpose } from '../processModel/patch.ts';

const gold = (): ProcessModel => JSON.parse(readFileSync(new URL('../../eval/corpus/ap-invoice/expected.model.json', import.meta.url), 'utf8'));
const NA = 'Not applicable to this process.';
const role: ElementTarget = { kind: 'step', id: 's-match', field: 'roleIds' };
const on = (t: ElementTarget) => (x: { target: ElementTarget }) => x.target.kind === t.kind && x.target.id === t.id && (x.target.field ?? '') === (t.field ?? '');

/** "Not applicable" on a gap with no stored question, as Closing the gaps and Discovery record it. */
function closeGap(m: ProcessModel, t: ElementTarget, question: string): { model: ProcessModel; id: string } {
  const a = addQuestion(m, { target: t, question });
  return { model: closeQuestions(a.model, { questionIds: [a.questionId], answer: NA }).model, id: a.questionId };
}
const docInput = (m: ProcessModel) => { const decisions = emptyDecisions(); return { model: m, assessment: assessProcess(m, { decisions }), decisions, sources: [], revision: { label: 'r', state: 'working' as const, date: 'd' } }; };
const openItems = (tree: { openItems: { text: string }[] }) => tree.openItems.map(o => o.text);

test('a gap a person closed is not asked again anywhere the question rules count, and nothing else moves', () => {
  const m = gold();
  assert.ok(gaps(m).some(on(role)), 'the sample has no one recorded for the three-way match');
  const before = triage(m, assessProcess(m));
  assert.ok(before.items.some(on(role)));
  const { model: after } = closeGap(m, role, 'Who does "Three-way match"?');
  const t = triage(after, assessProcess(after));
  assert.equal(t.items.some(on(role)), false, 'not listed as open');
  assert.equal(t.items.length, before.items.length - 1, 'only that one goes');
  assert.equal(t.raw, before.raw - 1, 'the raw count: the gap no longer counts, and an answered question never did');
  assert.equal(openItemsNow(after), openItemsNow(m) - 1, 'the Questions tab\'s "N in all"');
  assert.deepEqual(closedGaps(after).map(c => [c.label, c.question.answer]), [['Who does "Three-way match"?', NA]]);
  // The gap is still a fact of the process: the step has no one recorded.
  assert.ok(gaps(after).some(on(role)));
});

test('it opens again only when a person reopens its question; left with someone, it stays left as before', () => {
  const { model: closed, id } = closeGap(gold(), role, 'Who does "Three-way match"?');
  const reopened = reopenQuestions(closed, { questionIds: [id] }).model;
  const t = triage(reopened, assessProcess(reopened));
  assert.deepEqual(t.items.filter(on(role)).map(i => ({ ids: i.questionIds, deferred: i.deferred })), [{ ids: [id], deferred: false }]);
  assert.deepEqual(closedGaps(reopened), []);
  const left = deferQuestion(gold(), { questionIds: [], owner: 'Rahul', gap: { target: role, question: 'Who does "Three-way match"?' } }).model;
  assert.deepEqual(triage(left, assessProcess(left)).items.filter(on(role)).map(i => i.deferred), [true]);
  assert.deepEqual(closedGaps(left), [], 'left with someone is not closed');
});

test('an exception with no route closed by a person is not asked again either', () => {
  const m = gold();
  const e = m.exceptions[0]!;
  delete (e as { routedToRoleId?: string | null }).routedToRoleId;
  const t0 = triage(m, assessProcess(m));
  const target: ElementTarget = { kind: 'exception', id: e.id, field: 'routedToRoleId' };
  const { model } = closeGap(m, target, `Who handles the exception "${e.name}"?`);
  const t = triage(model, assessProcess(model));
  assert.equal(t.items.some(i => i.target.kind === 'exception' && i.target.id === e.id), false);
  assert.equal(t.items.length, t0.items.length - 1);
});

test('the PDD (both forms) and the BRD no longer list a closed gap as open; reopened, they do again', () => {
  const m = gold();
  const label = 'Who does "Three-way match"?';
  for (const build of [buildPdd, buildBrd]) assert.ok(openItems(build(docInput(m))).includes(label));
  const asIs = setPurpose(m, { value: 'as_is', by: 'u1', at: '2026-11-25T10:00:00.000Z' }).model;
  assert.ok(openItems(buildPdd(docInput(asIs))).includes(label));
  const { model: closed, id } = closeGap(m, role, label);
  for (const build of [buildPdd, buildBrd]) assert.equal(openItems(build(docInput(closed))).includes(label), false, build.name);
  const closedAsIs = setPurpose(closed, { value: 'as_is', by: 'u1', at: '2026-11-25T10:00:00.000Z' }).model;
  assert.equal(openItems(buildPdd(docInput(closedAsIs))).includes(label), false);
  const reopened = reopenQuestions(closed, { questionIds: [id] }).model;
  assert.ok(openItems(buildPdd(docInput(reopened))).includes(label));
});

test('figures on a draft shaped like the owner\'s test process: 6 steps, no one recorded, 19 questions about the whole process', () => {
  let m = gold();
  for (const s of m.steps.slice(6)) m = removeStep(m, { stepId: s.id }).model;
  for (const s of m.steps) s.roleIds = [];
  for (let i = 0; i < 19; i++) m = addQuestion(m, { target: { kind: 'meta' }, question: `Whole-process question ${i} about how the regions differ ${i}?` }).model;
  const figures = (x: ProcessModel) => {
    const a = assessProcess(x);
    const plan = planQuestions(triage(x, a), x);
    return { line: assessmentLine(x, a)?.n ?? 0, tab: questionsTabCount(plan, openItemsNow(x)).count, first: firstListCounts(x) };
  };
  const before = figures(m);
  let after = m;
  for (const g of gaps(m).filter(x => x.kind === 'step_without_role').slice(0, 2)) after = closeGap(after, g.target, g.label).model;
  // The two "Who does …?" closed with "Not applicable" leave the first list; on this shape they were among what can
  // wait, so the line and the tab are unchanged and "wait" goes down by two.
  assert.deepEqual(before, { line: 2, tab: 2, first: { now: 2, found: 0, wait: 23 } });
  assert.deepEqual(figures(after), { line: 2, tab: 2, first: { now: 2, found: 0, wait: 21 } });
});
