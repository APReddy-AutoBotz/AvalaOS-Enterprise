import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { ProcessModel } from '../processModel/types.ts';
import { answerQuestion, removeStep, updateFact } from '../processModel/patch.ts';
import { incoming, orderedSteps, outgoing } from '../processModel/selectors.ts';
import { validateModel } from '../processModel/validate.ts';
import { applyChanges, proposeChanges } from './rebase.ts';
import { ownWordsEdits } from '../plan/start.ts';

const gold = (): ProcessModel => JSON.parse(readFileSync(new URL('../../eval/corpus/ap-invoice/expected.model.json', import.meta.url), 'utf8'));
const empty = (name: string): ProcessModel => ({
  ...gold(), meta: { name, objective: { value: null, status: 'unknown', sources: [] }, owner: { value: null, status: 'unknown', sources: [] }, scopeIn: [], scopeOut: [], metrics: [] },
  roles: [], systems: [], events: [], steps: [], gateways: [], flows: [], rules: [], exceptions: [], dataObjects: [], painPoints: [], controls: [], risks: [], openQuestions: [], conflicts: [],
});
const defaults = (cs: ReturnType<typeof proposeChanges>) => new Set(cs.changes.filter(c => c.defaultSelected).map(c => c.id));

test('the first extraction into an empty model is taken whole, keeping the process name', () => {
  const cs = proposeChanges(empty('Invoices'), gold());
  assert.equal(cs.first, true);
  assert.equal(cs.changes.filter(c => c.element === 'step').length, gold().steps.length);
  const next = applyChanges(empty('Invoices'), gold(), defaults(cs));
  assert.equal(next.meta.name, 'Invoices');
  assert.deepEqual({ ...next, meta: { ...next.meta, name: gold().meta.name } }, gold());
});

// Found while planning package B (23 November 2026): "Tell us in your own words" writes whether the work is
// done today and what the team has in mind into the brief before the first reading; with no application
// typed the model is still empty, and the first reading used to replace the brief with nothing.
test('the first reading keeps the brief lines given in "Tell us in your own words"', () => {
  let before = empty('Invoices');
  for (const op of ownWordsEdits({ doneToday: 'partly', inMind: ['rpa', 'ai'], apps: [] })) before = op(before).model;
  assert.equal(before.steps.length, 0);
  const cs = proposeChanges(before, gold());
  assert.equal(cs.first, true);
  const next = applyChanges(before, gold(), defaults(cs));
  assert.deepEqual(next.meta.brief, before.meta.brief);
  assert.equal(next.meta.brief?.doneToday?.value, 'partly');
  assert.equal(next.meta.brief?.doneToday?.status, 'user-confirmed');
  assert.deepEqual(next.meta.brief?.inMind?.value, ['rpa', 'ai']);
  assert.equal(next.steps.length, gold().steps.length);
  // Everything else is the reading's, as before.
  assert.deepEqual({ ...next, meta: { ...next.meta, name: gold().meta.name, brief: undefined } }, { ...gold(), meta: { ...gold().meta, brief: undefined } });
});

test('on a first reading a line a person gave is not replaced by one the reading brings', () => {
  let before = empty('Invoices');
  for (const op of ownWordsEdits({ doneToday: 'no', inMind: [], apps: [] })) before = op(before).model;
  const read = gold();
  const passage = read.steps[0].sources.slice(0, 1);
  read.meta.brief = { doneToday: { value: 'yes', status: 'stated', sources: passage }, kind: { value: 'existing_process', status: 'stated', sources: passage } };
  const next = applyChanges(before, read, defaults(proposeChanges(before, read)));
  assert.equal(next.meta.brief?.doneToday?.value, 'no');
  assert.equal(next.meta.brief?.kind?.value, 'existing_process');
});

test('extracting the same sources again changes nothing', () => {
  const cs = proposeChanges(gold(), gold());
  assert.equal(cs.first, false);
  assert.deepEqual(cs.changes, []);
  assert.ok(cs.unchanged > 40);
  assert.deepEqual(applyChanges(gold(), gold(), new Set()), gold());
});

test('re-extraction never overwrites a confirmed value: it records a conflict instead', () => {
  let m = gold();
  const step = m.steps.find(s => s.roleIds.length === 1)!;
  const other = m.roles.find(r => r.id !== step.roleIds[0])!;
  m = updateFact(m, { target: { kind: 'step', id: step.id, field: 'roleIds' }, value: [other.id] }).model;
  m = updateFact(m, { target: { kind: 'step', id: step.id, field: 'name' }, value: 'A name only I use' }).model;
  const q = m.openQuestions[0];

  const cs = proposeChanges(m, gold());
  const forStep = cs.changes.filter(c => c.currentId === step.id);
  assert.equal(forStep.length, 1, 'matched by its quotes despite the new name');
  assert.equal(forStep[0].kind, 'conflict');
  assert.ok(!cs.changes.some(c => c.kind === 'add' && c.element === 'step'), 'no duplicate step');

  const next = applyChanges(m, gold(), defaults(cs));
  const after = next.steps.find(s => s.id === step.id)!;
  assert.deepEqual(after.roleIds, [other.id]);
  assert.equal(after.name, 'A name only I use');
  assert.equal(after.status, 'user-confirmed');
  const conflict = next.conflicts.find(c => c.target.kind === 'step' && c.target.id === step.id)!;
  assert.ok(conflict && conflict.resolution === null);
  assert.equal(conflict.values.length, 2);
  assert.ok(validateModel(next).valid);

  // An answered question stays answered and its confirmed field stays.
  const answered = answerQuestion(m, { questionId: q.id, answer: 'Checked with the team' }).model;
  const again = applyChanges(answered, gold(), defaults(proposeChanges(answered, gold())));
  assert.equal(again.openQuestions.find(x => x.id === q.id)?.status, 'answered');
});

test('a step the extraction adds is inserted into the flow, not beside it', () => {
  const g = gold();
  const middle = orderedSteps(g).find(s => incoming(g, s.id).length === 1 && outgoing(g, s.id).length === 1
    && !g.flows.some(f => f.from === incoming(g, s.id)[0].from && f.to === outgoing(g, s.id)[0].to))!;
  const before = incoming(g, middle.id)[0].from, after = outgoing(g, middle.id)[0].to;
  const current = removeStep(g, { stepId: middle.id }).model;
  const cs = proposeChanges(current, g);
  const add = cs.changes.find(c => c.kind === 'add' && c.element === 'step')!;
  assert.equal(add.label, middle.name);
  const next = applyChanges(current, g, defaults(cs));
  const added = next.steps.find(s => s.name === middle.name)!;
  assert.deepEqual(incoming(next, added.id).map(f => f.from), [before]);
  assert.deepEqual(outgoing(next, added.id).map(f => f.to), [after]);
  assert.ok(!next.flows.some(f => f.from === before && f.to === after), 'the direct flow was replaced');
  assert.equal(orderedSteps(next).findIndex(s => s.id === added.id), orderedSteps(g).findIndex(s => s.id === middle.id));
});

test('what the sources no longer show is offered for removal, unselected, and never if confirmed', () => {
  const g = gold();
  const extracted = removeStep(g, { stepId: g.steps[3].id }).model;
  let current = g;
  current = updateFact(current, { target: { kind: 'step', id: g.steps[5].id, field: 'description' }, value: 'Mine' }).model;
  const extracted2 = removeStep(extracted, { stepId: g.steps[5].id }).model;
  const cs = proposeChanges(current, extracted2);
  const removals = cs.changes.filter(c => c.kind === 'remove' && c.element === 'step');
  assert.deepEqual(removals.map(c => c.currentId), [g.steps[3].id]);
  assert.equal(removals[0].defaultSelected, false);
  assert.ok(applyChanges(current, extracted2, defaults(cs)).steps.some(s => s.id === g.steps[3].id));
  assert.ok(!applyChanges(current, extracted2, new Set([removals[0].id])).steps.some(s => s.id === g.steps[3].id));
});

test('a changed access route is described in words, never as raw data', () => {
  const g = gold();
  const changed = structuredClone(g);
  const sys = changed.systems.find(s => s.id === 'sys-tracker')!;
  sys.access = [...sys.access, { method: 'api', name: 'Graph', operations: [], access: 'confirmed', status: 'stated', sources: [] }];
  const c = proposeChanges(g, changed).changes.find(x => x.element === 'system' && x.currentId === 'sys-tracker')!;
  assert.ok(c, 'the tracker change is proposed');
  assert.doesNotMatch(c.detail, /object Object|\{/);
  // Only what changed: the new way in, not the whole list before and after.
  assert.equal(c.detail, 'access: added API Graph: confirmed available');
});

test('a new reading never removes what a person said about an application\'s ways in, and says only what changed', async () => {
  const { setSystemApi } = await import('../processModel/patch.ts');
  // A person answers "no API" for an application the sources only described (found on the owner's documents, 16 November 2026).
  const g = gold();
  const sys = g.systems.find(s => s.status !== 'user-confirmed' && s.access.some(a => a.method !== 'api'))!;
  let m = setSystemApi(g, { systemId: sys.id, access: 'confirmed_absent' }).model;
  const mine = m.systems.find(s => s.id === sys.id)!.access.filter(a => a.status === 'user-confirmed');
  assert.ok(mine.length > 0);
  // The sources say nothing of an API now, and one way in changed.
  const reread = gold();
  const rs = reread.systems.find(s => s.id === sys.id)!;
  rs.access = rs.access.filter(a => a.method !== 'api').map((a, i) => (i === 0 ? { ...a, access: a.access === 'confirmed' ? 'reported' : 'confirmed' } : a));
  const cs = proposeChanges(m, reread);
  const change = cs.changes.find(c => c.currentId === sys.id);
  if (change) {
    assert.doesNotMatch(change.detail, /API[^;]*not available →|no longer API/, 'the person\'s API answer is not offered for removal');
    assert.match(change.detail, /^access: (added|no longer)/, 'only what changed, not the whole list twice');
  }
  m = applyChanges(m, reread, defaults(cs));
  const after = m.systems.find(s => s.id === sys.id)!;
  for (const a of mine) assert.ok(after.access.some(x => x.method === a.method && x.access === a.access && x.status === 'user-confirmed'), 'kept as the person said');
  assert.ok(validateModel(m).valid);
});

// ---- A re-reading does not pile up reworded questions (package B, pull request 5a; owner, 25 November 2026) -------

import { notTickedLine, QUESTION_DETAIL } from './rebase.ts';
import { emptyModel } from '../processModel/empty.ts';
import type { ElementTarget, OpenQuestion } from '../processModel/types.ts';

/** The sample brought in as a first reading: a draft with steps. */
function draftOf(questions: OpenQuestion[] = []): ProcessModel {
  const empty = emptyModel('Supplier invoices');
  const first = applyChanges(empty, gold(), new Set(proposeChanges(empty, gold()).changes.map(c => c.id)));
  return { ...first, openQuestions: [...first.openQuestions, ...questions] };
}
const q = (id: string, target: ElementTarget, question: string, status: OpenQuestion['status'] = 'open'): OpenQuestion => ({ id, target, question, whyItMatters: '', owner: null, status, ...(status === 'answered' ? { answer: 'Not applicable to this process.' } : {}) });
const reading = (questions: OpenQuestion[]): ProcessModel => ({ ...gold(), openQuestions: [...gold().openQuestions, ...questions] });
const questionChanges = (current: ProcessModel, extracted: ProcessModel) => proposeChanges(current, extracted).changes.filter(c => c.element === 'question');

test('a first reading (no steps in the draft yet) takes every question, ticked, as before', () => {
  // A draft with no steps yet, though not empty: what the person wants from the process is set.
  const bare: ProcessModel = { ...emptyModel('Supplier invoices'), openQuestions: [q('q-1', { kind: 'meta' }, 'Who signs the process off?')] };
  const extra = q('x-1', { kind: 'meta' }, 'What does the business hope the process gains next year from its suppliers?');
  for (const c of questionChanges(bare, reading([extra]))) assert.equal(c.defaultSelected, true, c.label);
});

test('(a) a question on a field already asked about, open, left or closed, is not added; on a field not asked about, it is', () => {
  for (const status of ['open', 'deferred', 'answered'] as const) {
    const current = draftOf([q('q-90', { kind: 'step', id: 's-match', field: 'roleIds' }, 'Who does "Three-way match"?', status)]);
    const cs = questionChanges(current, reading([q('x-1', { kind: 'step', id: 's-match', field: 'roleIds' }, 'Which team carries out the three-way matching against the order?')]));
    assert.equal(cs.some(c => c.extractedId === 'x-1'), false, status);
  }
  const current = draftOf();
  const cs = questionChanges(current, reading([q('x-2', { kind: 'step', id: 's-check', field: 'roleIds' }, 'Which team checks the mandatory fields?')]));
  assert.equal(cs.find(c => c.extractedId === 'x-2')?.defaultSelected, true);
});

test('(c) a question about an element as a whole: added when nothing is asked about it, listed not ticked when something is', () => {
  const current = draftOf([q('q-91', { kind: 'step', id: 's-match' }, 'Is the matching step still done by hand on Fridays?')]);
  const cs = questionChanges(current, reading([
    q('x-3', { kind: 'step', id: 's-match' }, 'How often does the matching run fail outright for a whole batch of invoices?'),
    q('x-4', { kind: 'step', id: 's-check' }, 'Are mandatory fields ever waived for a known supplier?'),
  ]));
  assert.deepEqual(cs.find(c => c.extractedId === 'x-3') && { on: cs.find(c => c.extractedId === 'x-3')!.defaultSelected, d: cs.find(c => c.extractedId === 'x-3')!.detail }, { on: false, d: QUESTION_DETAIL['offer-element'] });
  assert.equal(cs.find(c => c.extractedId === 'x-4')?.defaultSelected, true);
});

test('(b) on a draft shaped like the live processes (most open questions about the process as a whole), rewordings are listed, none ticked', () => {
  // 20 of 33 open questions about the process as a whole, as on the live processes (20 of 33, 27 of 66, 31 of 44).
  const whole = Array.from({ length: 20 }, (_, i) => q(`q-w${i}`, { kind: 'meta' }, `Whole-process question number ${i} about supplier invoices and approvals in the region ${i}?`));
  const fields = Array.from({ length: 3 }, (_, i) => q(`q-f${i}`, { kind: 'metric', id: 'm-paper-share', field: 'value' }, `Share of paper invoices, asked ${i}?`));
  const current = draftOf([...whole, ...fields]);
  assert.equal(current.openQuestions.filter(x => x.status === 'open').length, 33);
  // The update rewords every whole-process question (fewer than 0.8 alike, so the word rule lets them all through),
  // asks the paper share again, and raises one question on a step not asked about.
  const reworded = Array.from({ length: 20 }, (_, i) => q(`x-w${i}`, { kind: 'meta' }, `Could someone confirm item ${i}: how approvals of supplier invoices differ across regions?`));
  const cs = questionChanges(current, reading([...reworded, q('x-p', { kind: 'metric', id: 'm-paper-share', field: 'value' }, 'What portion of invoices still arrive on paper?'), q('x-n', { kind: 'step', id: 's-check', field: 'systemIds' }, 'Where are the mandatory fields checked?')]));
  const listed = cs.filter(c => c.extractedId?.startsWith('x-w'));
  assert.equal(listed.length, 20, 'every rewording is listed');
  assert.equal(listed.filter(c => c.defaultSelected).length, 0, 'none is ticked');
  assert.equal(cs.some(c => c.extractedId === 'x-p'), false, 'the figure already asked about is not added');
  assert.equal(cs.find(c => c.extractedId === 'x-n')?.defaultSelected, true);
  assert.equal(notTickedLine({ changes: cs }), '20 new questions about the process as a whole are not ticked: tick the ones to keep.');
  // Applied as proposed, the open questions go from 33 to 34 (only the step's), not 55.
  const picked = new Set(proposeChanges(current, reading([...reworded])).changes.filter(c => c.defaultSelected).map(c => c.id));
  const after = applyChanges(current, reading([...reworded]), picked);
  assert.ok(validateModel(after).valid);
  assert.equal(after.openQuestions.filter(x => x.status === 'open').length, 33);
});

test('the not-ticked line counts both kinds, and says nothing when every question is ticked', () => {
  assert.equal(notTickedLine({ changes: [] }), null);
  const c = (detail: string) => ({ id: detail, kind: 'add' as const, element: 'question' as const, label: '', detail, defaultSelected: false });
  assert.equal(notTickedLine({ changes: [c(QUESTION_DETAIL['offer-whole']), c(QUESTION_DETAIL['offer-element'])] }),
    '1 new question about the process as a whole and 1 new question about something already asked about are not ticked: tick the ones to keep.');
});
