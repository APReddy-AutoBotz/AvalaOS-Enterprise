import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { ProcessModel } from '../processModel/types.ts';
import { addRole, addStep, updateFact } from '../processModel/patch.ts';
import { validateModel } from '../processModel/validate.ts';
import { assessProcess } from '../assess/process.ts';
import { triage } from '../questions/triage.ts';
import { buildPacks } from '../questions/packs.ts';
import { emptyModel } from '../processModel/empty.ts';
import { discoveryQueue } from './queue.ts';
import { startCards, shapeCards } from './checklist.ts';
import { cardItem, chooseEdit, confirmedLine, discoveryTab, keptLine, leaveWith, notApplicable, NOT_APPLICABLE, stageOf, stepsWithWords, updateSources, wordsEdit, WORDS } from './flow.ts';

const gold: ProcessModel = JSON.parse(readFileSync(new URL('../../eval/corpus/ap-invoice/expected.model.json', import.meta.url), 'utf8'));
const at = '2026-11-24T10:00:00.000Z';

test('the tab: editors where the workspace has AI; Discovery alone on a process with no steps; a line for viewers; a paragraph in the demo', () => {
  assert.equal(discoveryTab({ canEdit: true, aiAvailable: true, demo: false, hasSteps: true }), 'tab');
  assert.equal(discoveryTab({ canEdit: true, aiAvailable: true, demo: false, hasSteps: false }), 'only');
  assert.equal(discoveryTab({ canEdit: false, aiAvailable: true, demo: false, hasSteps: false }), 'viewer');
  assert.equal(discoveryTab({ canEdit: false, aiAvailable: true, demo: false, hasSteps: true }), 'viewer');
  assert.equal(discoveryTab({ canEdit: true, aiAvailable: false, demo: false, hasSteps: true }), 'none');
  assert.equal(discoveryTab({ canEdit: true, aiAvailable: false, demo: true, hasSteps: true }), 'demo');
  assert.equal(WORDS.viewer, 'Someone who can edit this process can start Discovery.');
});

test('where a session stands: a description, a reading, the first reading to bring in, then cards', () => {
  assert.equal(stageOf({ hasSteps: false, sources: 0, run: null }), 'describe');
  assert.equal(stageOf({ hasSteps: false, sources: 1, run: { status: 'running', model: null } }), 'reading');
  assert.equal(stageOf({ hasSteps: false, sources: 1, run: { status: 'done', model: {} } }), 'first');
  assert.equal(stageOf({ hasSteps: true, sources: 2, run: { status: 'done', model: {} } }), 'cards');
  assert.equal(stageOf({ hasSteps: true, sources: 2, run: { status: 'merging', model: null } }), 'reading');
});

test('"What I understand so far": each step in order with who, where and the words it came from', () => {
  const rows = stepsWithWords(gold);
  assert.equal(rows.length, gold.steps.length);
  assert.ok(rows.every(r => r.name));
  assert.ok(rows.filter(r => r.words).length >= rows.length - 1);
  assert.equal(rows[0]!.words, gold.steps.find(s => s.name === rows[0]!.name)!.sources[0]?.excerpt ?? null);
});

test('an update reads the sources the last reading read, then the answers source', () => {
  const active = [{ id: 'own' }, { id: 'sop' }, { id: 'ans' }];
  assert.deepEqual(updateSources(['own'], active, 'ans'), ['own', 'ans']);
  // An archived source the last reading read is not read again.
  assert.deepEqual(updateSources(['gone', 'own'], active, 'ans'), ['own', 'ans']);
  // No earlier reading: every active source.
  assert.deepEqual(updateSources([], active, 'ans'), ['own', 'sop', 'ans']);
});

test('the first cards write through the existing edits; "decided" and "Not sure yet" write nothing', () => {
  const m = emptyModel('Claims');
  const [purpose, done] = startCards(m, { asksPurpose: true });
  const p = chooseEdit(purpose!, m, 'as_is', { me: 'u1', at })!;
  assert.equal(p.op(m).model.meta.purpose!.value, 'as_is');
  assert.equal(chooseEdit(purpose!, m, 'decided', { me: 'u1', at }), null);
  const d = chooseEdit(done!, m, 'partly', { me: 'u1', at })!;
  assert.equal(d.op(m).model.meta.brief!.doneToday!.value, 'partly');
  assert.equal(chooseEdit(done!, m, 'unknown', { me: 'u1', at }), null);
});

test('a ways-in card answered with File alone writes nothing; "API: not available" closes it', () => {
  const bare: ProcessModel = { ...gold, systems: gold.systems.map(x => (x.id === 'sys-servicenow' ? { ...x, access: [] } : x)) };
  const t = triage(bare, assessProcess(bare));
  const card = discoveryQueue({ model: bare, assessment: assessProcess(bare), asksPurpose: false, triage: t }).find(c => c.itemKey === 'system:sys-servicenow')!;
  const item = cardItem(card, t)!;
  assert.equal(item.kind, 'ways');
  assert.equal(chooseEdit(card, bare, '', { me: null, at, item, statuses: { 2: 'confirmed' } }), null);
  const e = chooseEdit(card, bare, '', { me: null, at, item, statuses: { 0: 'confirmed_absent' } })!;
  const after = e.op(bare).model;
  assert.ok(!triage(after, assessProcess(after)).items.some(i => i.key === 'system:sys-servicenow'));
});

// Review, 23 November 2026: a step is confirmed as a whole, so an answer about any of its fields is held back.
test('a step a person confirmed for its name only: an answer about its role is held back, the card says so, the difference is recorded', () => {
  const r = addRole(gold, { name: 'Night clerk', kind: 'person_role' });
  const s = addStep(r.model, { step: { name: 'Sort the post', taskType: 'manual', roleIds: [r.roleId] } });
  // A person edits the name only: the whole step is now confirmed by a person.
  const named = updateFact(s.model, { target: { kind: 'step', id: s.stepId, field: 'name' }, value: 'Sort the morning post' }).model;
  assert.equal(named.steps.find(x => x.id === s.stepId)!.status, 'user-confirmed');
  const item = { key: 'gap:step_without_role:step:x:roleIds', question: 'Who does "Sort the morning post"?', target: { kind: 'step' as const, id: s.stepId, field: 'roleIds' }, questionIds: [], kind: 'role' as const, group: 'decides' as const, owner: 'business' as const, affects: [] } as never;
  const clerk = named.roles.find(x => x.name !== 'Night clerk')!;
  const proposal = { itemKey: 'x', answer: { pick: clerk.id }, display: clerk.name, quote: `the ${clerk.name} sorts it`, certainty: 'stated' as const } as never;
  const e = wordsEdit(named, item, proposal, ['own-1'])!;
  assert.notEqual(e.outcome, 'write');
  assert.equal(e.line, 'The step "Sort the morning post" was confirmed by a person, so this answer does not change it. Saving keeps what was confirmed and records the difference to settle on the Process stage.');
  const after = e.op(named).model;
  assert.deepEqual(after.steps.find(x => x.id === s.stepId)!.roleIds, [r.roleId], 'the role stays');
  assert.ok(after.openQuestions.length > named.openQuestions.length || after.conflicts.length > named.conflicts.length, 'the difference is recorded');
  assert.ok(validateModel(after).valid);
  // The words that differ go into an answers source, keyed as Closing the gaps keys a person's notes.
  assert.equal(e.keepWords!.key, 'ans-1');
  // An element nobody confirmed has no such line.
  assert.equal(confirmedLine(gold, { kind: 'step', id: gold.steps[0]!.id, field: 'roleIds' }), gold.steps[0]!.status === 'user-confirmed' ? confirmedLine(gold, { kind: 'step', id: gold.steps[0]!.id }) : null);
});

test('"Not known, ask someone" leaves the question with the named person, in the question file for their kind', () => {
  const t = triage(gold, assessProcess(gold));
  const card = discoveryQueue({ model: gold, assessment: assessProcess(gold), asksPurpose: false, triage: t }).find(c => c.itemKey === 'system:sys-sap')!;
  const item = cardItem(card, t)!;
  const e = leaveWith(card, item, '  Priya ')!;
  assert.equal(e.line, `Left with Priya. It is in the question file for the IT or application owner.`);
  const after = e.op(gold).model;
  const deferred = after.openQuestions.filter(q => q.status === 'deferred' && q.owner === 'Priya');
  assert.ok(deferred.length >= 1);
  const packs = buildPacks(triage(after, assessProcess(after)), after);
  const it = packs.find(p => p.owner === 'it')!;
  assert.ok(it.items.some(x => x.item.key === item.key && x.item.deferred), 'in the IT file, marked left with someone');
  assert.equal(leaveWith(card, item, '   '), null);
});

test('"Not applicable" closes the question with that answer, a card with no stored question too', () => {
  const m = emptyModel('Claims');
  const steps = shapeCards(m).find(c => c.key === 'shape:steps')!;
  const after = notApplicable(steps, undefined).op(m).model;
  const q = after.openQuestions.at(-1)!;
  assert.equal(q.status, 'answered');
  assert.equal(q.answer, NOT_APPLICABLE);
  assert.ok(validateModel(after).valid);
  assert.equal(keptLine(1), 'Kept. The draft is unchanged until you update it (1 answer waiting).');
});

test('a question about the shape left with someone is not asked again in the session', () => {
  const ask = (m: ProcessModel) => { const a = assessProcess(m); const t = triage(m, a); return { t, cards: discoveryQueue({ model: m, assessment: a, asksPurpose: true, triage: t }) }; };
  const before = ask(gold);
  const key = 'gap:step_without_system:step:s-check:systemIds';
  const card = before.cards.find(c => c.key === key)!;
  assert.ok(card, 'the sample asks which system is used to check the mandatory fields');
  const e = leaveWith(card, cardItem(card, before.t), 'Rahul in AP')!;
  const after = ask(e.op(gold).model);
  assert.equal(after.cards.some(c => c.key === key), false);
  assert.equal(after.cards.length, before.cards.length - 1, 'only that card goes');
});
