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
import { cardItem, chooseEdit, confirmedLine, discoveryTab, keptLine, leaveWith, notApplicable, NOT_APPLICABLE, notSavedLine, stageOf, stepsWithWords, updateSources, wordsEdit, WORDS } from './flow.ts';

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
  const p = chooseEdit(purpose!, m, 'as_is', { me: 'u1', name: 'Asha Rao', at })!;
  assert.equal(p.op(m).model.meta.purpose!.value, 'as_is');
  assert.equal(chooseEdit(purpose!, m, 'decided', { me: 'u1', name: 'Asha Rao', at }), null);
  const d = chooseEdit(done!, m, 'partly', { me: 'u1', name: 'Asha Rao', at })!;
  assert.equal(d.op(m).model.meta.brief!.doneToday!.value, 'partly');
  assert.equal(chooseEdit(done!, m, 'unknown', { me: 'u1', name: 'Asha Rao', at }), null);
});

test('a ways-in card answered with File alone writes nothing; "API: not available" closes it', () => {
  const bare: ProcessModel = { ...gold, systems: gold.systems.map(x => (x.id === 'sys-servicenow' ? { ...x, access: [] } : x)) };
  const t = triage(bare, assessProcess(bare));
  const card = discoveryQueue({ model: bare, assessment: assessProcess(bare), asksPurpose: false, triage: t }).find(c => c.itemKey === 'system:sys-servicenow')!;
  const item = cardItem(card, t)!;
  assert.equal(item.kind, 'ways');
  assert.equal(chooseEdit(card, bare, '', { me: null, name: '', at, item, statuses: { 2: 'confirmed' } }), null);
  const e = chooseEdit(card, bare, '', { me: null, name: '', at, item, statuses: { 0: 'confirmed_absent' } })!;
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

test('who chose is kept: the purpose with the person\'s id, a resolved conflict with their name and id as the other screens store it', () => {
  const m = emptyModel('Claims');
  const [purpose] = startCards(m, { asksPurpose: true });
  assert.equal(chooseEdit(purpose!, m, 'assess', { me: 'u1', name: 'Asha Rao', at })!.op(m).model.meta.purpose!.by, 'u1');
  const a = assessProcess(gold);
  const card = discoveryQueue({ model: gold, assessment: a, asksPurpose: true }).find(c => c.key === 'conflict:k-02')!;
  const pick = card.choices![0]![0];
  const after = chooseEdit(card, gold, pick, { me: 'u1', name: 'Asha Rao', at })!.op(gold).model;
  const k = after.conflicts.find(c => c.id === 'k-02')!;
  assert.deepEqual({ by: k.resolution!.by, byId: k.resolution!.byId }, { by: 'Asha Rao', byId: 'u1' });
  assert.equal(after.meta.metrics.find(x => x.id === 'm-volume')!.value, 9000, 'the chosen figure is written, as the Questions tab writes it');
  // No name in the profile: "Not recorded", never "Discovery" as a person.
  const unnamed = chooseEdit(card, gold, pick, { me: 'u1', name: '', at })!.op(gold).model.conflicts.find(c => c.id === 'k-02')!.resolution!;
  assert.deepEqual({ by: unnamed.by, byId: unnamed.byId }, { by: 'Not recorded', byId: 'u1' });
});

// ---- A shape card on a draft that already holds the gap's own question (owner's walk, 25 November 2026) ------------

import { applyChanges, proposeChanges } from '../extract/rebase.ts';
import { gaps } from '../processModel/selectors.ts';

/** A draft as a first reading leaves it: steps with no one recorded, and the rule-made question already stored. */
function readDraft() {
  const reading: ProcessModel = structuredClone(gold);
  for (const s of reading.steps) if (s.id === 's-match' || s.id === 's-review') s.roleIds = [];
  for (const s of reading.steps) if (s.id === 's-match') s.systemIds = [];
  const stored = gaps(reading).filter(g => (g.kind === 'step_without_role' || g.kind === 'step_without_system') && (g.target.id === 's-match' || g.target.id === 's-review'));
  stored.forEach((g, n) => reading.openQuestions.push({ id: `q-9${n}`, target: g.target, question: g.label, whyItMatters: '', owner: null, status: 'open' }));
  const empty = emptyModel('Invoices');
  const m = applyChanges(empty, reading, new Set(proposeChanges(empty, reading).changes.filter(c => c.defaultSelected).map(c => c.id)));
  assert.ok(validateModel(m).valid);
  return m;
}
const ask = (m: ProcessModel) => { const a = assessProcess(m); const t = triage(m, a); return { t, cards: discoveryQueue({ model: m, assessment: a, asksPurpose: true, triage: t }) }; };
const roleKey = 'gap:step_without_role:step:s-match:roleIds';

test('a shape card stands for the stored question on its target: one card, no second card for the question', () => {
  const m = readDraft();
  const stored = m.openQuestions.filter(q => q.target.id === 's-match' && q.target.field === 'roleIds');
  assert.equal(stored.length, 1, 'the reading stored the question');
  const { t, cards } = ask(m);
  const card = cards.find(c => c.key === roleKey)!;
  assert.ok(card);
  assert.deepEqual(cardItem(card, t)?.questionIds, [stored[0]!.id]);
  // One card for that target, for the role and for the application alike.
  for (const field of ['roleIds', 'systemIds']) {
    assert.equal(cards.filter(c => c.target.id === 's-match' && c.target.field === field).length, 1, field);
  }
  assert.ok(cardItem(cards.find(c => c.key === 'gap:step_without_system:step:s-match:systemIds')!, t), 'the application card too');
});

test('"Not applicable" on such a card closes the stored question, adds none, and the card goes', () => {
  const m = readDraft();
  const { t, cards } = ask(m);
  const card = cards.find(c => c.key === roleKey)!;
  const after = notApplicable(card, cardItem(card, t)).op(m).model;
  assert.equal(after.openQuestions.length, m.openQuestions.length, 'no second copy');
  const q = after.openQuestions.find(x => x.target.id === 's-match' && x.target.field === 'roleIds')!;
  assert.equal(q.status, 'answered');
  assert.equal(q.answer, NOT_APPLICABLE);
  assert.equal(ask(after).cards.some(c => c.target.id === 's-match' && c.target.field === 'roleIds'), false);
});

test('"Not known, ask someone" on such a card defers the stored question with the name; one question, and the card goes', () => {
  const m = readDraft();
  const { t, cards } = ask(m);
  const card = cards.find(c => c.key === roleKey)!;
  const after = leaveWith(card, cardItem(card, t), 'Rahul in AP')!.op(m).model;
  const on = after.openQuestions.filter(x => x.target.id === 's-match' && x.target.field === 'roleIds');
  assert.equal(on.length, 1, 'one question');
  assert.deepEqual({ status: on[0]!.status, owner: on[0]!.owner }, { status: 'deferred', owner: 'Rahul in AP' });
  assert.equal(after.openQuestions.length, m.openQuestions.length);
  assert.equal(ask(after).cards.some(c => c.target.id === 's-match' && c.target.field === 'roleIds'), false);
});

test('a card built from a gap with no stored question still records one, once, and goes', () => {
  const m = readDraft();
  const { t, cards } = ask(m);
  const card = cards.find(c => c.key === 'gap:step_without_system:step:s-check:systemIds')!;
  assert.deepEqual(cardItem(card, t)?.questionIds, [], 'no question stored for it');
  const after = notApplicable(card, cardItem(card, t)).op(m).model;
  assert.equal(after.openQuestions.length, m.openQuestions.length + 1);
  assert.equal(ask(after).cards.some(c => c.target.id === 's-check' && c.target.field === 'systemIds'), false);
});

test('a refused write is said in plain words on the card', () => {
  assert.equal(notSavedLine('This question is already open.'), 'Not saved: This question is already open. Nothing was changed.');
  assert.equal(notSavedLine('The draft was changed elsewhere'), 'Not saved: The draft was changed elsewhere. Nothing was changed.');
});

test('"Read it again" stops at the session\'s three readings, or its tokens, and says which', async () => {
  const { readAgainStopped, WORDS } = await import('./flow.ts');
  assert.equal(readAgainStopped({ tokens: 0, calls: 0, readings: 2 }), null);
  assert.equal(readAgainStopped({ tokens: 0, calls: 0, readings: 3 }), WORDS.readingsUsed);
  assert.equal(WORDS.readingsUsed, 'This session has used its three readings. Add to what I said is still open; the words you add are kept for the next reading.');
  assert.match(readAgainStopped({ tokens: 250_000, calls: 0, readings: 1 })!, /^This session has used what it may read\./);
  // The panel's own calls do not stop a reading (they have their own cap).
  assert.equal(readAgainStopped({ tokens: 0, calls: 60, readings: 1 }), null);
});
