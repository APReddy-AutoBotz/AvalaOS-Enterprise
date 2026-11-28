// Package B, pull request 5b: questions about what was said, and what is wanted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { ProcessModel } from '../processModel/types.ts';
import { closeQuestions, deferQuestion, keepWanted, setBriefFact } from '../processModel/patch.ts';
import { assessProcess } from '../assess/process.ts';
import { emptyDecisions } from '../assess/decisions.ts';
import { triage } from '../questions/triage.ts';
import { reconcile } from '../requirements/register.ts';
import { deriveRequirements } from '../requirements/derive.ts';
import { requirementFromWanted, wantedKey, isRequirement } from '../requirements/fromWanted.ts';
import { buildBrd } from '../docs/brd.ts';
import { buildFrd } from '../docs/frd.ts';
import { makeCard, type Card } from './card.ts';
import { discoveryQueue } from './queue.ts';
import { dropNoticedWanted, dropRaised, emptyState, noticedStep, raisedOf, readState, wantedOf } from './session.ts';
import { answerSaid, cardItem, descriptionSaid, heldBackSteps, keepWantedEdit, leaveWith, noticeAsked, notApplicable } from './flow.ts';

const gold = (): ProcessModel => JSON.parse(readFileSync(new URL('../../eval/corpus/ap-invoice/expected.model.json', import.meta.url), 'utf8'));
const at = '2026-11-26T10:00:00.000Z';
const said = (question: string, target: Card['target'], excerpt = 'we check every invoice twice when the supplier is new', key = `said:${question}`): Card =>
  makeCard({ key, group: 'said', origin: { kind: 'quote', quote: { excerpt, sourceId: 'own-1' } }, question, why: 'It changes who does the step.', target, updates: ['The step'], answer: 'words' })!;

test('what noticing raised is kept in the session, read back as it was, and leaves when acted on', () => {
  const c = said('Who checks a new supplier\'s invoice twice?', { kind: 'meta', field: 'flow' });
  let s = noticedStep([c, c], [{ excerpt: 'In future the system should block entries over the limit.', sourceId: 'own-1' }], ['seg-1', 'seg-2'], at)(emptyState());
  s = readState(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(raisedOf(s).map(x => x.key), [c.key], 'one card per key');
  assert.deepEqual(wantedOf(s).map(w => w.excerpt), ['In future the system should block entries over the limit.']);
  assert.deepEqual(s.read, ['seg-1', 'seg-2'], 'the passages read are never sent again');
  assert.deepEqual(raisedOf(dropRaised([c.key])(s)), []);
  assert.deepEqual(wantedOf(dropNoticedWanted('In future the system should block entries over the limit.')(s)), []);
});

test('noticing does not ask again what the record holds, a target a person closed or left included', () => {
  let m = gold();
  const q = m.openQuestions[0]!;
  m = closeQuestions(m, { questionIds: [q.id], answer: 'Not applicable to this process.' }).model;
  const asked = noticeAsked(m, { waiting: [{ key: 'shape:end', words: 'Filed.', question: 'When is a case finished?', at }], later: [] });
  assert.ok(asked.includes(q.question), 'a closed question');
  assert.ok(asked.includes('When is a case finished?'), 'a question whose answer waits');
  const left = deferQuestion(gold(), { questionIds: [gold().openQuestions[1]!.id], owner: 'Priya' }).model;
  assert.ok(noticeAsked(left, emptyState()).includes(gold().openQuestions[1]!.question), 'a question left with someone');
});

test('a raised question on a field another card asks about becomes that card, quoting the words; on a closed target it is not asked', () => {
  const m = gold();
  const a = assessProcess(m);
  const t = triage(m, a);
  const target = { kind: 'step' as const, id: 's-match', field: 'roleIds' };
  const r = said('Who does the three-way match for new suppliers?', target);
  const cards = discoveryQueue({ model: m, assessment: a, asksPurpose: false, triage: t, raised: [r] });
  const on = cards.filter(c => c.target.kind === 'step' && c.target.id === 's-match' && c.target.field === 'roleIds');
  assert.equal(on.length, 1, 'one card for the target');
  assert.equal(on[0]!.origin.kind, 'quote', 'its origin is the person\'s words');
  assert.ok(cardItem(on[0]!, t), 'and it acts on the gap\'s own item');
  // Closed: not asked.
  const closed = notApplicable(on[0]!, cardItem(on[0]!, t)).op(m).model;
  const again = discoveryQueue({ model: closed, assessment: assessProcess(closed), asksPurpose: false, raised: [r] });
  assert.equal(again.some(c => c.target.id === 's-match' && c.target.field === 'roleIds'), false);
  // About the process as a whole: a card of its own, in the group "About what you said".
  const whole = said('Does the work differ for invoices from abroad?', { kind: 'meta', field: 'flow' });
  assert.ok(discoveryQueue({ model: m, assessment: a, asksPurpose: false, triage: t, raised: [whole] }).some(c => c.key === whole.key && c.group === 'said'));
});

test('with the same inputs, the cards come in the same order', () => {
  const m = gold();
  const a = assessProcess(m);
  const raised = [said('One?', { kind: 'meta', field: 'flow' }, 'one thing we do', 'said:one'), said('Two?', { kind: 'meta', field: 'flow' }, 'two things we do', 'said:two')];
  const once = discoveryQueue({ model: m, assessment: a, asksPurpose: true, raised }).map(c => c.key);
  assert.deepEqual(discoveryQueue({ model: m, assessment: a, asksPurpose: true, raised }).map(c => c.key), once);
});

test('acting on a raised card records the words that raised it', () => {
  const m = gold();
  const r = said('Does the work differ for invoices from abroad?', { kind: 'meta', field: 'flow' });
  const na = notApplicable(r, undefined).op(m).model;
  assert.deepEqual(na.openQuestions.at(-1)!.raisedBy, r.origin.kind === 'quote' ? r.origin.quote : undefined);
  const left = leaveWith(r, undefined, 'Priya')!.op(m).model;
  assert.deepEqual({ owner: left.openQuestions.at(-1)!.owner, raisedBy: left.openQuestions.at(-1)!.raisedBy?.excerpt }, { owner: 'Priya', raisedBy: 'we check every invoice twice when the supplier is new' });
});

test('the description and an answer are said in the person\'s words only', () => {
  const d = descriptionSaid({ key: 'own-1', segments: [{ id: 'own-1:1', text: 'Invoices come by email.' }] });
  assert.deepEqual(d, [{ ref: 'own-1:1', text: 'Invoices come by email.', sourceId: 'own-1' }]);
  assert.deepEqual(answerSaid('shape:end', 'When is a case finished?', '  Filed in SAP.  ', at), { ref: `answer:shape:end:${at}`, text: 'Filed in SAP.', answerTo: 'When is a case finished?' });
});

test('held back: a step whose every quote is inside a wanted statement, when the work is done today; none for work not done today', () => {
  const m = gold();
  const extracted = gold();
  const step = extracted.steps[0]!;
  // Every quote of the step lies inside a statement marked wanted: when the work is done today it is held back.
  const wide = noticedStep([], step.sources.map(x => ({ excerpt: `${x.excerpt}, and that is what we want in future`, sourceId: x.sourceId })), [], at)(emptyState());
  assert.deepEqual(heldBackSteps(m, extracted, wide).map(x => x.id), [step.id]);
  const notToday = setBriefFact(m, { fact: 'doneToday', value: 'no' }).model;
  assert.deepEqual(heldBackSteps(notToday, extracted, wide), [], 'nothing is held back for work not done today');
  // Once kept under What you want to change (and so no longer in the session's list), it still holds the step back.
  const keptAll = step.sources.reduce((x, q) => keepWantedEdit({ excerpt: `${q.excerpt}, and that is what we want in future`, sourceId: q.sourceId, at }).op(x).model, m);
  assert.deepEqual(heldBackSteps(keptAll, extracted, emptyState()).map(x => x.id), [step.id]);
  assert.deepEqual(heldBackSteps(m, extracted, emptyState()), [], 'nothing wanted, nothing held back');
});

test('"Make it a requirement": one user business requirement, listed by the BRD and traced in the FRD, kept by reconcile', () => {
  const kept = keepWantedEdit({ excerpt: 'The system should block entries over the limit.', sourceId: 'own-1', at }).op(gold()).model;
  const w = kept.meta.wanted!.at(-1)!;
  const a = assessProcess(kept);
  const derived = reconcile(deriveRequirements(kept, a), []).requirements;
  const row = requirementFromWanted(w, derived);
  assert.deepEqual({ kind: row.kind, origin: row.origin, key: row.key, state: row.state }, { kind: 'BR', origin: 'user', key: wantedKey(w), state: 'active' });
  assert.ok(!derived.some(r => r.code === row.code), 'a code never used');
  const stored = [...derived, row];
  assert.ok(isRequirement(w, stored));
  const again = reconcile(deriveRequirements(kept, a), stored).requirements;
  assert.ok(again.some(r => r.code === row.code && r.origin === 'user' && r.state === 'active'), 'kept on every regeneration');
  const input = { model: kept, assessment: a, decisions: emptyDecisions(), sources: [], requirements: again, revision: { label: 'r', state: 'working' as const, date: 'd' } };
  const text = (tree: unknown) => JSON.stringify(tree);
  assert.ok(text(buildBrd(input)).includes('The system should block entries over the limit.'), 'the BRD lists it');
  assert.ok(text(buildFrd(input)).includes(row.code), 'the FRD traces to it');
  // The steps and the As-Is are unchanged by keeping it.
  assert.deepEqual(kept.steps, gold().steps);
});

test('keeping a wanted statement changes nothing the process is drawn from', () => {
  const kept = keepWanted(gold(), { statement: 'In future the system should block entries over the limit.' }).model;
  for (const k of ['steps', 'flows', 'gateways', 'events', 'rules'] as const) assert.deepEqual(kept[k], gold()[k], k);
});
